import { existsSync, mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ccc } from "@ckb-ccc/core";
import { client, offckb, parseAddress, rpc } from "../ckb/client.js";
import { buildTokenTransaction, checkDependencies, inspectTransaction, parseAmount, scriptJson, tokenBalance, tokenIdentity } from "../ckb/token.js";
import { AppError } from "../errors.js";
import { assertOtherModuleSettled } from "./transaction-guard.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const configFile = resolve(root, "data/token-config.json");
type Operation = {
  id: string; kind: "mint" | "transfer"; hash: string; sender: string; receiver: string;
  amount: string; fingerprint: string; signedTransaction: string; createdAt: string; rejection?: string;
};
type TokenConfig = {
  name: string; symbol: string; initialSupply: string; typeScript: ReturnType<typeof scriptJson>;
  typeHash: string; mintTxHash: string; ownerAddress: string;
};
type Store = { version: 1; genesisHash: string; token: TokenConfig | null; operations: Operation[] };
let store: Store | undefined;
let initialization: Promise<Store> | undefined;
let busy = false;

async function readStore() {
  if (!initialization) initialization = (async () => {
    if (existsSync(configFile)) {
      try {
        const saved: Store = JSON.parse(readFileSync(configFile, "utf8"));
        if (saved?.version !== 1 || !Array.isArray(saved.operations) || !saved.genesisHash) throw new Error();
        if (saved.token && !saved.operations.some((op) => op.kind === "mint" && op.hash === saved.token!.mintTxHash)) throw new Error();
        store = saved;
      } catch { throw new AppError(503, "INVALID_TOKEN_CONFIG", "Token configuration is invalid; restore it before issuing tokens. It will not be overwritten."); }
    } else {
      store = { version: 1, genesisHash: await rpc<string>("get_block_hash", ["0x0"]), token: null, operations: [] };
    }
    return store!;
  })().catch((error) => {
    // An initial RPC outage must be recoverable with Refresh after Devnet starts.
    initialization = undefined;
    throw error;
  });
  await initialization;
  const genesis = await rpc<string>("get_block_hash", ["0x0"]);
  if (store!.genesisHash !== genesis) throw new AppError(409, "CHAIN_MISMATCH", "Saved token configuration belongs to a different blockchain.");
  return store!;
}

function saveStore(next: Store) {
  mkdirSync(dirname(configFile), { recursive: true });
  const fd = openSync(`${configFile}.tmp`, "w", 0o600);
  try { writeFileSync(fd, JSON.stringify(next, null, 2) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(`${configFile}.tmp`, configFile);
  store = next;
}
const publicOperation = ({ signedTransaction: _signed, fingerprint: _fingerprint, ...operation }: Operation) => operation;

export async function tokenInfo() {
  const state = await readStore();
  const info = await checkDependencies();
  return { standard: "sUDT", metadataLocation: "application-only", decimals: 0, deploymentNeeded: false, scriptInfo: info, token: state.token, operations: state.operations.map(publicOperation) };
}
export async function balanceFor(address: unknown) {
  const owner = await parseAddress(address);
  const state = await readStore();
  if (!state.token) throw new AppError(409, "TOKEN_NOT_CREATED", "Create the token first.");
  return tokenBalance(owner.toString(), ccc.Script.from(state.token.typeScript));
}
export async function transactionFor(hash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new AppError(400, "INVALID_HASH", "Expected a 32-byte transaction hash.");
  const state = await readStore();
  const type = state.token ? ccc.Script.from(state.token.typeScript) : (await tokenIdentity()).type;
  const tx = await inspectTransaction(hash, type);
  const operation = state.operations.find((entry) => entry.hash === hash);
  const rejection = tx.status === "unknown" ? operation?.rejection : undefined;
  return { ...tx, ...(rejection ? { status: "rejected", reason: rejection } : {}), sender: operation?.sender ?? null, receiver: operation?.receiver ?? null, amount: operation?.amount ?? null, kind: operation?.kind ?? null };
}

function requestKey(key: unknown): string {
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "Supply an Idempotency-Key header of 8–100 letters, digits, underscores or hyphens.");
  return key;
}
function bodyObject(body: unknown): asserts body is Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "INVALID_BODY", "Expected a JSON object.");
}
function exactFields(body: Record<string, unknown>, fields: string[]) {
  if (Object.keys(body).some((key) => !fields.includes(key))) throw new AppError(400, "INVALID_BODY", "Unexpected request field.");
}

