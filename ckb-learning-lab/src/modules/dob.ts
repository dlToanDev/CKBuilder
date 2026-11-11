import { existsSync, mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ccc } from "@ckb-ccc/core";
import { client, parseAddress, rpc } from "../ckb/client.js";
import { assertLiveInputs, buildDobCreate, buildDobTransfer, canSignOwner, cellJson, confirmedConflictingSpend, dobScriptInfo, inspectDobTransaction, liveObject, objectType, ownerOf } from "../ckb/dob.js";
import { scriptJson } from "../ckb/token.js";
import { AppError } from "../errors.js";
import { DOB_PROTOCOL, decodeDob, dobData, encodeDob, fields, hash32, idempotencyKey, objectBody } from "./dob-data.js";
import { assertOtherModuleSettled } from "./transaction-guard.js";

const configFile = fileURLToPath(new URL("../../data/dob-config.json", import.meta.url));
type ObjectRecord = { id: string; creationTxHash: string; dataHex: string };
type Operation = { id: string; kind: "create" | "transfer"; objectId: string; hash: string; sender: string; receiver: string; fingerprint: string; signedTransaction: string; createdAt: string; rejection?: string; conflictTxHash?: string };
type Store = { version: 1; protocol: typeof DOB_PROTOCOL; genesisHash: string; objects: ObjectRecord[]; operations: Operation[] };
const publicOperation = (operation: Operation) => ({
  id: operation.id, kind: operation.kind, objectId: operation.objectId,
  hash: operation.hash, sender: operation.sender, receiver: operation.receiver,
  createdAt: operation.createdAt,
  ...(operation.rejection ? { rejection: operation.rejection } : {}),
  ...(operation.conflictTxHash ? { conflictTxHash: operation.conflictTxHash } : {}),
});

