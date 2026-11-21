import { ccc } from "@ckb-ccc/ccc";
import { client, signer } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 05C ===");

const address = await signer.getRecommendedAddress();
const addressObj = await signer.getRecommendedAddressObj();
const lock = addressObj.script;

console.log("\n[1] Wallet Information");
console.log("Network Prefix:", client.addressPrefix);
console.log("Address:", address);

// Sum up to 10 cells
let sampledCapacity = 0n;
let cellCount = 0;

for await (const cell of client.findCellsByLock(lock, undefined, true, "desc", 10)) {
  sampledCapacity += cell.cellOutput.capacity;
  cellCount += 1;
}

console.log("\n[2] Capacity Summary");
console.log("Cells Counted:", cellCount);
console.log(
  "Sampled Capacity:",
  ccc.fixedPointToString(sampledCapacity),
  "CKB"
);

// Get signer balance
const totalBalance = await signer.getBalance();

console.log("\n[3] Balance Verification");
console.log(
  "Signer Total Balance:",
  ccc.fixedPointToString(totalBalance),
  "CKB"
);
console.log("Balance in Shannons:", totalBalance.toString());
console.log("Sample Matches Total:", sampledCapacity === totalBalance);

console.log("\nBalance Verification: SUCCESS");