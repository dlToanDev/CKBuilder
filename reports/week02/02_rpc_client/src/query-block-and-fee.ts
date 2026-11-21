import { client } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 02B ===");

// 1. Get latest block
const header = await client.getTipHeader();

console.log("[1] Block Query");

const block = await client.getBlockByNumber(header.number);

if (!block) {
  throw new Error("Block not found");
}

console.log("Block Found: YES");
console.log("Block Number:", block.header.number.toString());
console.log("Block Hash:", block.header.hash);
console.log("Transaction Count:", block.transactions.length);

// 2. Verify block by hash
console.log("[2] Block Hash Verification");

const blockByHash = await client.getBlockByHash(header.hash);

console.log("Block Found:", blockByHash !== undefined);
console.log(
  "Matching Block:",
  blockByHash?.header.hash === header.hash
);

// 3. Read network fee rate
console.log("[3] Network Fee Rate");

const feeRate = await client.getFeeRate();

console.log(
  "Fee Rate:",
  feeRate.toString(),
  "shannons/KB"
);

// 4. Final result
console.log("Block Query & Fee Rate: SUCCESS");