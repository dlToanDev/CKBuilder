import { Router } from "express";
import { inspectLockTransaction, lockInfo, mutateLock } from "../modules/lock-script.js";
import { withTransactionLock } from "../modules/transaction-guard.js";

export const lockScriptRouter = Router();
lockScriptRouter.get("/info", async (_req, res) => { res.json(await lockInfo()); });
lockScriptRouter.get("/transaction/:hash", async (req, res) => { res.json(await inspectLockTransaction(req.params.hash)); });
for (const kind of ["create", "test-unauthorized", "spend"] as const) {
  lockScriptRouter.post(`/${kind}`, async (req, res) => {
    const result = await withTransactionLock(() => mutateLock(kind, req.body, req.get("Idempotency-Key")));
    res.status("transaction" in result && !["committed", "rejected"].includes(result.transaction.status) ? 202 : 200).json(result);
  });
}
