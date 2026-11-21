import { ccc } from "@ckb-ccc/ccc";
import { client, signer } from "@ckb-ccc/playground";

console.log("=== CKBuilder Week 02 - Lesson 05B ===");

const addressObj = await signer.getRecommendedAddressObj();
const lock = addressObj.script;

// Get the first live cell only
let firstCell = undefined;

for await (const cell of client.findCellsByLock(lock, undefined, true, "desc", 1)) {
  firstCell = cell;
  break;
}

console.log("\n[1] Cell Inspection");

if (!firstCell) {
  console.log("No live cell found.");
  console.log("Cell Details Inspection: FAILED");
} else {
  const output = firstCell.cellOutput;

  console.log("TX Hash:", firstCell.outPoint.txHash);
  console.log("Output Index:", firstCell.outPoint.index.toString());

  console.log(
    "Capacity:",
    ccc.fixedPointToString(output.capacity),
    "CKB"
  );

  console.log("Lock Code Hash:", output.lock.codeHash);
  console.log("Lock Hash Type:", output.lock.hashType);
  console.log("Lock Args:", output.lock.args);

  console.log("Has Type Script:", output.type !== undefined);

  if (output.type) {
    console.log("Type Code Hash:", output.type.codeHash);
    console.log("Type Hash Type:", output.type.hashType);
    console.log("Type Args:", output.type.args);
  }

  console.log("Output Data:", firstCell.outputData);

  console.log("\nCell Details Inspection: SUCCESS");
}