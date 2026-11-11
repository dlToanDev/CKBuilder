import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { client, offckb, parseAddress, rpc, RPC_URL } from "./client.js";
import { getDevnetSigner } from "./signer.js";
import { assertLiveInputs, outPointJson } from "./dob.js";
import { scriptJson } from "./token.js";
import { AppError } from "../errors.js";
import { expectedLockFailure, LOCK_DATA, LOCK_FEE_RATE, minimumCapacity, signatureProof, type LockPoint } from "../modules/lock-script-data.js";

export async function accountLock() {
  const owner = await parseAddress(offckb.accounts[0].address);
  const local = offckb.scripts[ccc.KnownScript.Secp256k1Blake160];
  if (!local || owner.script.codeHash !== local.codeHash || owner.script.hashType !== local.hashType || ccc.bytesFrom(owner.script.args).length !== 20) throw new AppError(503, "LOCK_CONFIG_MISMATCH", "Account #0 must use the Secp256k1 lock exported by this OffCKB Devnet.");
  return owner;
}
async function ownerSigner() {
  const owner = await accountLock();
  let signer: ccc.SignerCkbPrivateKey;
  try { signer = getDevnetSigner(); }
  catch { throw new AppError(503, "OWNER_KEY_UNAVAILABLE", "Configure the backend-only OffCKB Account #0 key file before signing."); }
  if (!(await signer.getRecommendedAddressObj()).script.eq(owner.script)) throw new AppError(503, "SIGNER_MISMATCH", "The backend Account #0 key does not match the configured Devnet account.");
  return signer;
}
async function unauthorizedSigner() {
  const file = join(homedir(), ".config/offckb/devnet-account-1.key");
  if (!existsSync(file)) return { signer: new ccc.SignerCkbPrivateKey(client, randomBytes(32)), label: "Ephemeral unauthorized backend key (Account #1 key file unavailable)" };
  let signer: ccc.SignerCkbPrivateKey;
  try { signer = new ccc.SignerCkbPrivateKey(client, readFileSync(file, "utf8").trim()); }
  catch { throw new AppError(503, "UNAUTHORIZED_KEY_INVALID", "The optional Account #1 backend key file is invalid."); }
  if (!(await signer.getRecommendedAddressObj()).script.eq((await parseAddress(offckb.accounts[1].address)).script)) throw new AppError(503, "SIGNER_MISMATCH", "The backend Account #1 key does not match OffCKB.");
  return { signer, label: "Account #1" };
}
export async function lockDeployment() {
  const owner = await accountLock();
  const info = await client.getKnownScript(ccc.KnownScript.Secp256k1Blake160);
  const dependencies = [];
  let deploymentMatched = false;
  for (const { cellDep } of info.cellDeps) {
    const cell = await client.getCellLiveNoCache(cellDep.outPoint, true);
    if (!cell) throw new AppError(503, "MISSING_SCRIPT_DEPENDENCY", "An OffCKB Secp256k1 dependency is not live.");
    const members = [];
    if (cellDep.depType === "depGroup") {
      const data = Buffer.from(ccc.bytesFrom(cell.outputData));
      if (data.length < 4 || data.readUInt32LE(0) > 128 || data.length !== 4 + data.readUInt32LE(0) * 36) throw new AppError(503, "INVALID_DEP_GROUP", "Invalid OffCKB dependency group data.");
      for (let offset = 4; offset < data.length; offset += 36) {
        const point = { txHash: ccc.hexFrom(data.subarray(offset, offset + 32)), index: data.readUInt32LE(offset + 32) };
        const member = await client.getCellLiveNoCache(point, true);
        if (!member) throw new AppError(503, "MISSING_SCRIPT_DEPENDENCY", "A Secp256k1 dependency group member is not live.");
        const matchesCodeHash = info.hashType === "type" ? member.cellOutput.type?.hash() === info.codeHash : ccc.hashCkb(member.outputData) === info.codeHash;
        deploymentMatched ||= matchesCodeHash;
        // Inspect deployment metadata without returning megabytes of executable
        // code / Secp256k1 table data to the browser on every refresh.
        members.push({ outPoint: outPointJson(member.outPoint), capacityShannon: member.cellOutput.capacity.toString(), type: member.cellOutput.type ? scriptJson(member.cellOutput.type) : null, dataByteLength: ccc.bytesFrom(member.outputData).length, dataHash: ccc.hashCkb(member.outputData), live: true, matchesCodeHash });
      }
    } else {
      deploymentMatched ||= info.hashType === "type" ? cell.cellOutput.type?.hash() === info.codeHash : ccc.hashCkb(cell.outputData) === info.codeHash;
    }
    dependencies.push({ outPoint: outPointJson(cellDep.outPoint), depType: cellDep.depType, live: true, type: cell.cellOutput.type ? scriptJson(cell.cellOutput.type) : null, dataByteLength: ccc.bytesFrom(cell.outputData).length, dataHash: ccc.hashCkb(cell.outputData), members });
  }
  if (!dependencies.length || !deploymentMatched) throw new AppError(503, "SCRIPT_DEPLOYMENT_MISMATCH", "No live dependency matches the configured Secp256k1 code hash.");
  return { standard: "secp256k1_blake160_sighash_all", account: 0, address: owner.toString(), lock: scriptJson(owner.script), scriptHash: owner.script.hash(), dependencies, deploymentMatched, deploymentNeeded: false, dataHex: LOCK_DATA, minimumCapacityShannon: minimumCapacity(owner.script).toString(), minimumCapacityCkb: ccc.fixedPointToString(minimumCapacity(owner.script)), feeRateShannonPerKb: LOCK_FEE_RATE.toString() };
}
export async function liveLockCell(point: LockPoint) {
  const creation = await rpc("get_transaction", [point.txHash]);
  if (creation?.tx_status?.status !== "committed") throw new AppError(409, "CREATION_NOT_COMMITTED", "The locked Cell's creation must be committed before spending.");
  const cell = await client.getCellLiveNoCache(point, true);
  if (!cell) throw new AppError(409, "CELL_NOT_LIVE", "The selected locked Cell is no longer live.");
  if (!cell.cellOutput.lock.eq((await accountLock()).script) || cell.cellOutput.type || cell.outputData !== LOCK_DATA) throw new AppError(409, "LOCK_CELL_MISMATCH", "The live Cell must use Account #0's standard lock, the lesson marker and no type script.");
  return cell;
}
export async function buildLockedCell(capacity: bigint) {
  const owner = await accountLock();
  if (capacity < minimumCapacity(owner.script)) throw new AppError(400, "CAPACITY_TOO_SMALL", `The locked Cell requires at least ${ccc.fixedPointToString(minimumCapacity(owner.script))} CKB including its marker data.`);
  await lockDeployment();
  await client.cache.clear();
  const signer = await ownerSigner();
  const tx = ccc.Transaction.from({ outputs: [{ lock: owner.script, capacity }], outputsData: [LOCK_DATA] });
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, LOCK_FEE_RATE);
  const signed = await signer.signTransaction(tx);
  await assertLiveInputs(signed);
  return { signed, sender: owner.toString(), receiver: owner.toString() };
}
export async function buildLockSpend(point: LockPoint, receiver: string) {
  await lockDeployment();
  await client.cache.clear();
  const cell = await liveLockCell(point);
  const signer = await ownerSigner();
  const to = await parseAddress(receiver);
  const local = (await accountLock()).script;
  if (to.script.codeHash !== local.codeHash || to.script.hashType !== local.hashType || ccc.bytesFrom(to.script.args).length !== 20) throw new AppError(400, "UNSUPPORTED_DESTINATION", "This lesson accepts standard 20-byte Secp256k1 Devnet destinations.");
  const tx = ccc.Transaction.from({ outputs: [{ lock: to.script, capacity: minimumCapacity(to.script, "0x") }], outputsData: ["0x"] });
  tx.addInput(cell);
  await tx.completeFeeChangeToOutput(signer, 0, LOCK_FEE_RATE, undefined, { shouldAddInputs: false });
  const signed = await signer.signTransaction(tx);
  await assertLiveInputs(signed);
  if (signed.inputs.length !== 1 || !signed.inputs[0].previousOutput.eq(point)) throw new AppError(409, "UNEXPECTED_INPUT", "Spend must use only the selected lesson Cell.");
  return { signed, sender: (await accountLock()).toString(), receiver: to.toString(), cell };
}
export async function estimateLock(tx: ccc.Transaction): Promise<{ cycles: string | null; error: { code: number; message: string; data?: unknown } | null }> {
  // A dedicated read-only RPC preserves validation details without serializing
  // signer/SDK objects or exposing private keys through error responses.
  let response: Response;
  try {
    response = await fetch(RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "estimate_cycles", params: [cccA.JsonRpcTransformers.transactionFrom(tx)] }), signal: AbortSignal.timeout(10000) });
  } catch { throw new AppError(503, "DRY_RUN_UNAVAILABLE", "Cannot reach Devnet estimate_cycles. No transaction was broadcast."); }
  if (!response.ok) throw new AppError(503, "DRY_RUN_UNAVAILABLE", "Devnet estimate_cycles returned an HTTP failure.");
  const result = await response.json() as any;
  if (result.error) return { cycles: null, error: { code: result.error.code, message: String(result.error.message).slice(0, 2000), ...(result.error.data === undefined ? {} : { data: typeof result.error.data === "string" ? result.error.data.slice(0, 4000) : JSON.stringify(result.error.data).slice(0, 4000) }) } };
  if (typeof result.result?.cycles !== "string" || !/^0x[0-9a-f]+$/i.test(result.result.cycles)) throw new AppError(503, "INVALID_DRY_RUN_RESPONSE", "Devnet did not return execution cycles.");
  return { cycles: BigInt(result.result.cycles).toString(), error: null };
}
export async function testLockAuthorization(point: LockPoint) {
  const built = await buildLockSpend(point, offckb.accounts[1].address);
  const authorized = await estimateLock(built.signed);
  if (authorized.error) throw new AppError(422, "AUTHORIZED_CONTROL_FAILED", `Authorized dry-run failed: ${authorized.error.message}. The unauthorized test is inconclusive.`);
  const wrong = await unauthorizedSigner();
  const wrongAddress = await wrong.signer.getRecommendedAddressObj();
  const owner = await accountLock();
  if (wrongAddress.script.eq(owner.script)) throw new AppError(503, "UNAUTHORIZED_KEY_IS_OWNER", "The test key must differ from Account #0.");
  const tx = ccc.Transaction.fromBytes(built.signed.toBytes());
  // getSignHashInfo hashes the witness as supplied. Reset to the 65-byte
  // placeholder first, exactly as the standard lock's sighash algorithm does.
  await tx.prepareSighashAllWitness(owner.script, 65, client);
  const info = await tx.getSignHashInfo(owner.script, client);
  if (!info) throw new AppError(422, "MISSING_SIGNING_GROUP", "No owner lock group was found.");
  const signature = ccc.signMessageSecp256k1(info.message, wrong.signer.privateKey);
  const witness = tx.getWitnessArgs(info.position)!;
  witness.lock = signature; tx.setWitnessArgs(info.position, witness);
  const proof = signatureProof(info.message, signature, wrong.signer.publicKey, owner.script.args);
  if (!proof.validSignature || proof.authorized || proof.recoveredArgs !== wrongAddress.script.args) throw new AppError(422, "INVALID_UNAUTHORIZED_PROOF", "The test did not produce a valid signature from a different owner.");
  const attempt = await estimateLock(tx);
  const cellAfter = await liveLockCell(point);
  const passed = Boolean(attempt.error && expectedLockFailure(attempt.error, info.position));
  return { outPoint: point, testedAt: new Date().toISOString(), passed, broadcast: false, mode: "Devnet estimate_cycles with authorized positive control", signer: wrong.label, signerAddress: wrongAddress.toString(), expected: "ValidationFailure -31 (ERROR_PUBKEY_BLAKE160_HASH) in the selected input lock", actualError: attempt.error, authorizedControlCycles: authorized.cycles, proof: { ...proof, sighash: info.message, signature, witnessPosition: info.position }, cellStillLive: Boolean(cellAfter), explanation: "The 65-byte signature is valid for the transaction sighash and the unauthorized public key. Its recovered public-key Blake160 differs from the locked Cell's args, so the standard lock rejects ownership. Transport, dependency and malformed-witness errors do not pass this test." };
}
