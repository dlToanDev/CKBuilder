import { client, signer } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 05A ===");

// 1. Basic info
const address = await signer.getRecommendedAddress();
const addressObj = await signer.getRecommendedAddressObj();
const lock = addressObj.script;

console.log("\n[1] Address Information");
console.log("Network Prefix:", client.addressPrefix);
console.log("Address:", address);

// 2. Query live cells
console.log("\n[2] Live Cells Query");

const cells = [];

for await (const cell of client.findCellsByLock(lock, undefined, true, "desc", 10)) {
  cells.push(cell);
}

console.log("Cells Retrieved:", cells.length);

// 3. Show basic cell list
console.log("\n[3] Live Cell List");

cells.forEach((cell, index) => {
  console.log(`--- Cell ${index + 1} ---`);
  console.log("TX Hash:", cell.outPoint.txHash);
  console.log("Output Index:", cell.outPoint.index.toString());
});

console.log("\nLive Cells Query: SUCCESS");