import { client } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 02A ===");

// 1. Network information
console.log("[1] Network Information");
console.log("Network Prefix:", client.addressPrefix);

// 2. Latest block number
const tip = await client.getTip();

console.log("[2] Blockchain Status");
console.log("Current Block:", tip.toString());

// 3. Latest block header
const header = await client.getTipHeader();

console.log("[3] Block Header");
console.log("Block Number:", header.number.toString());
console.log("Block Hash:", header.hash);
console.log("Parent Hash:", header.parentHash);

console.log("Block Header Query: SUCCESS");