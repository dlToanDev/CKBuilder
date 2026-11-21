import { ccc } from "@ckb-ccc/ccc";
import { client, signer } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 03C ===");

// 1. Create transaction
const address = await signer.getRecommendedAddress();

const { script: lock } = await ccc.Address.fromString(
  address,
  client
);

const tx = ccc.Transaction.from({
  outputs: [
    {
      lock,
      capacity: ccc.fixedPointFrom("100"),
    },
  ],
});

// 2. Complete transaction
await tx.completeInputsByCapacity(signer);
await tx.completeFeeBy(signer);

// 3. Inspect structure
console.log("[1] Transaction Structure");

console.log("Version:", tx.version.toString());
console.log("Cell Dependencies:", tx.cellDeps.length);
console.log("Header Dependencies:", tx.headerDeps.length);
console.log("Inputs:", tx.inputs.length);
console.log("Outputs:", tx.outputs.length);
console.log("Witnesses:", tx.witnesses.length);

// 4. Inspect output
console.log("[2] Output Inspection");

tx.outputs.forEach((output, index) => {
  console.log("Output Index:", index);

  console.log(
    "Capacity:",
    ccc.fixedPointToString(output.capacity),
    "CKB"
  );

  console.log("Lock Code Hash:", output.lock.codeHash);
  console.log("Lock Hash Type:", output.lock.hashType);
  console.log("Has Type Script:", output.type !== undefined);
});

// 5. Final result
console.log("[3] Result");
console.log("Transaction Inspection: SUCCESS");
console.log("Status: Built only - NOT broadcasted");