async function readStore(): Promise<Store> {
  const genesis = await rpc<string>("get_block_hash", ["0x0"]);
  if (!existsSync(configFile)) return { version: 1, protocol: DOB_PROTOCOL, genesisHash: genesis, objects: [], operations: [] };
  let saved: Store;
  try {
    saved = JSON.parse(readFileSync(configFile, "utf8"));
    if (saved.version !== 1 || saved.protocol !== DOB_PROTOCOL || !Array.isArray(saved.objects) || !Array.isArray(saved.operations)) throw new Error();
    hash32(saved.genesisHash);
    if (new Set(saved.objects.map((o) => o.id)).size !== saved.objects.length || new Set(saved.operations.map((o) => o.id)).size !== saved.operations.length) throw new Error();
    for (const object of saved.objects) {
      hash32(object.id); hash32(object.creationTxHash); decodeDob(object.dataHex);
      if (!saved.operations.some((op) => op.kind === "create" && op.objectId === object.id && op.hash === object.creationTxHash)) throw new Error();
    }
    for (const op of saved.operations) {
      idempotencyKey(op.id); hash32(op.hash); hash32(op.objectId);
      if (!["create", "transfer"].includes(op.kind) || typeof op.fingerprint !== "string" || !Number.isFinite(Date.parse(op.createdAt))) throw new Error();
      const tx = ccc.Transaction.fromBytes(op.signedTransaction);
      const object = saved.objects.find((entry) => entry.id === op.objectId);
      if (!object || tx.hash() !== op.hash || !tx.outputs[0]?.type?.eq(await objectType(op.objectId)) || tx.outputsData[0] !== object.dataHex) throw new Error();
      if (op.kind === "create" && ccc.hashTypeId(tx.inputs[0], 0) !== op.objectId) throw new Error();
    }
  } catch { throw new AppError(503, "INVALID_DOB_CONFIG", "DOB journal is invalid. Restore data/dob-config.json; it will not be overwritten or used for signing."); }
  if (saved.genesisHash !== genesis) throw new AppError(409, "CHAIN_MISMATCH", "Saved DOBs belong to another Devnet genesis. Restore the matching chain and journal.");
  return saved;
}
function saveStore(state: Store) {
  mkdirSync(dirname(configFile), { recursive: true });
  const fd = openSync(`${configFile}.tmp`, "w", 0o600);
  try { writeFileSync(fd, JSON.stringify(state, null, 2) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(`${configFile}.tmp`, configFile);
}
export async function dobInfo() {
  const state = await readStore();
  return { protocol: DOB_PROTOCOL, label: "Custom Cell + TYPE_ID (not Spore)", metadataLocation: "on-chain UTF-8 JSON", deploymentNeeded: false, scripts: await dobScriptInfo(), objectCount: state.objects.length, operations: state.operations.map(publicOperation) };
}
async function viewObject(id: string, state: Store) {
  const saved = state.objects.find((entry) => entry.id === id);
  const cell = await liveObject(id);
  if (!cell && !saved) throw new AppError(404, "OBJECT_NOT_FOUND", "No live CKBuilder object or local creation record was found for this ID.");
  const creationRaw = saved ? await inspectDobTransaction(saved.creationTxHash) : null;
  const creationRejection = saved ? state.operations.find((op) => op.hash === saved.creationTxHash)?.rejection : undefined;
  const creation = creationRaw?.status === "unknown" && creationRejection ? { ...creationRaw, status: "rejected", reason: creationRejection } : creationRaw;
  if (creation?.status === "committed") {
    const output = creation.outputs.find((output: any) => output.objectId === id);
    if (!output || output.dataHex !== saved!.dataHex) throw new AppError(409, "CREATION_RECORD_MISMATCH", "The saved creation reference does not match its committed on-chain object.");
  }
  const ownerAddress = cell ? ownerOf(cell) : null;
  const transaction = cell ? (cell.outPoint.txHash === creation?.hash ? creation : await inspectDobTransaction(cell.outPoint.txHash)) : creation;
  return {
    id, protocol: DOB_PROTOCOL, typeScript: scriptJson(await objectType(id)),
    dataSource: cell ? "on-chain live Cell" : "local creation record; no live Cell verified",
    data: cell ? decodeDob(cell.outputData) : null,
    localMetadata: saved ? decodeDob(saved.dataHex) : null,
    dataMatchesCreation: cell && saved ? cell.outputData === saved.dataHex : null,
    ownerAddress, canTransfer: Boolean(cell && saved && cell.outputData === saved.dataHex && ownerAddress && await canSignOwner(ownerAddress)),
    creationTxHash: saved?.creationTxHash ?? null, creationStatus: creation?.status ?? "unknown",
    creationReferenceSource: saved ? "local journal, checked against creation transaction when committed" : "not recorded locally",
    status: cell ? transaction!.status : creation?.status === "committed" ? "no_live_cell" : creation?.status ?? "unknown",
    cell: cell ? cellJson(cell) : null,
    transaction,
  };
}
export async function getDob(value: string) { return viewObject(hash32(value), await readStore()); }
export async function listDobs() {
  const state = await readStore();
  const objects = [];
  for (const record of state.objects) {
    try { objects.push(await viewObject(record.id, state)); }
    catch (error) {
      if (!(error instanceof AppError) || ![404, 409, 422].includes(error.status)) throw error;
      // Do not substitute a saved owner when the live state cannot be verified.
      objects.push({ id: record.id, ownerAddress: null, canTransfer: false, data: null, status: "unverified", error: error.message, creationTxHash: record.creationTxHash });
    }
  }
  return { protocol: DOB_PROTOCOL, objects };
}
export async function dobTransaction(value: string) {
  const hash = hash32(value);
  const state = await readStore();
  const operation = state.operations.find((entry) => entry.hash === hash);
  const transaction = await inspectDobTransaction(hash);
  const status = transaction.status === "unknown" && operation?.rejection ? "rejected" : transaction.status;
  return { ...transaction, status, reason: status === "rejected" ? operation?.rejection ?? transaction.reason : transaction.reason, operation: operation ? publicOperation(operation) : null };
}
async function broadcast(operation: Operation) {
  let transaction = await dobTransaction(operation.hash);
  if (transaction.status === "unknown") {
    const signed = ccc.Transaction.fromBytes(operation.signedTransaction);
    const conflictTxHash = await confirmedConflictingSpend(signed);
    // The original may have committed while inspecting its inputs.
    transaction = await dobTransaction(operation.hash);
    if (transaction.status !== "unknown") return { operation: publicOperation(operation), transaction };
    if (conflictTxHash) {
      operation = { ...operation, conflictTxHash, rejection: `This signed transaction cannot commit: a different confirmed transaction ${conflictTxHash} spent one of its inputs. Reconciled locally from committed chain evidence.` };
      const state = await readStore();
      saveStore({ ...state, operations: state.operations.map((entry) => entry.hash === operation.hash ? operation : entry) });
      return { operation: publicOperation(operation), transaction: await dobTransaction(operation.hash) };
    }
    await assertLiveInputs(signed);
    try {
      // TYPE_ID outputs are custom outputs: use CKB's passthrough policy validator.
      await client.sendTransaction(signed, "passthrough");
    } catch (error) {
      if (error instanceof ccc.ErrorClientVerification) {
        operation = { ...operation, rejection: "The node rejected the signed DOB transaction during script verification. Inspect its inputs and dependencies." };
        const state = await readStore();
        saveStore({ ...state, operations: state.operations.map((entry) => entry.hash === operation.hash ? operation : entry) });
      }
      // Transport/pool failures are uncertain; never guess commitment or rebuild.
      if (!(error instanceof ccc.ErrorClientDuplicatedTransaction)) {
        transaction = await dobTransaction(operation.hash);
        return { operation: publicOperation(operation), transaction, message: "Submission was not acknowledged. Inspect the saved hash; Retry same submission reuses the exact signed bytes and request key." };
      }
    }
    transaction = await dobTransaction(operation.hash);
  }
  return { operation: publicOperation(operation), transaction };
}
export async function mutateDob(kind: "create" | "transfer", body: unknown, key: unknown) {
  objectBody(body);
  const id = idempotencyKey(key);
  let data, objectId = "", receiver = "";
  if (kind === "create") data = dobData(body);
  else {
    fields(body, ["objectId", "receiver"]);
    objectId = hash32(body.objectId);
    receiver = (await parseAddress(body.receiver)).toString();
  }
  const fingerprint = JSON.stringify({ kind, ...(data ? { data } : { objectId, receiver }) });
  const state = await readStore();
  const previous = state.operations.find((entry) => entry.id === id);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This request key belongs to another payload. Inspect the original operation.");
    return broadcast(previous);
  }
  await assertOtherModuleSettled("dob");
  for (const operation of state.operations) {
    const tx = await dobTransaction(operation.hash);
    if (!["committed", "rejected"].includes(tx.status)) throw new AppError(409, "PENDING_TRANSACTION", `An earlier DOB transaction is ${tx.status}: ${operation.hash}. Verify or retry its original submission first.`);
  }
  const record = state.objects.find((entry) => entry.id === objectId);
  if (kind === "transfer" && !record) throw new AppError(404, "OBJECT_NOT_REGISTERED", "Transfer requires this object's saved creation journal.");
  if (record && (await inspectDobTransaction(record.creationTxHash)).status !== "committed") throw new AppError(409, "CREATION_NOT_COMMITTED", "The object's creation must be committed before transfer.");
  const built = kind === "create" ? await buildDobCreate(data!, state.objects.map((object) => object.id)) : await buildDobTransfer(objectId, receiver, record!.dataHex);
  if (kind === "create" && state.objects.some((object) => object.id === built.id)) throw new AppError(409, "OBJECT_ID_ALREADY_RECORDED", "This TYPE_ID is already in the journal. No new record or transaction was submitted.");
  const operation: Operation = { id, kind, objectId: built.id, hash: built.signed.hash(), sender: built.sender, receiver: built.receiver, fingerprint, signedTransaction: ccc.hexFrom(built.signed.toBytes()), createdAt: new Date().toISOString() };
  saveStore({ ...state, objects: kind === "create" ? [...state.objects, { id: built.id, creationTxHash: operation.hash, dataHex: encodeDob(data!) }] : state.objects, operations: [...state.operations, operation] });
  return broadcast(operation);
}
