import { ccc } from "@ckb-ccc/ccc";
import { client } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 01 ===");

// 1. Check the selected network
console.log("Network Prefix:", client.addressPrefix);

// 2. Read current blockchain height
const tip = await client.getTip();
console.log("Current Block:", tip.toString());

// 3. Read the latest block header
const header = await client.getTipHeader();
console.log("Block Hash:", header.hash);
console.log("Block Number:", header.number.toString());

// 4. Convert CKB to shannons
const capacity = ccc.fixedPointFrom("100");
console.log("100 CKB in shannons:", capacity.toString());

// 5. Convert shannons back to CKB
console.log(
  "Converted back to CKB:",
  ccc.fixedPointToString(capacity)
);

console.log("CCC SDK Fundamentals: SUCCESS");