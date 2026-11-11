import { ccc } from "@ckb-ccc/core";

async function main() {
  const client = new ccc.ClientJsonRpc("http://127.0.0.1:8114");
  const addressClient = new ccc.ClientPublicTestnet({
    url: "http://127.0.0.1:8114",
  });

  const tip = await client.getTip();

  console.log("=== CKB Local Devnet ===");
  console.log("Current Block:", tip.toString());

  const message = "Hello CKB!";
  const hexData = `0x${Buffer.from(message, "utf8").toString("hex")}`;

  const address =
    "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvwg2cen8extgq8s5puft8vf40px3f599cytcyd8";

  const addressObj = await ccc.Address.fromString(address, addressClient);

  const tx = ccc.Transaction.from({
    outputs: [
      {
        capacity: ccc.fixedPointFrom(100),
        lock: addressObj.script,
      },
    ],
    outputsData: [hexData],
  });

  console.log("\n=== Cell Data ===");
  console.log("Message:", message);
  console.log("Hex Data:", hexData);
  console.log("Output Cells:", tx.outputs.length);
  console.log("Capacity:", "100 CKB");
  console.log("Output Data:", tx.outputsData[0]);
  console.log("Transaction Prepared: Yes");
  console.log("Broadcasted: No");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exitCode = 1;
});