async function broadcast(operation: Operation) {
  const current = await transactionFor(operation.hash);
  if (current.status === "unknown") {
    // Persist signed bytes BEFORE broadcasting; retries reuse identical bytes.
    try { await client.sendTransaction(ccc.Transaction.fromBytes(operation.signedTransaction)); }
    catch (error) {
      if (!(error instanceof ccc.ErrorClientDuplicatedTransaction)) {
        // Preserve an explicit node rejection even if get_transaction does not
        // retain it. Transport failures remain unknown, never rejected/committed.
        if (error instanceof ccc.ErrorClientBase) {
          operation = { ...operation, rejection: "The blockchain node rejected this signed transaction. Check its inputs and script dependencies." };
          const latest = await readStore();
          saveStore({ ...latest, operations: latest.operations.map((entry) => entry.hash === operation.hash ? operation : entry) });
        }
        return { operation: publicOperation(operation), transaction: await transactionFor(operation.hash), message: "Submission was not acknowledged. Inspect this hash and retry the identical request/key; no new transaction will be constructed." };
      }
    }
  }
  return { operation: publicOperation(operation), transaction: await transactionFor(operation.hash) };
}

export async function mutateToken(kind: "mint" | "transfer", body: unknown, key: unknown) {
  bodyObject(body);
  const id = requestKey(key);
  exactFields(body, kind === "mint" ? ["name", "symbol", "initialSupply"] : ["receiver", "amount"]);
  const amount = parseAmount(kind === "mint" ? body.initialSupply : body.amount);
  let name = "", symbol = "";
  if (kind === "mint") {
    if (typeof body.name !== "string" || !/^[\p{L}\p{N} ._-]{1,64}$/u.test(body.name.trim())) throw new AppError(400, "INVALID_NAME", "Token name must contain 1–64 letters, digits, spaces, dots, underscores or hyphens.");
    if (typeof body.symbol !== "string" || !/^[A-Z][A-Z0-9]{0,11}$/.test(body.symbol)) throw new AppError(400, "INVALID_SYMBOL", "Symbol must contain 1–12 uppercase letters or digits, starting with a letter.");
    name = body.name.trim(); symbol = body.symbol;
  }
  const receiver = kind === "mint" ? offckb.accounts[0].address : (await parseAddress(body.receiver)).toString();
  const fingerprint = JSON.stringify({ kind, receiver, amount: amount.toString(), name, symbol });
  if (busy) throw new AppError(409, "OPERATION_IN_PROGRESS", "Another token operation is processing. Wait and inspect its transaction.");
  busy = true;
  try {
    const state = await readStore();
    const previous = state.operations.find((operation) => operation.id === id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This request key has already been used with a different payload.");
      return await broadcast(previous);
    }
    if (kind === "mint" && state.token) {
      const mint = state.operations.find((operation) => operation.hash === state.token!.mintTxHash)!;
      if (mint.fingerprint !== fingerprint) throw new AppError(409, "TOKEN_ALREADY_EXISTS", "This lab already has an issuer token. Its metadata and supply cannot be recreated.");
      return await broadcast(mint);
    }
    if (kind === "transfer" && !state.token) throw new AppError(409, "TOKEN_NOT_CREATED", "Create the token first.");
    for (const operation of state.operations) {
      const tx = await transactionFor(operation.hash);
      if (!["committed", "rejected"].includes(tx.status)) throw new AppError(409, "PENDING_TRANSACTION", `An earlier transaction is ${tx.status}. Verify ${operation.hash} before submitting another operation.`);
      if (operation.kind === "mint" && tx.status === "rejected") throw new AppError(409, "MINT_REJECTED", "The initial mint was rejected. Inspect its saved record before any further operations.");
    }
    await assertOtherModuleSettled("token");
    const { type } = await tokenIdentity();
    if (state.token && !type.eq(state.token.typeScript)) throw new AppError(409, "TOKEN_IDENTITY_MISMATCH", "Saved token identity does not match this Devnet issuer.");
    if (kind === "mint") {
      for await (const _cell of client.findCells({ script: type, scriptType: "type", scriptSearchMode: "exact", withData: false })) {
        throw new AppError(409, "EXISTING_ON_CHAIN_TOKEN", "This issuer already has token Cells. Restore its metadata instead of minting again.");
      }
    }
    const signed = await buildTokenTransaction(kind, amount, receiver, type);
    const hash = signed.hash();
    const operation: Operation = { id, kind, hash, sender: offckb.accounts[0].address, receiver, amount: amount.toString(), fingerprint, signedTransaction: ccc.hexFrom(signed.toBytes()), createdAt: new Date().toISOString() };
    const token = kind === "mint" ? { name, symbol, initialSupply: amount.toString(), typeScript: scriptJson(type), typeHash: type.hash(), mintTxHash: hash, ownerAddress: offckb.accounts[0].address } : state.token;
    saveStore({ ...state, token, operations: [...state.operations, operation] });
    return await broadcast(operation);
  } finally { busy = false; }
}
