import { ccc } from "@ckb-ccc/core";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const devnetScripts = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "devnet-scripts.json"),
    "utf8",
  ),
) as Partial<Record<ccc.KnownScript, ccc.ScriptInfoLike>>;

async function main() {
  const client = new ccc.ClientPublicTestnet({
    url: "http://127.0.0.1:28114",
    fallbacks: ["http://127.0.0.1:8114"],
    scripts: devnetScripts,
  });

  const privateKey = readFileSync(
    join(homedir(), ".config/offckb/devnet-account-0.key"),
    "utf8"
  ).trim();

  const signer = new ccc.SignerCkbPrivateKey(
    client,
    privateKey
  );

  // Get the sender's lock script
  const addressObj = await signer.getRecommendedAddressObj();
  const lock = addressObj.script;

  // Prepare data
  const message = "Hello CKB!";
  const hexData = `0x${Buffer.from(message, "utf8").toString("hex")}`;

  // Create an output Cell with 100 CKB capacity
  const tx = ccc.Transaction.from({
    outputs: [
      {
        capacity: ccc.fixedPointFrom(100),
        lock,
      },
    ],
    outputsData: [hexData],
  });

  console.log("=== CKB Cell Data Transaction ===");
  console.log("Message:", message);
  console.log("Hex Data:", hexData);
  console.log("Capacity: 100 CKB");

  // Add input Cells to fund the transaction
  await tx.completeInputsByCapacity(signer);

  // Add transaction fee and change output
  await tx.completeFeeBy(signer);

  console.log("Inputs:", tx.inputs.length);
  console.log("Outputs:", tx.outputs.length);

  // Sign and broadcast. A second run before the block is mined rebuilds
  // the same transaction, which the node rejects as a duplicate.
  let txHash: string;
  try {
    txHash = await signer.sendTransaction(tx);
    console.log("\n=== Transaction Submitted ===");
    console.log("Status: Submitted");
  } catch (error) {
    if (!(error instanceof ccc.ErrorClientDuplicatedTransaction)) {
      throw error;
    }
    txHash = error.txHash;
    console.log("\n=== Transaction Already Submitted ===");
    console.log("Status: Already in the transaction pool");
  }

  console.log("Transaction Hash:", txHash);
}

main().catch((error) => {
  console.error("Transaction failed:", error);
  process.exitCode = 1;
});