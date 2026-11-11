import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ccc } from "@ckb-ccc/core";
import { client, offckb, parseAddress, RPC_URL } from "./ckb/client.js";
import { balanceFor, mutateToken, tokenInfo, transactionFor } from "./modules/fungible-token.js";
import { AppError, publicError } from "./errors.js";
import { dobRouter } from "./routes/dob.js";
import { lockScriptRouter } from "./routes/lock-script.js";
import { withTransactionLock } from "./modules/transaction-guard.js";

const app = express();
const PORT = 2507;
app.disable("x-powered-by");
app.set("json replacer", (_key: string, value: unknown) => typeof value === "bigint" ? value.toString() : value);
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", "Referrer-Policy": "no-referrer" });
  const host = req.headers.host;
  if (host !== "localhost:2507" && host !== "127.0.0.1:2507") return next(new AppError(403, "INVALID_HOST", "Use the local application on localhost:2507 or 127.0.0.1:2507."));
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (req.socket.remoteAddress !== "127.0.0.1" && req.socket.remoteAddress !== "::1" && req.socket.remoteAddress !== "::ffff:127.0.0.1") return next(new AppError(403, "LOCALHOST_REQUIRED", "Signing requires a loopback connection."));
    if (req.headers.origin !== `http://${host}` || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) return next(new AppError(403, "INVALID_ORIGIN", "State changes require the local application's matching Origin header."));
    if (!req.is("application/json")) return next(new AppError(415, "JSON_REQUIRED", "Use application/json."));
  }
  next();
});
// UTF-8 content may expand under JSON escaping; bound the body independently.
app.use("/api/dob", express.json({ limit: "24kb", strict: true }));
app.use(express.json({ limit: "4kb", strict: true }));
app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public")));

app.get("/api/health", async (_req, res) => {
  try {
    res.json({ app: "CKB Learning Lab", status: "connected", network: "OffCKB Local Devnet", rpc: RPC_URL, block: (await client.getTip()).toString() });
  } catch {
    res.status(503).json({ app: "CKB Learning Lab", status: "disconnected", network: "OffCKB Local Devnet", rpc: RPC_URL, error: { code: "RPC_UNAVAILABLE", message: "Cannot connect to local Devnet." } });
  }
});
app.get("/api/wallet", async (_req, res) => {
  const accounts = await Promise.all(offckb.accounts.map(async (account) => {
    const { script } = await parseAddress(account.address);
    const balance = await client.getBalanceSingle(script);
    return { ...account, balanceShannon: balance.toString(), balanceCkb: ccc.fixedPointToString(balance) };
  }));
  res.json({ ...accounts[0], accounts });
});
app.get("/api/token/info", async (_req, res) => { res.json(await tokenInfo()); });
app.get("/api/token/balance", async (req, res) => { res.json(await balanceFor(req.query.address)); });
app.get("/api/token/transaction/:hash", async (req, res) => { res.json(await transactionFor(req.params.hash)); });
app.use("/api/dob", dobRouter);
app.use("/api/lock-script", lockScriptRouter);
for (const [route, kind] of [["create", "mint"], ["transfer", "transfer"]] as const) {
  app.post(`/api/token/${route}`, async (req, res) => {
    const result = await withTransactionLock(() => mutateToken(kind, req.body, req.get("Idempotency-Key")));
    res.status(result.transaction.status === "committed" ? 200 : 202).json(result);
  });
}
app.use("/api", (_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Unknown API endpoint.")));
app.use(((error, _req, res, _next) => {
  let failure = publicError(error);
  if (error?.type === "entity.parse.failed") failure = new AppError(400, "INVALID_JSON", "Request body is not valid JSON.");
  if (error?.type === "entity.too.large") failure = new AppError(413, "BODY_TOO_LARGE", "Request body exceeds the allowed size.");
  res.status(failure.status).json({ error: { code: failure.code, message: failure.message } });
}) satisfies ErrorRequestHandler);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`CKB Learning Lab: http://localhost:${PORT}\nRPC: ${RPC_URL}\nToken, DOB and Lock Script operations require an explicit request.`);
});
