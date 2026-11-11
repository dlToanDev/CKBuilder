import { ccc } from "@ckb-ccc/core";
import { AppError } from "../errors.js";

export const DOB_PROTOCOL = "ckbuilder-type-id-v1";
export type DobData = { protocol: typeof DOB_PROTOCOL; version: 1; name: string; description: string; contentType: string; content: string };
export function objectBody(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400, "INVALID_BODY", "Expected a JSON object.");
}
export function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new AppError(400, "INVALID_BODY", "Unexpected request field.");
}
export function hash32(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new AppError(400, "INVALID_ID", "Expected a 32-byte hex object ID or transaction hash.");
  return value.toLowerCase();
}
export function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw new AppError(400, "INVALID_IDEMPOTENCY_KEY", "Supply an Idempotency-Key of 8–100 letters, digits, underscores or hyphens.");
  return value;
}
function text(value: unknown, label: string, maxBytes: number, empty = false) {
  if (typeof value !== "string" || (!empty && !value.trim()) || Buffer.byteLength(value, "utf8") > maxBytes || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value)) {
    throw new AppError(400, "INVALID_DOB_DATA", `${label} must be UTF-8 text of at most ${maxBytes} bytes${empty ? "" : ", and cannot be empty"}.`);
  }
  return value;
}
export function dobData(body: unknown): DobData {
  objectBody(body);
  fields(body, ["name", "description", "contentType", "content"]);
  const name = text(body.name, "Name", 128).trim();
  const description = text(body.description, "Description", 512, true);
  const contentType = text(body.contentType, "Content type", 96).toLowerCase();
  if (!/^(text\/[a-z0-9!#$&^_.+-]+|application\/json)$/.test(contentType)) throw new AppError(400, "INVALID_CONTENT_TYPE", "Use text/* or application/json. Content is stored as UTF-8 text, never executed.");
  const content = text(body.content, "Content", 1536);
  if (contentType === "application/json") {
    try { JSON.parse(content); } catch { throw new AppError(400, "INVALID_CONTENT", "Content must be valid JSON for application/json."); }
  }
  const data: DobData = { protocol: DOB_PROTOCOL, version: 1, name, description, contentType, content };
  encodeDob(data); // Bound serialized bytes too: JSON escaping can expand input.
  return data;
}
export function encodeDob(data: DobData) {
  const bytes = Buffer.from(JSON.stringify(data), "utf8");
  if (bytes.length > 4096) throw new AppError(400, "ENCODED_DOB_TOO_LARGE", "Encoded on-chain JSON exceeds 4096 bytes. Shorten text containing many quotes, backslashes or escaped characters.");
  return ccc.hexFrom(bytes);
}
export function decodeDob(hex: string): DobData {
  try {
    const bytes = ccc.bytesFrom(hex);
    if (bytes.length > 4096) throw new Error();
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (value.protocol !== DOB_PROTOCOL || value.version !== 1) throw new Error();
    const { protocol: _protocol, version: _version, ...body } = value;
    return dobData(body);
  } catch { throw new AppError(422, "INVALID_ON_CHAIN_DOB", "Cell data does not match the CKBuilder DOB text format."); }
}
