import { ccc } from "@ckb-ccc/ccc";
import { client, signer } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 03B ===");

// 1. Get address and lock script
const address = await signer.getRecommendedAddress();

const { script: lock } = await ccc.Address.fromString(
  address,
  client
);

// 2. Create transaction
const tx = ccc.Transaction.from({
  outputs: [
    {
      lock,
      capacity: ccc.fixedPointFrom("100"),
    },
  ],
});

console.log("[1] Initial Transaction");
console.log("Inputs:", tx.inputs.length);
console.log("Outputs:", tx.outputs.length);

// 3. Complete inputs
await tx.completeInputsByCapacity(signer);

console.log("[2] Complete Inputs");
console.log("Inputs:", tx.inputs.length);

// 4. Complete transaction fee
await tx.completeFeeBy(signer);

console.log("[3] Complete Fee");
console.log("Inputs:", tx.inputs.length);
console.log("Outputs:", tx.outputs.length);
console.log("Witnesses:", tx.witnesses.length);

// 5. Show output capacity
tx.outputs.forEach((output, index) => {
  console.log(
    "Output " + index + ":",
    ccc.fixedPointToString(output.capacity),
    "CKB"
  );
});

console.log("[4] Result");
console.log("Transaction Completed: SUCCESS");
console.log("Status: NOT broadcasted");