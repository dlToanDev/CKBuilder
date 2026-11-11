import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../src/errors.js";
import { decodeAmount, encodeAmount, MAX_AMOUNT, parseAmount } from "../src/ckb/token.js";

function invalidAmount(error: unknown): boolean {
  assert.ok(error instanceof AppError);
  assert.equal(error.status, 400);
  assert.equal(error.code, "INVALID_AMOUNT");
  return true;
}

describe("positive decimal amount validation", () => {
  it("keeps integer precision beyond Number.MAX_SAFE_INTEGER through uint128", () => {
    assert.equal(MAX_AMOUNT, 340282366920938463463374607431768211455n);
    for (const value of [1n, 255n, 256n, 9007199254740991n, 9007199254740992n,
      9007199254740993n, 18446744073709551616n, MAX_AMOUNT - 1n, MAX_AMOUNT]) {
      assert.equal(parseAmount(value.toString()), value);
    }
    assert.notEqual(parseAmount("9007199254740993"), BigInt(Number("9007199254740993")));
  });

  for (const value of ["", "0", "00", "01", "-1", "+1", "1.0", "0.1", "1e3", "1E3",
    "0x10", "1_000", "1,000", " 1", "1 ", "1\n", "1\r\n", "１", "١", "NaN", "Infinity",
    (MAX_AMOUNT + 1n).toString(), "9".repeat(39), "1".repeat(40), "9".repeat(5000)]) {
    it(`rejects invalid decimal ${JSON.stringify(value.length > 80 ? `${value.slice(0, 20)}… (${value.length} chars)` : value)}`, () => {
      assert.throws(() => parseAmount(value), invalidAmount);
    });
  }

  it("rejects JSON numbers, bigint, booleans, containers and coercible objects", () => {
    for (const value of [undefined, null, 1, 9007199254740992, NaN, Infinity, 1n, true, false,
      [], ["1"], {}, new String("1"), { toString() { throw new Error("must not coerce"); } }]) {
      assert.throws(() => parseAmount(value), invalidAmount);
    }
  });
});

describe("sUDT uint128 little-endian cell data", () => {
  const vectors: [bigint, string][] = [
    [0n, "0x00000000000000000000000000000000"],
    [1n, "0x01000000000000000000000000000000"],
    [255n, "0xff000000000000000000000000000000"],
    [256n, "0x00010000000000000000000000000000"],
    [9007199254740993n, "0x01000000000020000000000000000000"],
    [18446744073709551616n, "0x00000000000000000100000000000000"],
    [0x0f0e0d0c0b0a09080706050403020100n, "0x000102030405060708090a0b0c0d0e0f"],
    [MAX_AMOUNT, "0xffffffffffffffffffffffffffffffff"],
  ];
  for (const [value, bytes] of vectors) {
    it(`encodes and decodes the independent vector ${value}`, () => {
      assert.equal(encodeAmount(value), bytes);
      assert.equal(decodeAmount(bytes), value);
      assert.equal(decodeAmount(`0x${bytes.slice(2).toUpperCase()}`), value);
    });
  }

  it("preserves every bit position across all 16 bytes", () => {
    for (let bit = 0; bit < 128; bit++) {
      const value = 1n << BigInt(bit);
      const bytes = Buffer.alloc(16);
      bytes[Math.floor(bit / 8)] = 1 << (bit % 8);
      assert.equal(encodeAmount(value), `0x${bytes.toString("hex")}`);
      assert.equal(decodeAmount(`0x${bytes.toString("hex")}`), value);
    }
  });

  it("reads only the first uint128 when valid extension bytes follow", () => {
    assert.equal(decodeAmount(`${vectors[1][1]}deadBEEF00`), 1n);
    assert.equal(decodeAmount(`${vectors[7][1]}00`), MAX_AMOUNT);
  });

  it("does not truncate values larger than uint128", () => {
    assert.throws(() => encodeAmount(MAX_AMOUNT + 1n));
    assert.throws(() => encodeAmount(1n << 256n));
  });

  it("rejects negative values instead of wrapping them into positive supply", () => {
    assert.throws(() => encodeAmount(-1n), RangeError);
    assert.throws(() => encodeAmount(-MAX_AMOUNT), RangeError);
  });

  for (const data of ["", "0x", "00".repeat(16), `0X${"00".repeat(16)}`,
    `0x${"00".repeat(15)}`, `0x${"0".repeat(31)}`, `0x${"0".repeat(33)}`,
    `0x${"00".repeat(15)}gg`, `0x${"00".repeat(16)}z0`,
    ` ${vectors[0][1]}`, `${vectors[0][1]}\n`, "-1"]) {
    it(`rejects malformed cell data ${JSON.stringify(data)}`, () => {
      assert.throws(() => decodeAmount(data), (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.status, 422);
        assert.equal(error.code, "INVALID_CELL_DATA");
        return true;
      });
    });
  }
});
