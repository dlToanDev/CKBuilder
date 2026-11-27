
import { ccc } from "@ckb-ccc/ccc";
import { client } from "@ckb-ccc/playground";

const txHash =
  "0x1fbed40716ac9950b9d74eb7018638f364f841812c749a64a4c2f6eedd887906";

const result = await client.getTransaction(txHash);

if (!result) {
  throw new Error("Transaction not found");
}

const tx = result.transaction;

// 1. Transaction information
console.log("=== CKB VALIDATION MODEL ===");
console.log("Network:", client.addressPrefix);
console.log("Transaction Hash:", txHash);
console.log("Status:", result.status);

// 2. Transaction structure
console.log("=== TRANSACTION STRUCTURE ===");
console.log("Inputs:", tx.inputs.length);
console.log("Outputs:", tx.outputs.length);
console.log("Witnesses:", tx.witnesses.length);
console.log("Cell Dependencies:", tx.cellDeps.length);

// 3. Output Cell inspection
console.log("=== OUTPUT CELLS ===");

for (let i = 0; i < tx.outputs.length; i++) {
  const output = tx.outputs[i];

  console.log(`=== OUTPUT ${i} ===`);

  console.log(
    "Capacity:",
    ccc.fixedPointToString(output.capacity) + " CKB"
  );

  console.log("Lock Code Hash:", output.lock.codeHash);
  console.log("Lock Hash Type:", output.lock.hashType);
  console.log("Lock Args:", output.lock.args);
  console.log("Type Script:", output.type ?? "None");
  console.log("Cell Data:", tx.outputsData[i]);
}

console.log("=== INSPECTION COMPLETED ===");

// 4. Script Group analysis
console.log("=== SCRIPT GROUP ANALYSIS ===");

const lockGroups = new Set<string>();
const typeGroups = new Set<string>();

let totalInput = 0n;
let totalOutput = 0n;

for (const input of tx.inputs) {
  const cell = await input.getCell(client);

  lockGroups.add(cell.cellOutput.lock.hash());
  totalInput += cell.cellOutput.capacity;

  if (cell.cellOutput.type) {
    typeGroups.add(cell.cellOutput.type.hash());
  }
}

for (const output of tx.outputs) {
  totalOutput += output.capacity;

  if (output.type) {
    typeGroups.add(output.type.hash());
  }
}

console.log("Lock Script Groups:", lockGroups.size);
console.log("Type Script Groups:", typeGroups.size);

// 5. Validation summary
console.log("=== VALIDATION SUMMARY ===");

console.log(
  "Total Input:",
  ccc.fixedPointToString(totalInput)
);

console.log(
  "Total Output:",
  ccc.fixedPointToString(totalOutput)
);

console.log(
  "Fee:",
  ccc.fixedPointToString(totalInput - totalOutput)
);

console.log(
  "Capacity Check:",
  totalInput >= totalOutput ? "PASS" : "FAIL"
);

console.log("On-chain Status:", result.status);
