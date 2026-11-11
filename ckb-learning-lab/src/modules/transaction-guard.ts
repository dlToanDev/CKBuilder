import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rpc } from "../ckb/client.js";
import { AppError } from "../errors.js";

let busy = false;
// All lessons share Account #0's plain funding Cells. Serialize their builders.
export async function withTransactionLock<T>(action: () => Promise<T>): Promise<T> {
  if (busy) throw new AppError(409, "OPERATION_IN_PROGRESS", "Another transaction is being prepared. Wait and refresh its status.");
  busy = true;
  try { return await action(); } finally { busy = false; }
}
export async function assertOtherModuleSettled(module: "dob" | "token" | "lock-script") {
 for (const other of ["token", "dob", "lock-script"] as const) {
  if (other === module) continue;
  const file = fileURLToPath(new URL(`../../data/${other}-config.json`, import.meta.url));
  if (!existsSync(file)) continue;
  let operations: { hash: string; rejection?: string }[];
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(saved.operations) || saved.operations.some((op: any) => !/^0x[0-9a-f]{64}$/i.test(op.hash))) throw new Error();
    operations = saved.operations;
  } catch { throw new AppError(503, "INVALID_OPERATION_JOURNAL", "Restore the other module's operation journal before signing."); }
  for (const operation of operations) {
    const tx = await rpc("get_transaction", [operation.hash]);
    const nodeStatus = tx?.tx_status?.status ?? "unknown";
    const status = nodeStatus === "unknown" && operation.rejection ? "rejected" : nodeStatus;
    if (!["committed", "rejected"].includes(status)) throw new AppError(409, "PENDING_TRANSACTION", `The ${other} module has a ${status} transaction: ${operation.hash}. Inspect it before spending shared funding Cells.`);
  }
 }
}
