import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { AppError } from "../src/errors.js";
import { client, offckb } from "../src/ckb/client.js";
import { accountLock, estimateLock, liveLockCell } from "../src/ckb/lock-script.js";
import { cellStatus, inspectLockTransaction, mutateLock } from "../src/modules/lock-script.js";
import { capacityFrom, expectedLockFailure, LOCK_DATA, lockPoint, minimumCapacity, signatureProof } from "../src/modules/lock-script-data.js";

const HASH = `0x${"12".repeat(32)}`;
const BLOCK = `0x${"34".repeat(32)}`;
const point = { txHash: HASH, index: 0 };
const rejects = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;
function offline(t: any) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Unexpected network call in offline Lock Script tests"));
  t.mock.method(client, "sendTransaction", async () => assert.fail("Offline tests must never broadcast"));
}
function fixture(t: any, handler: (method: string, params: any[]) => unknown) {
  const methods: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(init.body as string);
    assert.notEqual(request.method, "send_transaction");
    methods.push(request.method);
    return Response.json({ result: handler(request.method, request.params) });
  });
  return methods;
}
describe("Lock Script offline validation and cryptographic ownership", () => {
  it("preserves Shannon precision and rejects invalid / uint64-overflow capacity", (t) => {
    offline(t);
    assert.equal(capacityFrom("62.00000001"), 6200000001n);
    assert.equal(capacityFrom("184467440737.09551615"), 0xffffffffffffffffn);
    for (const value of [undefined, null, 62, "", "0", "-1", "01", "1e2", "62.000000001", "62\n", " 62", "184467440737.09551616"]) assert.throws(() => capacityFrom(value), rejects("INVALID_CAPACITY"));
  });
  it("calculates occupied capacity with actual lock args and marker bytes", (t) => {
    offline(t);
    const script = ccc.Script.from({ codeHash: HASH, hashType: "type", args: `0x${"11".repeat(20)}` });
    assert.equal(minimumCapacity(script, "0x"), 6100000000n);
    assert.equal(minimumCapacity(script), 6200000000n);
    assert.equal(minimumCapacity(script, "0x1234"), 6300000000n);
    assert.equal(LOCK_DATA, "0x4c");
  });
  it("validates exact outpoint fields, hash and integer bounds", (t) => {
    offline(t);
    assert.deepEqual(lockPoint(point), point);
    assert.deepEqual(lockPoint({ txHash: HASH, index: 0xffffffff }), { txHash: HASH, index: 0xffffffff });
    for (const value of [null, [], "text", { ...point, privateKey: "secret" }, { txHash: "0x1234", index: 0 }, { ...point, index: -1 }, { ...point, index: "0" }, { ...point, index: 0x100000000 }, { ...point, index: 0.5 }]) assert.throws(() => lockPoint(value), AppError);
  });
  it("proves a complete valid signature can fail ownership for the same sighash", async (t) => {
    offline(t);
    // Fixed keys are public test fixtures only; never read development keys.
    const owner = new ccc.SignerCkbPrivateKey(client, `0x${"01".repeat(32)}`);
    const other = new ccc.SignerCkbPrivateKey(client, `0x${"02".repeat(32)}`);
    const lock = (await owner.getRecommendedAddressObj()).script;
    const cell = ccc.Cell.from({ outPoint: point, cellOutput: { capacity: 10000000000n, lock }, outputData: LOCK_DATA });
    const tx = ccc.Transaction.from({ outputs: [{ lock, capacity: 9999999000n }], outputsData: ["0x"] });
    tx.addInput(cell);
    await tx.prepareSighashAllWitness(lock, 65, client);
    const info = (await tx.getSignHashInfo(lock, client))!;
    const authorized = ccc.signMessageSecp256k1(info.message, owner.privateKey);
    const unauthorized = ccc.signMessageSecp256k1(info.message, other.privateKey);
    assert.equal(signatureProof(info.message, authorized, owner.publicKey, lock.args).authorized, true);
    const proof = signatureProof(info.message, unauthorized, other.publicKey, lock.args);
    assert.equal(proof.validSignature, true);
    assert.equal(proof.recoveredPublicKey, other.publicKey);
    assert.equal(proof.authorized, false);
    assert.notEqual(proof.expectedArgs, proof.recoveredArgs);
    assert.equal(ccc.bytesFrom(unauthorized).length, 65);
    const witness = tx.getWitnessArgs(info.position)!;
    witness.lock = unauthorized; tx.setWitnessArgs(info.position, witness);
    const witnessHash = (await tx.getSignHashInfo(lock, client))!.message;
    assert.notEqual(witnessHash, info.message, "sighash must reset the signature placeholder before hashing");
    await tx.prepareSighashAllWitness(lock, 65, client);
    assert.equal((await tx.getSignHashInfo(lock, client))!.message, info.message);
    assert.throws(() => signatureProof(info.message, "0x", other.publicKey, lock.args), rejects("INVALID_SIGNATURE"));
  });
  it("accepts only the expected VM input-lock ownership failure", (t) => {
    offline(t);
    const message = "TransactionScriptError { source: Inputs[0].Lock, cause: ValidationFailure: see error code -31 on page https://nervosnetwork.github.io/ckb-script-error-codes/by-type-hash/example.html }";
    assert.equal(expectedLockFailure({ code: -302, message }, 0), true);
    assert.equal(expectedLockFailure({ code: -302, message: "Script failed", data: message }, 0), true);
    for (const error of [{ code: -301, message }, { code: -32601, message }, { code: -302, message: message.replace("-31", "-1") }, { code: -302, message: message.replace("Inputs[0].Lock", "Inputs[0].Type") }, { code: -302, message: message.replace("Inputs[0]", "Inputs[1]") }, { code: -302, message: "Invalid witness length" }]) assert.equal(expectedLockFailure(error, 0), false);
  });
  it("rejects browser-supplied secrets and commands before touching RPC or keys", async (t) => {
    offline(t);
    for (const kind of ["create", "test-unauthorized", "spend"] as const) {
      for (const body of [undefined, null, [], 1]) await assert.rejects(mutateLock(kind, body, "lock-offline-key"), rejects("INVALID_BODY"));
      for (const field of ["privateKey", "command", "signedTransaction", "constructor", "__proto__"]) await assert.rejects(mutateLock(kind, JSON.parse(`{"${field}":"untrusted"}`), "lock-offline-key"), rejects("INVALID_BODY"));
      await assert.rejects(mutateLock(kind, {}, "bad"), rejects("INVALID_IDEMPOTENCY_KEY"));
    }
    await assert.rejects(mutateLock("create", { ownerAccount: 1, capacity: "100" }, "lock-offline-key"), rejects("INVALID_OWNER"));
    await assert.rejects(mutateLock("create", { ownerAccount: 0, capacity: "-1" }, "lock-offline-key"), rejects("INVALID_CAPACITY"));
    await assert.rejects(mutateLock("spend", { outPoint: point, receiver: "ckt1invalid" }, "lock-offline-key"), rejects("INVALID_ADDRESS"));
  });
});
describe("Lock Script offline node status and dry-run handling", () => {
  it("uses only estimate_cycles and serializes a complete transaction", async (t) => {
    offline(t);
    const tx = ccc.Transaction.from({ inputs: [{ previousOutput: point }] });
    const calls = fixture(t, (method, params) => {
      assert.equal(method, "estimate_cycles");
      assert.deepEqual(params[0], cccA.JsonRpcTransformers.transactionFrom(tx));
      return { cycles: "0x123" };
    });
    assert.deepEqual(await estimateLock(tx), { cycles: "291", error: null });
    assert.deepEqual(calls, ["estimate_cycles"]);
  });
  it("preserves actual VM validation errors and never broadcasts", async (t) => {
    offline(t);
    const error = { code: -302, message: "Inputs[0].Lock ValidationFailure: error code -31", data: "actual node detail" };
    t.mock.method(globalThis, "fetch", async () => Response.json({ error }));
    assert.deepEqual(await estimateLock(ccc.Transaction.from({})), { cycles: null, error });
  });
  it("does not turn missing RPC support, transport or invalid responses into proof", async (t) => {
    offline(t);
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: -32601, message: "Method not found" } }));
    const result = await estimateLock(ccc.Transaction.from({}));
    assert.equal(expectedLockFailure(result.error, 0), false);
    t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
    await assert.rejects(estimateLock(ccc.Transaction.from({})), rejects("DRY_RUN_UNAVAILABLE"));
    t.mock.method(globalThis, "fetch", async () => Response.json({ result: {} }));
    await assert.rejects(estimateLock(ccc.Transaction.from({})), rejects("INVALID_DRY_RUN_RESPONSE"));
  });
  for (const status of ["live", "dead", "unknown"]) {
    it(`reports actual Cell status ${status} without guessing`, async (t) => {
      offline(t);
      fixture(t, (method, params) => { assert.equal(method, "get_live_cell"); assert.equal(params[0].tx_hash, HASH); return { status, cell: status === "live" ? { data: {} } : null }; });
      assert.equal((await cellStatus(point)).status, status);
    });
  }
  for (const status of ["pending", "proposed", "committed", "rejected", "unknown"]) {
    it(`reads transaction ${status} without making up outputs or success`, async (t) => {
      offline(t);
      fixture(t, (method) => {
        if (method === "get_transaction") return status === "unknown" ? null : { tx_status: { status, block_hash: status === "committed" ? BLOCK : null }, transaction: null };
        assert.equal(method, "get_header"); return { number: "0x123" };
      });
      const result = await inspectLockTransaction(HASH, { version: 1, genesisHash: BLOCK, operations: [], tests: [] });
      assert.equal(result.status, status);
      assert.equal(result.blockNumber, status === "committed" ? "291" : null);
      assert.deepEqual(result.outputs, []);
      assert.equal(result.verified, false);
      assert.equal(result.checks.correctLockScriptUsed, null);
    });
  }
  it("requires creation commitment and checks liveness before spending", async (t) => {
    offline(t);
    fixture(t, () => ({ tx_status: { status: "pending" } }));
    await assert.rejects(liveLockCell(point), rejects("CREATION_NOT_COMMITTED"));
    fixture(t, () => ({ tx_status: { status: "committed" } }));
    t.mock.method(client, "getCellLiveNoCache", async () => undefined);
    await assert.rejects(liveLockCell(point), rejects("CELL_NOT_LIVE"));
    const owner = await accountLock();
    const wrongDataCell = ccc.Cell.from({ outPoint: point, cellOutput: { capacity: 10000000000n, lock: owner.script }, outputData: "0x" });
    t.mock.method(client, "getCellLiveNoCache", async () => wrongDataCell);
    await assert.rejects(liveLockCell(point), rejects("LOCK_CELL_MISMATCH"));
  });
  for (const originalStatus of ["unknown", "dead", "live"]) {
    it(`requires committed consumption evidence even when original Cell is ${originalStatus}`, async (t) => {
      offline(t);
      const owner = await accountLock();
      const receiver = await ccc.Address.fromString(offckb.accounts[1].address, client);
      const tx = ccc.Transaction.from({ inputs: [{ previousOutput: point }], outputs: [{ lock: receiver.script, capacity: 9999999000n }], outputsData: ["0x"] });
      const hash = tx.hash();
      const raw = cccA.JsonRpcTransformers.transactionFrom(tx);
      const test: any = { id: "offline-test-key", outPoint: point, passed: true, cellStillLive: true, proof: { validSignature: true, authorized: false } };
      const operation: any = { id: "offline-spend-key", kind: "spend", hash, signedTransaction: ccc.hexFrom(tx.toBytes()), fingerprint: "fixture", sender: owner.toString(), receiver: receiver.toString(), input: point, testId: test.id, createdAt: new Date().toISOString() };
      fixture(t, (method, params) => {
        if (method === "get_transaction") return params[0] === hash ? { tx_status: { status: "committed", block_hash: BLOCK }, transaction: raw } : { tx_status: { status: "committed" }, transaction: { outputs: [{ lock: { code_hash: owner.script.codeHash, hash_type: owner.script.hashType, args: owner.script.args }, type: null }], outputs_data: [LOCK_DATA] } };
        if (method === "get_header") return { number: "0x123" };
        assert.equal(method, "get_live_cell"); return { status: params[0].tx_hash === hash ? "live" : originalStatus, cell: null };
      });
      const store: any = { version: 1, genesisHash: BLOCK, operations: [operation], tests: [test] };
      const result = await inspectLockTransaction(hash, store);
      assert.equal(result.checks.originalCellNoLongerLive, originalStatus !== "live");
      assert.equal(result.verified, originalStatus !== "live");
      assert.equal(result.originalCell?.status, originalStatus);
      assert.equal(result.originalCell?.consumedByCommittedTransaction, hash);
      // A different witness must invalidate journal/chain agreement, even
      // though raw transaction hashes intentionally exclude witnesses.
      raw.witnesses = ["0x1234"];
      const mismatch = await inspectLockTransaction(hash, store);
      assert.equal(mismatch.checks.correctLockScriptUsed, false);
      assert.equal(mismatch.checks.originalCellNoLongerLive, false);
      assert.equal(mismatch.verified, false);
    });
  }
});
