import { ccc } from "@ckb-ccc/core";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { client } from "./client.js";

export function getDevnetSigner() {
  const keyPath = join(
    homedir(),
    ".config/offckb/devnet-account-0.key"
  );

  const privateKey = readFileSync(keyPath, "utf8").trim();

  return new ccc.SignerCkbPrivateKey(client, privateKey);
}