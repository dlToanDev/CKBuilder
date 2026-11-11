import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { AppError, publicError } from "../src/errors.js";
import { offckb, parseAddress, rpc } from "../src/ckb/client.js";
import { inspectTransaction, scriptJson } from "../src/ckb/token.js";
import { mutateToken } from "../src/modules/fungible-token.js";

function failure(code: string, status = 400) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  };
}

const script = ccc.Script.from({ codeHash: `0x${"00".repeat(32)}`, hashType: "type", args: "0x" });

describe("address and transaction identifier validation", () => {
  it("parses the two public development addresses without requesting a signer", async () => {
    for (const account of offckb.accounts) {
      assert.equal((await parseAddress(account.address)).toString(), account.address);
    }
  });

  it("rejects absent, non-string, mainnet, malformed and overlong addresses", async () => {
    const valid = offckb.accounts[0].address;
    const badChecksum = `${valid.slice(0, -1)}${valid.endsWith("q") ? "p" : "q"}`;
    for (const value of [undefined, null, 123, {}, [], "", "ckb1invalid", "ckt1", "ckt1invalid",
      "ckt1" + "q".repeat(201), ` ${valid}`, `${valid}\n`, badChecksum]) {
      await assert.rejects(parseAddress(value), failure("INVALID_ADDRESS"));
    }
  });

  it("rejects invalid hashes before any RPC call", async () => {
    for (const hash of ["", "0x", "00".repeat(32), `0x${"00".repeat(31)}`,
      `0x${"00".repeat(33)}`, `0x${"g0".repeat(32)}`, `0x${"00".repeat(32)}\n`]) {
      await assert.rejects(inspectTransaction(hash, script), failure("INVALID_HASH"));
    }
  });

  it("projects only public script fields", () => {
    assert.deepEqual(scriptJson(script), { codeHash: `0x${"00".repeat(32)}`, hashType: "type", args: "0x" });
  });
});

describe("mutation input validation before store, signer or broadcast access", () => {
  // Every case deliberately fails before mutateToken can readStore/build/broadcast.
  // Never add a valid mutation here: the suite also runs beside the live UI.
  for (const kind of ["mint", "transfer"] as const) {
    it(`${kind}: rejects missing and non-object bodies`, async () => {
      for (const body of [undefined, null, false, 1, "{}", []]) {
        await assert.rejects(mutateToken(kind, body, "test-validation"), failure("INVALID_BODY"));
      }
    });

    it(`${kind}: rejects absent, short, long or non-ASCII idempotency keys`, async () => {
      for (const key of [undefined, null, 123, "", "short", "a".repeat(101), "bad key!", "é".repeat(8), "12345678\n"]) {
        await assert.rejects(mutateToken(kind, {}, key), failure("INVALID_IDEMPOTENCY_KEY"));
      }
    });

    it(`${kind}: rejects unknown fields and prototype-related JSON fields`, async () => {
      for (const field of ["privateKey", "signedTransaction", "__proto__", "constructor", "extra"]) {
        await assert.rejects(mutateToken(kind, JSON.parse(`{"${field}":"never-use-this"}`), "test-validation"), failure("INVALID_BODY"));
      }
    });

    it(`${kind}: validates amount strings before any blockchain work`, async () => {
      for (const amount of [undefined, null, 1, "0", "-1", "01", "1e3", "340282366920938463463374607431768211456"]) {
        const body = kind === "mint" ? { initialSupply: amount } : { amount };
        await assert.rejects(mutateToken(kind, body, "test-validation"), failure("INVALID_AMOUNT"));
      }
    });
  }

  it("rejects bad token names and symbols with an otherwise valid amount", async () => {
    for (const name of [undefined, null, 1, "", "   ", "x".repeat(65), "<script>", "token\nname"]) {
      await assert.rejects(mutateToken("mint", { name, symbol: "TEST", initialSupply: "1" }, "test-validation"), failure("INVALID_NAME"));
    }
    for (const symbol of [undefined, null, 1, "", "test", "1ABC", "A-B", "A".repeat(13), "ABC\n"]) {
      await assert.rejects(mutateToken("mint", { name: "Test Token", symbol, initialSupply: "1" }, "test-validation"), failure("INVALID_SYMBOL"));
    }
  });

  it("rejects invalid receivers with otherwise valid transfer amounts", async () => {
    for (const receiver of [undefined, null, 12, "ckb1invalid", "ckt1invalid", offckb.accounts[0].address + "q"]) {
      await assert.rejects(mutateToken("transfer", { amount: "9007199254740993", receiver }, "test-validation"), failure("INVALID_ADDRESS"));
    }
  });
});

describe("public error projection (no signing or transfer needed)", () => {
  it("preserves intentional application errors", () => {
    const error = new AppError(409, "TOKEN_NOT_CREATED", "Create the token first.");
    assert.equal(publicError(error), error);
  });

  it("maps insufficient capacity and token SDK errors to actionable 422 responses", () => {
    assert.ok(new ccc.ErrorTransactionInsufficientCapacity(1n) instanceof Error);
    for (const [error, code] of [
      [new ccc.ErrorTransactionInsufficientCapacity(1n), "INSUFFICIENT_CAPACITY"],
      [new ccc.ErrorTransactionInsufficientCoin(1n, script), "INSUFFICIENT_TOKEN_BALANCE"],
    ] as const) {
      const result = publicError(error);
      assert.equal(result.status, 422);
      assert.equal(result.code, code);
      assert.ok(result.message.length > 0);
    }
  });

  it("sanitizes unexpected failures instead of returning keys, SDK details or stacks", () => {
    const secret = "test-only-secret-that-must-never-be-returned";
    const internal = Object.assign(new Error(secret), { privateKey: secret, signedTransaction: secret });
    for (const error of [internal, { message: secret, request: { privateKey: secret } }, secret, undefined, null]) {
      const result = publicError(error);
      assert.equal(result.status, 503);
      assert.equal(result.code, "BLOCKCHAIN_UNAVAILABLE");
      assert.equal(JSON.stringify(result).includes(secret), false);
      assert.equal(result.message.includes(secret), false);
      assert.equal("privateKey" in result, false);
      assert.equal("signedTransaction" in result, false);
    }
  });
});

describe("RPC failure boundaries", () => {
  for (const mode of ["network", "http", "rpc", "invalid-json"] as const) {
    it(`sanitizes ${mode} failures without contacting the node`, async (t) => {
      const secret = "test-only-sensitive-rpc-details";
      const calls: string[] = [];
      t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
        calls.push(JSON.parse(init.body as string).method);
        if (mode === "network") throw new Error(secret);
        if (mode === "http") return new Response(secret, { status: 500 });
        if (mode === "rpc") return Response.json({ error: { code: -1, message: secret } });
        return new Response(secret);
      });
      await assert.rejects(rpc("get_tip_header"), (error: unknown) => {
        assert.ok(failure("RPC_UNAVAILABLE", 503)(error));
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(secret), false);
        return true;
      });
      assert.deepEqual(calls, ["get_tip_header"]);
    });
  }
});
