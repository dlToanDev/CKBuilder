import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { AppError } from "../src/errors.js";
import { DOB_PROTOCOL, decodeDob, dobData, encodeDob, hash32, idempotencyKey } from "../src/modules/dob-data.js";
import { assertLiveInputs, confirmedConflictingSpend, inspectDobTransaction, liveObject, objectType, selectCreationFirstInput } from "../src/ckb/dob.js";
import { client, offckb } from "../src/ckb/client.js";
import { mutateDob } from "../src/modules/dob.js";
import { withTransactionLock } from "../src/modules/transaction-guard.js";

const ID = `0x${"12".repeat(32)}`;
const HASH = `0x${"34".repeat(32)}`;
const plain = { name: "My First CKB DOB", description: "My first digital object on Nervos CKB", contentType: "text/plain", content: "Hello CKB DOB!" };
const rejects = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;
// All node responses in this file are fixtures. Real network access and signing
// are forbidden: every test starts with a fetch guard, restored by node:test.
function networkGuard(t: any) {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network access in offline DOB tests"); });
  t.mock.method(client, "sendTransaction", async () => { assert.fail("Unit tests must never broadcast"); });
}
function nodeFixture(t: any, results: Record<string, unknown>) {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const { method } = JSON.parse(init.body as string);
    calls.push(method);
    assert.ok(Object.hasOwn(results, method), `Unexpected RPC ${method}`);
    assert.notEqual(method, "send_transaction");
    return Response.json({ result: results[method] });
  });
  return calls;
}

describe("offline DOB input and on-chain text format", () => {
  it("round-trips complete Unicode metadata and preserves content bytes", (t) => {
    networkGuard(t);
    const data = dobData({ ...plain, name: "Đối tượng CKB", content: "Hello 🌱\n<svg onload=alert(1)>" });
    assert.equal(data.protocol, DOB_PROTOCOL);
    assert.deepEqual(decodeDob(encodeDob(data)), data);
    assert.equal(Buffer.from(ccc.bytesFrom(encodeDob(data))).toString("utf8"), JSON.stringify(data));
  });
  it("enforces byte limits rather than JavaScript character counts", (t) => {
    networkGuard(t);
    assert.equal(dobData({ ...plain, content: "🌱".repeat(384) }).content.length, 768);
    assert.throws(() => dobData({ ...plain, content: "🌱".repeat(385) }), rejects("INVALID_DOB_DATA"));
    assert.throws(() => dobData({ ...plain, name: "đ".repeat(65) }), rejects("INVALID_DOB_DATA"));
    assert.throws(() => dobData({ ...plain, description: "đ".repeat(257) }), rejects("INVALID_DOB_DATA"));
  });
  it("rejects serialized JSON expansion before a journal entry can be saved", async (t) => {
    networkGuard(t);
    const expanded = { ...plain, name: '"'.repeat(128), description: '"'.repeat(512), content: '"'.repeat(1536) };
    assert.throws(() => dobData(expanded), rejects("ENCODED_DOB_TOO_LARGE"));
    await assert.rejects(mutateDob("create", expanded, "dob-unit-tests"), rejects("ENCODED_DOB_TOO_LARGE"));
    const accepted = dobData({ ...plain, content: '"'.repeat(1536) });
    assert.deepEqual(decodeDob(encodeDob(accepted)), accepted);
  });
  it("rejects control bytes and unpaired Unicode surrogates", (t) => {
    networkGuard(t);
    for (const content of ["", "   ", "hello\u0000", "\ud800", "\udfff", "\u007f"]) assert.throws(() => dobData({ ...plain, content }), rejects("INVALID_DOB_DATA"));
  });
  it("accepts text and JSON, rejects binary content labels and malformed JSON", (t) => {
    networkGuard(t);
    assert.equal(dobData({ ...plain, contentType: "TEXT/PLAIN" }).contentType, "text/plain");
    assert.equal(dobData({ ...plain, contentType: "application/json", content: '{"hello":"CKB"}' }).contentType, "application/json");
    assert.throws(() => dobData({ ...plain, contentType: "application/json", content: "{bad}" }), rejects("INVALID_CONTENT"));
    for (const contentType of ["image/png", "text/plain; charset=utf-8", "text/", "text/plain\n"]) assert.throws(() => dobData({ ...plain, contentType }), rejects("INVALID_CONTENT_TYPE"));
  });
  it("rejects a mismatched protocol, invalid UTF-8, oversized or corrupt Cell data", (t) => {
    networkGuard(t);
    for (const hex of ["0xff", "0x", "0x123", ccc.hexFrom(Buffer.from('{"protocol":"spore"}')), ccc.hexFrom(Buffer.alloc(4097)), ccc.hexFrom(Buffer.from(JSON.stringify({ ...dobData(plain), version: 2 })))]) {
      assert.throws(() => decodeDob(hex), rejects("INVALID_ON_CHAIN_DOB"));
    }
  });
  it("validates identifiers and idempotency keys strictly", (t) => {
    networkGuard(t);
    assert.equal(hash32(ID.toUpperCase().replace("0X", "0x")), ID);
    for (const value of [undefined, null, 1, [], "", ID + "\n", "0x" + "ff".repeat(33)]) assert.throws(() => hash32(value), rejects("INVALID_ID"));
    assert.equal(idempotencyKey("dob-request-001"), "dob-request-001");
    for (const value of [undefined, "short", "a".repeat(101), "valid-key\n", "key with spaces"]) assert.throws(() => idempotencyKey(value), rejects("INVALID_IDEMPOTENCY_KEY"));
  });
  it("rejects untrusted mutation fields before store, key access or node calls", async (t) => {
    networkGuard(t);
    for (const kind of ["create", "transfer"] as const) {
      for (const body of [undefined, null, [], "{}", 1]) await assert.rejects(mutateDob(kind, body, "dob-unit-tests"), rejects("INVALID_BODY"));
      for (const field of ["privateKey", "signedTransaction", "command", "__proto__", "constructor"]) {
        await assert.rejects(mutateDob(kind, JSON.parse(`{"${field}":"untrusted"}`), "dob-unit-tests"), rejects("INVALID_BODY"));
      }
      await assert.rejects(mutateDob(kind, {}, "bad"), rejects("INVALID_IDEMPOTENCY_KEY"));
    }
    await assert.rejects(mutateDob("transfer", { objectId: ID, receiver: "ckt1invalid" }, "dob-unit-tests"), rejects("INVALID_ADDRESS"));
    await assert.rejects(mutateDob("create", { ...plain, name: " " }, "dob-unit-tests"), rejects("INVALID_DOB_DATA"));
  });
});

