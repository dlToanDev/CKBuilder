import { ccc } from "@ckb-ccc/core";
import { AppError } from "../errors.js";
import { fields, hash32, objectBody } from "./dob-data.js";

// Nonempty data prevents existing plain-Cell funding collectors from consuming
// the exercise Cell. This marker is an application convention, not a contract.
export const LOCK_DATA = "0x4c";
export const LOCK_FEE_RATE = 1000n;
export type LockPoint = { txHash: string; index: number };
export function lockPoint(value: unknown): LockPoint {
  objectBody(value); fields(value, ["txHash", "index"]);
  const txHash = hash32(value.txHash);
  if (!Number.isInteger(value.index) || (value.index as number) < 0 || (value.index as number) > 0xffffffff) throw new AppError(400, "INVALID_OUTPOINT", "Output index must be a uint32 integer.");
  return { txHash, index: value.index as number };
}
export function capacityFrom(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 24 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(value)) throw new AppError(400, "INVALID_CAPACITY", "Capacity must be a positive decimal CKB string with at most 8 fractional digits.");
  const capacity = ccc.fixedPointFrom(value);
  if (capacity <= 0n || capacity > 0xffffffffffffffffn) throw new AppError(400, "INVALID_CAPACITY", "Capacity must fit a positive uint64 in Shannon.");
  return capacity;
}
export function minimumCapacity(lock: ccc.Script, data = LOCK_DATA) {
  return ccc.fixedPointFrom(ccc.CellOutput.from({ capacity: 0n, lock }).occupiedSize + ccc.bytesFrom(data).length);
}
export function signatureProof(message: ccc.Hex, signature: ccc.Hex, publicKey: ccc.Hex, expectedArgs: ccc.Hex) {
  if (ccc.bytesFrom(signature).length !== 65) throw new AppError(422, "INVALID_SIGNATURE", "A recoverable Secp256k1 signature must contain 65 bytes.");
  const validSignature = ccc.verifyMessageSecp256k1(message, signature, publicKey);
  const recoveredPublicKey = ccc.recoverMessageSecp256k1(message, signature);
  const recoveredArgs = ccc.hashCkb(recoveredPublicKey).slice(0, 42);
  return { validSignature, recoveredPublicKey, recoveredArgs, expectedArgs, authorized: validSignature && recoveredArgs === expectedArgs };
}
export function expectedLockFailure(error: unknown, position: number): boolean {
  // Neither transport errors, missing deps, unsigned witnesses nor unrelated
  // script failures count as an authorization rejection.
  objectBody(error);
  const text = `${typeof error.message === "string" ? error.message : ""} ${typeof error.data === "string" ? error.data : JSON.stringify(error.data ?? null)}`;
  return error.code === -302 && /ValidationFailure/.test(text) && /(?:error code|code)\s*[:=]?\s*-31\b/i.test(text)
    && new RegExp(`Inputs\\[${position}\\]\\.Lock|input\\s*\\[${position}\\].*lock`, "i").test(text);
}
