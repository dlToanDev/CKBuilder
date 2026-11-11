import { ccc } from "@ckb-ccc/core";

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ccc.ErrorTransactionInsufficientCapacity) {
    return new AppError(422, "INSUFFICIENT_CAPACITY", "Insufficient spendable CKB for token Cells, change, and transaction fees.");
  }
  if (error instanceof ccc.ErrorTransactionInsufficientCoin) {
    return new AppError(422, "INSUFFICIENT_TOKEN_BALANCE", "Insufficient token balance.");
  }
  // Never serialize SDK errors: they may contain internal request/signing details.
  return new AppError(503, "BLOCKCHAIN_UNAVAILABLE", "The local blockchain operation failed. Check Devnet connectivity and script dependencies; inspect the recorded transaction before retrying.");
}
