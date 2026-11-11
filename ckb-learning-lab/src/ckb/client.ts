import { ccc } from "@ckb-ccc/core";
import { inspectOffckb } from "../modules/offckb.js";
import { AppError } from "../errors.js";

export const RPC_URL = "http://127.0.0.1:8114";

export const offckb = inspectOffckb();
export const client = new ccc.ClientPublicTestnet({
  url: RPC_URL,
  fallbacks: [],
  scripts: offckb.scripts,
  timeout: 10000,
});

export async function rpc<T = any>(method: string, params: unknown[] = []): Promise<T> {
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("RPC HTTP failure");
    const data = await response.json() as { result: T; error?: unknown };
    if (data.error) throw new Error("RPC rejected request");
    return data.result;
  } catch {
    throw new AppError(503, "RPC_UNAVAILABLE", "OffCKB RPC is unavailable or rejected the request at http://127.0.0.1:8114.");
  }
}

export async function parseAddress(value: unknown) {
  if (typeof value !== "string" || value.length > 200 || !value.startsWith("ckt1")) {
    throw new AppError(400, "INVALID_ADDRESS", "Enter a valid CKB Devnet (ckt1) address.");
  }
  try { return await ccc.Address.fromString(value, client); }
  catch { throw new AppError(400, "INVALID_ADDRESS", "Invalid Devnet address or checksum."); }
}