describe("offline DOB chain verification", () => {
  it("does not infer existence or ownership from a local object ID", async (t) => {
    networkGuard(t);
    const calls = nodeFixture(t, { get_tip_block_number: "0x10", get_indexer_tip: { block_number: "0x10" }, get_cells: { objects: [] } });
    assert.equal(await liveObject(ID), null);
    assert.deepEqual(calls, ["get_tip_block_number", "get_indexer_tip", "get_cells"]);
  });
  it("fails closed when the indexer is behind the chain", async (t) => {
    networkGuard(t);
    const calls = nodeFixture(t, { get_tip_block_number: "0x10", get_indexer_tip: { block_number: "0xf" } });
    await assert.rejects(liveObject(ID), rejects("INDEXER_SYNCING"));
    assert.equal(calls.includes("get_cells"), false);
  });
  it("rejects duplicate matches rather than guessing the owner", async (t) => {
    networkGuard(t);
    nodeFixture(t, { get_tip_block_number: "0x10", get_indexer_tip: { block_number: "0x10" }, get_cells: { objects: [{}, {}] } });
    await assert.rejects(liveObject(ID), rejects("NON_UNIQUE_OBJECT"));
  });
  it("verifies indexed Cell liveness independently", async (t) => {
    networkGuard(t);
    nodeFixture(t, { get_tip_block_number: "0x10", get_indexer_tip: { block_number: "0x10" }, get_cells: { objects: [{ out_point: { tx_hash: HASH, index: "0x0" } }] } });
    t.mock.method(client, "getCellLiveNoCache", async () => undefined);
    await assert.rejects(liveObject(ID), rejects("STALE_OBJECT_CELL"));
  });
  it("requires commitment even if an indexed Cell is returned as live", async (t) => {
    networkGuard(t);
    nodeFixture(t, { get_tip_block_number: "0x10", get_indexer_tip: { block_number: "0x10" }, get_cells: { objects: [{ out_point: { tx_hash: HASH, index: "0x0" } }] }, get_transaction: { tx_status: { status: "pending" } } });
    const local = offckb.scripts[ccc.KnownScript.Secp256k1Blake160]!;
    const cell = ccc.Cell.from({ outPoint: { txHash: HASH, index: 0 }, cellOutput: { lock: { codeHash: local.codeHash, hashType: local.hashType, args: `0x${"11".repeat(20)}` }, type: await objectType(ID), capacity: 0n }, outputData: encodeDob(dobData(plain)) });
    t.mock.method(client, "getCellLiveNoCache", async () => cell);
    await assert.rejects(liveObject(ID), rejects("OBJECT_NOT_COMMITTED"));
  });
  for (const status of ["pending", "proposed", "committed", "rejected", "unknown"]) {
    it(`reports ${status} only from its node status fixture`, async (t) => {
      networkGuard(t);
      nodeFixture(t, { get_transaction: status === "unknown" ? null : { tx_status: { status, block_hash: status === "committed" ? HASH : null }, transaction: null }, get_header: { number: "0x123" } });
      const result = await inspectDobTransaction(HASH);
      assert.equal(result.status, status);
      assert.equal(result.blockNumber, status === "committed" ? "291" : null);
      assert.deepEqual(result.outputs, []);
    });
  }
  it("serializes funding across modules and releases the lock after failure", async (t) => {
    networkGuard(t);
    let release!: () => void;
    const first = withTransactionLock(() => new Promise<void>((resolve) => { release = resolve; }));
    await assert.rejects(withTransactionLock(async () => "second"), rejects("OPERATION_IN_PROGRESS"));
    release(); await first;
    await assert.rejects(withTransactionLock(async () => { throw new Error("failure"); }), /failure/);
    assert.equal(await withTransactionLock(async () => "released"), "released");
  });
  it("evicts an unusable input from CCC's funding cache", async (t) => {
    networkGuard(t);
    const tx = ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: HASH, index: 0 } }] });
    t.mock.method(client, "getCellLiveNoCache", async () => undefined);
    const unusable: string[] = [];
    t.mock.method(client.cache, "markUnusable", async (point: ccc.OutPoint) => { unusable.push(point.txHash); });
    await assert.rejects(assertLiveInputs(tx), rejects("INPUT_NOT_LIVE"));
    assert.deepEqual(unusable, [HASH]);
  });
  it("reconciles an unknown transaction only with a different committed spending transaction", async (t) => {
    networkGuard(t);
    const tx = ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: HASH, index: 0 } }] });
    const conflict = `0x${"56".repeat(32)}`;
    t.mock.method(client, "getCellLiveNoCache", async () => undefined);
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      const { method, params } = JSON.parse(init.body as string);
      calls.push(method);
      if (method === "get_transactions") return Response.json({ result: { objects: [{ tx_hash: conflict, cells: [["input", "0x0"]] }], last_cursor: "0x01" } });
      assert.equal(method, "get_transaction");
      if (params[0] === HASH) return Response.json({ result: { tx_status: { status: "committed" }, transaction: { outputs: [{ lock: {} }] } } });
      assert.equal(params[0], conflict);
      return Response.json({ result: { tx_status: { status: "committed" }, transaction: { inputs: [{ previous_output: { tx_hash: HASH, index: "0x0" } }] } } });
    });
    assert.equal(await confirmedConflictingSpend(tx), conflict);
    assert.deepEqual(calls, ["get_transaction", "get_transactions", "get_transaction"]);
  });
  it("does not turn missing input evidence or unrelated history into a rejection", async (t) => {
    networkGuard(t);
    const tx = ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: HASH, index: 0 } }] });
    t.mock.method(client, "getCellLiveNoCache", async () => undefined);
    nodeFixture(t, { get_transaction: { tx_status: { status: "committed" }, transaction: { outputs: [{ lock: {} }] } }, get_transactions: { objects: [], last_cursor: "0x" } });
    assert.equal(await confirmedConflictingSpend(tx), null);
  });
  it("avoids a rejected creation's recorded TYPE_ID when its first input is still live", async (t) => {
    networkGuard(t);
    const tx = ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: HASH, index: 0 } }, { previousOutput: { txHash: HASH, index: 1 } }] });
    const previousId = ccc.hashTypeId(tx.inputs[0], 0);
    const nextId = ccc.hashTypeId(tx.inputs[1], 0);
    async function* unusedCandidates(): AsyncGenerator<ccc.Cell> { assert.fail("An existing nonreserved input should be selected first"); }
    assert.equal(await selectCreationFirstInput(tx, [previousId], unusedCandidates()), nextId);
    assert.equal(tx.inputs[0].previousOutput.index, 1n);
    assert.notEqual(ccc.hashTypeId(tx.inputs[0], 0), previousId);
  });
  it("adds a fresh plain funding Cell when every collected first input is reserved", async (t) => {
    networkGuard(t);
    const tx = ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: HASH, index: 0 } }] });
    const previousId = ccc.hashTypeId(tx.inputs[0], 0);
    const local = offckb.scripts[ccc.KnownScript.Secp256k1Blake160]!;
    const cell = ccc.Cell.from({ outPoint: { txHash: HASH, index: 2 }, cellOutput: { lock: { codeHash: local.codeHash, hashType: local.hashType, args: `0x${"11".repeat(20)}` }, capacity: ccc.fixedPointFrom(100) }, outputData: "0x" });
    async function* candidates() { yield cell; }
    const id = await selectCreationFirstInput(tx, [previousId], candidates());
    assert.equal(tx.inputs.length, 2);
    assert.equal(tx.inputs[0].previousOutput.index, 2n);
    assert.equal(id, ccc.hashTypeId(tx.inputs[0], 0));
    assert.notEqual(id, previousId);
  });
  it("fails before journal mutation if no fresh TYPE_ID funding input is available", async (t) => {
    networkGuard(t);
    const tx = ccc.Transaction.from({ inputs: [{ previousOutput: { txHash: HASH, index: 0 } }] });
    const previousId = ccc.hashTypeId(tx.inputs[0], 0);
    async function* empty(): AsyncGenerator<ccc.Cell> { return; }
    await assert.rejects(selectCreationFirstInput(tx, [previousId], empty()), rejects("NO_FRESH_TYPE_ID_INPUT"));
    assert.equal(tx.inputs.length, 1);
  });
});
