import { existsSync, mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { client, offckb, parseAddress, rpc } from "../ckb/client.js";
import { accountLock, buildLockedCell, buildLockSpend, lockDeployment, testLockAuthorization } from "../ckb/lock-script.js";
import { assertLiveInputs, confirmedConflictingSpend } from "../ckb/dob.js";
import { AppError } from "../errors.js";
import { fields, hash32, idempotencyKey, objectBody } from "./dob-data.js";
import { capacityFrom, LOCK_DATA, lockPoint, type LockPoint } from "./lock-script-data.js";
import { assertOtherModuleSettled } from "./transaction-guard.js";

const configFile = fileURLToPath(new URL("../../data/lock-script-config.json", import.meta.url));
type AuthorizationTest = Awaited<ReturnType<typeof testLockAuthorization>> & { id: string; fingerprint: string };
type Operation = { id: string; kind: "create" | "spend"; hash: string; fingerprint: string; signedTransaction: string; sender: string; receiver: string; input: LockPoint | null; testId: string | null; createdAt: string; rejection?: string };
type Store = { version: 1; genesisHash: string; operations: Operation[]; tests: AuthorizationTest[] };
function publicOperation({ signedTransaction: _signed, fingerprint: _fingerprint, ...operation }: Operation) { return { ...operation, output: { txHash: operation.hash, index: 0 } }; }
async function readStore(): Promise<Store> {
  const genesisHash = await rpc<string>("get_block_hash", ["0x0"]);
  if (!existsSync(configFile)) return { version: 1, genesisHash, operations: [], tests: [] };
  let store: Store;
  try {
    store = JSON.parse(readFileSync(configFile, "utf8"));
    if (store.version !== 1 || !Array.isArray(store.operations) || !Array.isArray(store.tests)) throw new Error();
    hash32(store.genesisHash);
    if (new Set([...store.operations, ...store.tests].map((entry) => entry.id)).size !== store.operations.length + store.tests.length) throw new Error();
    const owner = await accountLock();
    for (const op of store.operations) {
      idempotencyKey(op.id); hash32(op.hash);
      if (!["create", "spend"].includes(op.kind) || typeof op.fingerprint !== "string" || !Number.isFinite(Date.parse(op.createdAt))) throw new Error();
      const tx = ccc.Transaction.fromBytes(op.signedTransaction);
      if (tx.hash() !== op.hash || !tx.outputs[0] || tx.outputs[0].type || op.sender !== owner.toString() || !tx.outputs[0].lock.eq((await parseAddress(op.receiver)).script)) throw new Error();
      if (op.kind === "create" && (op.input !== null || !tx.outputs[0].lock.eq(owner.script) || tx.outputsData[0] !== LOCK_DATA)) throw new Error();
      if (op.kind === "spend") {
        const point = lockPoint(op.input);
        if (tx.inputs.length !== 1 || !tx.inputs[0].previousOutput.eq(point) || tx.outputs.length !== 1 || tx.outputsData[0] !== "0x" || !store.operations.some((entry) => entry.kind === "create" && entry.hash === point.txHash && point.index === 0) || !store.tests.some((test) => test.id === op.testId && test.passed && test.outPoint.txHash === point.txHash && test.outPoint.index === point.index)) throw new Error();
      }
    }
    for (const test of store.tests) {
      idempotencyKey(test.id); lockPoint(test.outPoint);
      if (typeof test.fingerprint !== "string" || typeof test.passed !== "boolean" || test.broadcast !== false || !Number.isFinite(Date.parse(test.testedAt))) throw new Error();
    }
  } catch { throw new AppError(503, "INVALID_LOCK_JOURNAL", "Restore data/lock-script-config.json. An invalid journal will never be overwritten or used for signing."); }
  if (store.genesisHash !== genesisHash) throw new AppError(409, "CHAIN_MISMATCH", "Lock Script history belongs to another Devnet genesis. Restore the matching journal and chain.");
  return store;
}
function saveStore(store: Store) {
  mkdirSync(dirname(configFile), { recursive: true });
  const fd = openSync(`${configFile}.tmp`, "w", 0o600);
  try { writeFileSync(fd, JSON.stringify(store, null, 2) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(`${configFile}.tmp`, configFile);
}
export async function cellStatus(point: LockPoint) {
  const response = await rpc("get_live_cell", [{ tx_hash: point.txHash, index: ccc.numToHex(point.index) }, true]);
  const status = ["live", "dead", "unknown"].includes(response?.status) ? response.status : "unknown";
  return { outPoint: point, status, cell: status === "live" ? response.cell : null };
}
export async function inspectLockTransaction(value: unknown, store?: Store) {
  const hash = hash32(value);
  const state = store ?? await readStore();
  const op = state.operations.find((entry) => entry.hash === hash);
  const raw = await rpc("get_transaction", [hash]);
  const status = ["pending", "proposed", "committed", "rejected"].includes(raw?.tx_status?.status) ? raw.tx_status.status : op?.rejection ? "rejected" : "unknown";
  const header = status === "committed" && raw?.tx_status?.block_hash ? await rpc("get_header", [raw.tx_status.block_hash]) : null;
  const tx = raw?.transaction;
  const outputs = [];
  for (let index = 0; index < (tx?.outputs?.length ?? 0); index++) {
    const output = tx.outputs[index];
    const lock = ccc.Script.from({ codeHash: output.lock.code_hash, hashType: output.lock.hash_type, args: output.lock.args });
    outputs.push({ index, capacityShannon: BigInt(output.capacity).toString(), capacityCkb: ccc.fixedPointToString(BigInt(output.capacity)), destination: ccc.Address.fromScript(lock, client).toString(), lock: { codeHash: lock.codeHash, hashType: lock.hashType, args: lock.args }, scriptHash: lock.hash(), type: output.type, dataHex: tx.outputs_data[index], ...(await cellStatus({ txHash: hash, index })) });
  }
  const originalPoint = op?.kind === "spend" ? op.input : op?.kind === "create" ? { txHash: op.hash, index: 0 } : null;
  const originalCell = originalPoint ? await cellStatus(originalPoint) : null;
  const test = op?.kind === "spend" ? state.tests.find((entry) => entry.id === op.testId) : originalPoint ? state.tests.slice().reverse().find((entry) => entry.outPoint.txHash === originalPoint.txHash && entry.outPoint.index === originalPoint.index) : null;
  let signedTransactionMatches: boolean | null = null;
  if (op && tx) {
    const chainTx = ccc.Transaction.from(cccA.JsonRpcTransformers.transactionTo(tx));
    signedTransactionMatches = ccc.hexFrom(chainTx.toBytes()) === op.signedTransaction;
  }
  let inputUsesOwnerLock: boolean | null = null;
  if (op?.input) {
    const creation = await rpc("get_transaction", [op.input.txHash]);
    const output = creation?.transaction?.outputs?.[op.input.index];
    const owner = (await accountLock()).script;
    inputUsesOwnerLock = creation?.tx_status?.status === "committed" && output?.lock?.code_hash === owner.codeHash && output?.lock?.hash_type === owner.hashType && output?.lock?.args === owner.args && !output?.type && creation.transaction.outputs_data[op.input.index] === LOCK_DATA;
  }
  // Modern CKB returns "unknown" for spent Cells ("dead" is deprecated).
  // A committed, byte-for-byte matching transaction consuming this exact
  // registered outpoint is positive spend evidence; unknown alone is not.
  const committedConsumption = Boolean(op?.kind === "spend" && status === "committed" && header && signedTransactionMatches && inputUsesOwnerLock && tx.inputs.some((input: any) => input.previous_output.tx_hash === op.input!.txHash && BigInt(input.previous_output.index) === BigInt(op.input!.index)));
  const checks = {
    authorizedTransactionCommitted: op?.kind === "spend" ? status === "committed" : null,
    originalCellNoLongerLive: op?.kind === "spend" && status === "committed" ? originalCell?.status !== "live" && committedConsumption : null,
    newOutputExists: op && status === "committed" ? Boolean(outputs[0] && header && signedTransactionMatches) : null,
    newOutputLive: outputs[0] ? outputs[0].status === "live" : null,
    correctLockScriptUsed: op && tx ? signedTransactionMatches && (op.kind === "create" ? outputs[0]?.scriptHash === (await accountLock()).script.hash() : inputUsesOwnerLock) : null,
    unauthorizedFailedAsExpected: test ? test.passed && test.cellStillLive && test.proof.validSignature && !test.proof.authorized : null,
  };
  return { hash, status, blockNumber: header ? BigInt(header.number).toString() : null, blockHash: raw?.tx_status?.block_hash ?? null, reason: status === "rejected" ? op?.rejection ?? "The CKB node rejected this transaction." : null, operation: op ? publicOperation(op) : null, inputs: tx?.inputs ?? [], outputs, cellDeps: tx?.cell_deps ?? [], originalCell: originalCell ? { ...originalCell, consumedByCommittedTransaction: committedConsumption ? hash : null } : null, unauthorizedTest: test ?? null, checks, verified: op?.kind === "spend" && Object.values(checks).every((check) => check === true) };
}
export async function lockInfo() {
  const store = await readStore();
  const transactions = [];
  for (const operation of store.operations) transactions.push(await inspectLockTransaction(operation.hash, store));
  return { ...(await lockDeployment()), accounts: offckb.accounts, operations: store.operations.map(publicOperation), tests: store.tests, transactions };
}
function registeredCell(store: Store, point: LockPoint) {
  if (point.index !== 0 || !store.operations.some((entry) => entry.kind === "create" && entry.hash === point.txHash)) throw new AppError(404, "CELL_NOT_REGISTERED", "Select output 0 of a locked Cell created by this module.");
}
async function assertSettled(store: Store) {
  await assertOtherModuleSettled("lock-script");
  for (const operation of store.operations) {
    const tx = await inspectLockTransaction(operation.hash, store);
    if (!["committed", "rejected"].includes(tx.status)) throw new AppError(409, "PENDING_TRANSACTION", `An earlier Lock Script transaction is ${tx.status}: ${operation.hash}. Inspect or retry the same submission first.`);
  }
}
async function broadcast(operation: Operation, store: Store) {
  let transaction = await inspectLockTransaction(operation.hash, store);
  if (transaction.status === "unknown") {
    await assertOtherModuleSettled("lock-script");
    const signed = ccc.Transaction.fromBytes(operation.signedTransaction);
    const conflict = await confirmedConflictingSpend(signed);
    transaction = await inspectLockTransaction(operation.hash, store);
    if (transaction.status !== "unknown") return { operation: publicOperation(operation), transaction };
    if (conflict) {
      operation.rejection = `A different committed transaction ${conflict} spent an input. Reconciled from chain evidence.`;
      saveStore(store);
    } else {
      await assertLiveInputs(signed);
      try { await client.sendTransaction(signed); }
      catch (error) {
        if (error instanceof ccc.ErrorClientVerification) {
          operation.rejection = "The node rejected the signed transaction during script verification.";
          saveStore(store);
        }
        if (!(error instanceof ccc.ErrorClientDuplicatedTransaction)) return { operation: publicOperation(operation), transaction: await inspectLockTransaction(operation.hash, store), message: "Submission not acknowledged. Inspect the saved hash or retry the exact same request; never create a replacement blindly." };
      }
    }
    transaction = await inspectLockTransaction(operation.hash, store);
  }
  return { operation: publicOperation(operation), transaction };
}
export async function mutateLock(kind: "create" | "spend" | "test-unauthorized", body: unknown, key: unknown) {
  objectBody(body);
  fields(body, kind === "create" ? ["ownerAccount", "capacity"] : kind === "spend" ? ["outPoint", "receiver"] : ["outPoint"]);
  const id = idempotencyKey(key);
  let capacity: bigint | undefined, point: LockPoint | undefined, receiver: string | undefined;
  if (kind === "create") {
    if (body.ownerAccount !== 0) throw new AppError(400, "INVALID_OWNER", "Select Account #0 as the authorized owner.");
    capacity = capacityFrom(body.capacity);
  } else {
    point = lockPoint(body.outPoint);
    if (kind === "spend") receiver = (await parseAddress(body.receiver)).toString();
  }
  const fingerprint = JSON.stringify({ kind, capacity: capacity?.toString(), point, receiver });
  const store = await readStore();
  const previous = [...store.operations, ...store.tests].find((entry) => entry.id === id);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This request key already belongs to another payload.");
    if ("signedTransaction" in previous) return broadcast(previous, store);
    return { test: previous };
  }
  await assertSettled(store);
  if (point) registeredCell(store, point);
  if (kind === "test-unauthorized") {
    const test = { ...(await testLockAuthorization(point!)), id, fingerprint };
    store.tests.push(test); saveStore(store);
    return { test };
  }
  const test = point ? store.tests.slice().reverse().find((entry) => entry.passed && entry.outPoint.txHash === point.txHash && entry.outPoint.index === point.index) : undefined;
  if (kind === "spend" && !test) throw new AppError(409, "UNAUTHORIZED_TEST_REQUIRED", "Complete the expected unauthorized dry-run failure on this Cell before authorized spending.");
  const built = kind === "create" ? await buildLockedCell(capacity!) : await buildLockSpend(point!, receiver!);
  const operation: Operation = { id, kind, hash: built.signed.hash(), fingerprint, signedTransaction: ccc.hexFrom(built.signed.toBytes()), sender: built.sender, receiver: built.receiver, input: point ?? null, testId: test?.id ?? null, createdAt: new Date().toISOString() };
  // Persist signed bytes and their real calculated hash before sending anything.
  store.operations.push(operation); saveStore(store);
  return broadcast(operation, store);
}
