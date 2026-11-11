import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { client, offckb, parseAddress, rpc } from "./client.js";
import { getDevnetSigner } from "./signer.js";
import { scriptJson } from "./token.js";
import { AppError } from "../errors.js";
import { decodeDob, encodeDob, hash32, type DobData } from "../modules/dob-data.js";

export async function dobScriptInfo() {
  // Require the actual local export; never fall back to public-network contracts.
  const local = offckb.scripts[ccc.KnownScript.TypeId];
  if (!local) throw new AppError(503, "TYPE_ID_UNAVAILABLE", "OffCKB did not export the built-in TYPE_ID script.");
  const typeId = ccc.ScriptInfo.from(local);
  const lock = await client.getKnownScript(ccc.KnownScript.Secp256k1Blake160);
  for (const { cellDep } of lock.cellDeps) {
    if (!await client.getCellLiveNoCache(cellDep.outPoint, true)) throw new AppError(503, "MISSING_SCRIPT_DEPENDENCY", "OffCKB's secp256k1 signing dependency is not live.");
  }
  return { typeId, lock };
}
export async function objectType(id: string) {
  const local = offckb.scripts[ccc.KnownScript.TypeId];
  if (!local) throw new AppError(503, "TYPE_ID_UNAVAILABLE", "OffCKB TYPE_ID configuration is missing.");
  return ccc.Script.from({ codeHash: local.codeHash, hashType: local.hashType, args: hash32(id) });
}
export function outPointJson(point: ccc.OutPoint) { return { txHash: point.txHash, index: Number(point.index) }; }
export function cellJson(cell: ccc.Cell) {
  return { outPoint: outPointJson(cell.outPoint), capacityShannon: cell.cellOutput.capacity.toString(), capacityCkb: ccc.fixedPointToString(cell.cellOutput.capacity), lock: scriptJson(cell.cellOutput.lock), type: cell.cellOutput.type ? scriptJson(cell.cellOutput.type) : null, data: cell.outputData };
}
export async function liveObject(id: string): Promise<ccc.Cell | null> {
  const type = await objectType(id);
  const tip = BigInt(await rpc<string>("get_tip_block_number"));
  const indexed = await rpc("get_indexer_tip");
  if (!indexed || BigInt(indexed.block_number) < tip) throw new AppError(503, "INDEXER_SYNCING", "The local indexer is catching up. Refresh before checking ownership or transferring.");
  const result = await rpc("get_cells", [{ script: { code_hash: type.codeHash, hash_type: type.hashType, args: type.args }, script_type: "type", script_search_mode: "exact", with_data: true }, "asc", "0x2"]);
  if (result.objects.length > 1) throw new AppError(409, "NON_UNIQUE_OBJECT", "More than one Cell matched this TYPE_ID. Refusing to select an owner.");
  if (!result.objects.length) return null;
  const indexedCell = result.objects[0];
  const point = { txHash: indexedCell.out_point.tx_hash, index: indexedCell.out_point.index };
  const cell = await client.getCellLiveNoCache(point, true);
  if (!cell || !cell.cellOutput.type?.eq(type)) throw new AppError(409, "STALE_OBJECT_CELL", "The indexed object Cell is no longer live. Refresh after the indexer catches up.");
  const tx = await rpc("get_transaction", [point.txHash]);
  if (tx?.tx_status.status !== "committed") throw new AppError(409, "OBJECT_NOT_COMMITTED", "The current object Cell is not confirmed by the node.");
  decodeDob(cell.outputData);
  return cell;
}
export function ownerOf(cell: ccc.Cell) { return ccc.Address.fromScript(cell.cellOutput.lock, client).toString(); }
export async function canSignOwner(address: string) {
  const owner = await parseAddress(address);
  for (const account of offckb.accounts) {
    if ((await parseAddress(account.address)).script.eq(owner.script)) return existsSync(join(homedir(), `.config/offckb/devnet-account-${account.account}.key`));
  }
  return false;
}
async function signerFor(address: string) {
  const owner = await parseAddress(address);
  const account = offckb.accounts.find((account) => account.address === address);
  if (!account || !await canSignOwner(address)) throw new AppError(403, "OWNER_KEY_UNAVAILABLE", "This owner's authorized development key is unavailable on the backend. Account #0 uses the existing key; Account #1 optionally uses devnet-account-1.key in the same private OffCKB directory.");
  let signer: ccc.SignerCkbPrivateKey;
  try {
    signer = account.account === 0 ? getDevnetSigner() : new ccc.SignerCkbPrivateKey(client, readFileSync(join(homedir(), ".config/offckb/devnet-account-1.key"), "utf8").trim());
  } catch { throw new AppError(503, "INVALID_OWNER_KEY", "The backend development key could not be read or parsed."); }
  if (!(await signer.getRecommendedAddressObj()).script.eq(owner.script)) throw new AppError(503, "SIGNER_MISMATCH", "The backend key does not match the current owner's lock.");
  return signer;
}
// A rejected creation may leave its first input unspent. Reusing that input at
// output 0 recreates the same TYPE_ID, so retain every recorded ID as reserved.
export async function selectCreationFirstInput(tx: ccc.Transaction, reservedIds: readonly string[], candidates: AsyncIterable<ccc.Cell>) {
  const reserved = new Set(reservedIds);
  const moveFirst = (index: number) => {
    if (index > 0) [tx.inputs[0], tx.inputs[index]] = [tx.inputs[index], tx.inputs[0]];
    return ccc.hashTypeId(tx.inputs[0], 0);
  };
  const available = tx.inputs.findIndex((input) => !reserved.has(ccc.hashTypeId(input, 0)));
  if (available >= 0) return moveFirst(available);
  for await (const cell of candidates) {
    if (cell.cellOutput.type || cell.outputData !== "0x" || tx.inputs.some((input) => input.previousOutput.eq(cell.outPoint))) continue;
    const input = ccc.CellInput.from({ previousOutput: cell.outPoint, since: 0n });
    if (reserved.has(ccc.hashTypeId(input, 0))) continue;
    tx.addInput(cell);
    return moveFirst(tx.inputs.length - 1);
  }
  throw new AppError(409, "NO_FRESH_TYPE_ID_INPUT", "Available funding inputs would reuse a recorded object ID. Fund Account #0 with a new plain Cell before creating another object.");
}
export async function buildDobCreate(data: DobData, reservedIds: readonly string[] = []) {
  const { typeId } = await dobScriptInfo();
  // New operations use chain funding, not cached change spent by another tool.
  await client.cache.clear();
  const signer = await signerFor(offckb.accounts[0].address);
  const owner = await signer.getRecommendedAddressObj();
  // Reserve the final 32-byte args before calculating occupied capacity.
  const type = ccc.Script.from({ codeHash: typeId.codeHash, hashType: typeId.hashType, args: `0x${"00".repeat(32)}` });
  const tx = ccc.Transaction.from({ outputs: [{ lock: owner.script, type, capacity: 0n }], outputsData: [encodeDob(data)] });
  await tx.completeInputsByCapacity(signer);
  if (!tx.inputs[0]) throw new AppError(422, "MISSING_FUNDING_INPUT", "No spendable funding Cell was selected.");
  const id = await selectCreationFirstInput(tx, reservedIds, signer.findCells({ scriptLenRange: [0, 1], outputDataLenRange: [0, 1] }, true));
  tx.outputs[0].type = ccc.Script.from({ ...scriptJson(type), args: id });
  await tx.completeFeeBy(signer, 1000n);
  if (ccc.hashTypeId(tx.inputs[0], 0) !== id) throw new AppError(409, "TYPE_ID_INPUT_CHANGED", "Funding changed the first input; refusing an invalid TYPE_ID creation.");
  const signed = await signer.signTransaction(tx);
  await assertLiveInputs(signed);
  return { signed, id, sender: owner.toString(), receiver: owner.toString() };
}
export async function buildDobTransfer(id: string, receiver: string, expectedData: string) {
  await dobScriptInfo();
  await client.cache.clear();
  const cell = await liveObject(id);
  if (!cell) throw new AppError(404, "OBJECT_NOT_LIVE", "No live object Cell exists for this ID.");
  if (cell.outputData !== expectedData) throw new AppError(409, "OBJECT_DATA_CHANGED", "On-chain data differs from the saved creation data. Inspect it before transferring.");
  const sender = ownerOf(cell);
  const signer = await signerFor(sender);
  const to = await parseAddress(receiver);
  if (to.script.eq(cell.cellOutput.lock)) throw new AppError(400, "SAME_OWNER", "Choose a different receiver.");
  const tx = ccc.Transaction.from({ outputs: [{ capacity: cell.cellOutput.capacity, lock: to.script, type: cell.cellOutput.type }], outputsData: [cell.outputData] });
  tx.addInput(cell);
  // Preserve the object's capacity; the current owner pays fees from plain Cells.
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000n);
  const signed = await signer.signTransaction(tx);
  if (!signed.outputs[0].type?.eq(cell.cellOutput.type!) || signed.outputsData[0] !== cell.outputData) throw new AppError(409, "OBJECT_CHANGED", "Transfer must preserve the object's TYPE_ID and exact data bytes.");
  await assertLiveInputs(signed);
  return { signed, id, sender, receiver: to.toString() };
}
export async function assertLiveInputs(tx: ccc.Transaction) {
  for (const input of tx.inputs) {
    if (!await client.getCellLiveNoCache(input.previousOutput, false)) {
      await client.cache.markUnusable(input.previousOutput);
      throw new AppError(409, "INPUT_NOT_LIVE", "A selected input is no longer live. Inspect the saved transaction before retrying.");
    }
  }
}
// Used only by an explicit POST retry. Missing Cells alone do not prove a
// rejection: require an actual different, committed transaction spending one.
export async function confirmedConflictingSpend(tx: ccc.Transaction): Promise<string | null> {
  for (const input of tx.inputs) {
    const point = input.previousOutput;
    if (await client.getCellLiveNoCache(point, false)) continue;
    const previous = await rpc("get_transaction", [point.txHash]);
    if (previous?.tx_status.status !== "committed") continue;
    const output = previous.transaction?.outputs[Number(point.index)];
    if (!output) continue;
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 4; page++) {
      const result = await rpc("get_transactions", [{ script: output.lock, script_type: "lock", script_search_mode: "exact", group_by_transaction: true }, "desc", "0x32", ...(cursor ? [cursor] : [])]);
      for (const entry of result.objects) {
        if (entry.tx_hash === tx.hash() || seen.has(entry.tx_hash) || !entry.cells.some(([kind]: [string, string]) => kind === "input")) continue;
        seen.add(entry.tx_hash);
        const candidate = await rpc("get_transaction", [entry.tx_hash]);
        if (candidate?.tx_status.status === "committed" && candidate.transaction?.inputs.some((other: any) => other.previous_output.tx_hash === point.txHash && BigInt(other.previous_output.index) === point.index)) return entry.tx_hash;
      }
      if (!result.objects.length || result.last_cursor === cursor) break;
      cursor = result.last_cursor;
    }
  }
  return null;
}
export async function inspectDobTransaction(value: string) {
  const hash = hash32(value);
  const result = await rpc("get_transaction", [hash]);
  if (!result) return { hash, status: "unknown", blockNumber: null, blockHash: null, reason: null, inputs: [], outputs: [], cellDeps: [] };
  const nodeStatus = result.tx_status.status;
  const status = ["pending", "proposed", "committed", "rejected"].includes(nodeStatus) ? nodeStatus : "unknown";
  const header = status === "committed" && result.tx_status.block_hash ? await rpc("get_header", [result.tx_status.block_hash]) : null;
  const transaction = result.transaction;
  const local = offckb.scripts[ccc.KnownScript.TypeId];
  const outputs = (transaction?.outputs ?? []).map((output: any, index: number) => {
    const type = output.type;
    const isObject = local && type?.code_hash === local.codeHash && type.hash_type === local.hashType && /^0x[0-9a-f]{64}$/i.test(type.args);
    let data = null;
    if (isObject) { try { data = decodeDob(transaction.outputs_data[index]); } catch { /* Other TYPE_ID Cells need not be CKBuilder objects. */ } }
    return { index, capacityShannon: BigInt(output.capacity).toString(), ownerAddress: ccc.Address.fromScript({ codeHash: output.lock.code_hash, hashType: output.lock.hash_type, args: output.lock.args }, client).toString(), lock: output.lock, type, dataHex: transaction.outputs_data[index], objectId: data ? type.args : null, objectData: data };
  });
  return { hash, status, blockNumber: header ? BigInt(header.number).toString() : null, blockHash: result.tx_status.block_hash ?? null, reason: status === "rejected" ? "The CKB node rejected this transaction." : null, inputs: transaction?.inputs ?? [], outputs, cellDeps: transaction?.cell_deps ?? [] };
}
