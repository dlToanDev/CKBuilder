import { ccc } from "@ckb-ccc/core";
import { client, offckb, parseAddress, rpc } from "./client.js";
import { getDevnetSigner } from "./signer.js";
import { AppError } from "../errors.js";

export const MAX_AMOUNT = (1n << 128n) - 1n;
export function parseAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,38}$/.test(value)) {
    throw new AppError(400, "INVALID_AMOUNT", "Amount must be a positive whole-number string (no decimals or exponent notation).");
  }
  const amount = BigInt(value);
  if (amount > MAX_AMOUNT) throw new AppError(400, "INVALID_AMOUNT", "Amount exceeds the unsigned 128-bit limit.");
  return amount;
}
export function encodeAmount(amount: bigint) {
  if (amount < 0n || amount > MAX_AMOUNT) throw new RangeError("Token Cell amount must fit an unsigned 128-bit integer.");
  return ccc.hexFrom(ccc.numToBytes(amount, 16));
}
export function decodeAmount(data: string): bigint {
  if (!/^0x[0-9a-fA-F]{32}([0-9a-fA-F]{2})*$/.test(data)) {
    throw new AppError(422, "INVALID_CELL_DATA", "A token Cell has invalid uint128 amount data.");
  }
  return ccc.numFromBytes(data.slice(0, 34));
}
export const scriptJson = (script: ccc.Script) => ({ codeHash: script.codeHash, hashType: script.hashType, args: script.args });

export async function tokenIdentity() {
  const owner = await parseAddress(offckb.accounts[0].address);
  const info = await client.getKnownScript(ccc.KnownScript.SUdt);
  const type = ccc.Script.from({ codeHash: info.codeHash, hashType: info.hashType, args: owner.script.hash() });
  return { owner, info, type };
}

export async function checkDependencies() {
  const { info } = await tokenIdentity();
  for (const script of [info, await client.getKnownScript(ccc.KnownScript.Secp256k1Blake160)]) {
    for (const { cellDep } of script.cellDeps) {
      const cell = await client.getCellLiveNoCache(cellDep.outPoint, true);
      if (!cell) throw new AppError(503, "MISSING_SCRIPT_DEPENDENCY", "A required sUDT or signing dependency is not live on this Devnet.");
      if (script === info && (!cell.cellOutput.type || cell.cellOutput.type.hash() !== info.codeHash)) {
        throw new AppError(503, "SCRIPT_MISMATCH", "The live sUDT deployment does not match OffCKB's script configuration.");
      }
    }
  }
  return info;
}

// Queries use the node's indexer and exactly match both the lock and UDT type.
export async function tokenBalance(address: string, type: ccc.Script) {
  const owner = await parseAddress(address);
  let balance = 0n;
  const cells = [];
  for await (const cell of client.findCellsByLock(owner.script, type, true)) {
    if (!cell.cellOutput.lock.eq(owner.script) || !cell.cellOutput.type?.eq(type)) continue;
    const amount = decodeAmount(cell.outputData);
    balance += amount;
    cells.push({ txHash: cell.outPoint.txHash, index: cell.outPoint.index, amount: amount.toString(), data: cell.outputData, capacityShannon: cell.cellOutput.capacity.toString() });
  }
  return { address, balance: balance.toString(), cells };
}

export async function buildTokenTransaction(kind: "mint" | "transfer", amount: bigint, receiver: string, type: ccc.Script) {
  await checkDependencies();
  const signer = getDevnetSigner();
  const owner = await signer.getRecommendedAddressObj();
  if (!owner.script.eq((await parseAddress(offckb.accounts[0].address)).script)) {
    throw new AppError(503, "SIGNER_MISMATCH", "The configured development key does not belong to OffCKB Account #0.");
  }
  const to = await parseAddress(receiver);
  const tx = ccc.Transaction.from({
    outputs: [{ lock: to.script, type, capacity: 0n }],
    outputsData: [encodeAmount(amount)],
  });
  await tx.addCellDepsOfKnownScripts(client, ccc.KnownScript.SUdt);
  if (kind === "transfer") {
    const balance = await tokenBalance(owner.toString(), type);
    if (BigInt(balance.balance) < amount) throw new AppError(422, "INSUFFICIENT_TOKEN_BALANCE", "Insufficient token balance.");
    await tx.completeInputsByUdt(signer, type);
    const change = await tx.getInputsUdtBalance(client, type) - amount;
    if (change > 0n) {
      const data = encodeAmount(change);
      tx.outputs.push(ccc.CellOutput.from({ lock: owner.script, type, capacity: 0n }, data));
      tx.outputsData.push(data);
    }
  }
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000n);
  return signer.signTransaction(tx);
}

// No cache is used for transaction status; committed is solely an RPC result.
export async function inspectTransaction(hash: string, type: ccc.Script) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new AppError(400, "INVALID_HASH", "Expected a 32-byte transaction hash.");
  const result = await rpc("get_transaction", [hash]);
  if (!result) return { hash, status: "unknown", blockNumber: null, outputs: [] };
  const status = result.tx_status.status as string;
  let blockNumber: string | null = null;
  if (status === "committed" && result.tx_status.block_hash) {
    const header = await rpc("get_header", [result.tx_status.block_hash]);
    if (header) blockNumber = BigInt(header.number).toString();
  }
  const transaction = result.transaction;
  const outputs = (transaction?.outputs ?? []).map((output: any, index: number) => {
    const script = output.type ? ccc.Script.from({ codeHash: output.type.code_hash, hashType: output.type.hash_type, args: output.type.args }) : null;
    const data = transaction.outputs_data[index];
    return { index, capacityShannon: BigInt(output.capacity).toString(), lock: output.lock, type: output.type, data, tokenAmount: script?.eq(type) ? decodeAmount(data).toString() : null };
  });
  return { hash, status, blockNumber, blockHash: result.tx_status.block_hash ?? null, reason: status === "rejected" ? "The node rejected this transaction." : null, outputs };
}
