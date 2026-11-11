import { Router } from "express";
import { dobInfo, dobTransaction, getDob, listDobs, mutateDob } from "../modules/dob.js";
import { withTransactionLock } from "../modules/transaction-guard.js";

export const dobRouter = Router();
dobRouter.get("/info", async (_req, res) => { res.json(await dobInfo()); });
dobRouter.get("/objects", async (_req, res) => { res.json(await listDobs()); });
dobRouter.get("/transaction/:hash", async (req, res) => { res.json(await dobTransaction(req.params.hash)); });
for (const kind of ["create", "transfer"] as const) {
  dobRouter.post(`/${kind}`, async (req, res) => {
    const result = await withTransactionLock(() => mutateDob(kind, req.body, req.get("Idempotency-Key")));
    res.status(result.transaction.status === "committed" ? 200 : 202).json(result);
  });
}
dobRouter.get("/:id", async (req, res) => { res.json(await getDob(req.params.id)); });
