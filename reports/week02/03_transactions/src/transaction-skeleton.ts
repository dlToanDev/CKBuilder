import { ccc } from "@ckb-ccc/ccc";
import { client, signer } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 03A ===");

// 1. Get signer address and lock script
const address = await signer.getRecommendedAddress();

const { script: lock } = await ccc.Address.fromString(
  address,
  client
);

console.log("[1] Address");
console.log("Sender:", address);

// 2. Create transaction skeleton
const tx = ccc.Transaction.from({
  outputs: [
    {
      lock,
      capacity: ccc.fixedPointFrom("100"),
    },
  ],
});

// 3. Inspect initial transaction
console.log("[2] Transaction Skeleton");
console.log("Inputs:", tx.inputs.length);
console.log("Outputs:", tx.outputs.length);
console.log("Witnesses:", tx.witnesses.length);

console.log(
  "Output Capacity:",
  ccc.fixedPointToString(tx.outputs[0].capacity),
  "CKB"
);

console.log("[3] Result");
console.log("Status: Skeleton only");
console.log("Transaction Skeleton: SUCCESS");