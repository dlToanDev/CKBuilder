import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ccc } from "@ckb-ccc/core";

// All arguments are fixed, and no shell or private-key output is used.
export function inspectOffckb() {
  const directory = mkdtempSync(join(tmpdir(), "ckbuilder-scripts-"));
  try {
    const file = join(directory, "scripts.json");
    execFileSync("offckb", ["system-scripts", "--output", file], { timeout: 20000, stdio: "pipe" });
    const exported = JSON.parse(readFileSync(file, "utf8"));
    const source = exported.devnet;
    if (!source?.sudt?.script || !source?.secp256k1_blake160_sighash_all?.script) {
      throw new Error("OffCKB Devnet sUDT/secp script configuration is missing.");
    }
    const scripts: Partial<Record<ccc.KnownScript, ccc.ScriptInfoLike>> = {};
    for (const [known, name] of [
      [ccc.KnownScript.Secp256k1Blake160, "secp256k1_blake160_sighash_all"],
      [ccc.KnownScript.Secp256k1Multisig, "secp256k1_blake160_multisig_all"],
      [ccc.KnownScript.AnyoneCanPay, "anyone_can_pay"],
      [ccc.KnownScript.OmniLock, "omnilock"],
      [ccc.KnownScript.TypeId, "type_id"],
      [ccc.KnownScript.NervosDao, "dao"],
      [ccc.KnownScript.SUdt, "sudt"],
      [ccc.KnownScript.XUdt, "xudt"],
    ] as const) {
      if (source[name]?.script) scripts[known] = source[name].script;
    }
    const output = execFileSync("offckb", ["accounts"], { encoding: "utf8", timeout: 20000 });
    const accounts = [...output.matchAll(/- "#": (\d+)\s+address: (ckt1[a-z0-9]+)/g)]
      .filter((match) => Number(match[1]) <= 1)
      .map((match) => ({ account: Number(match[1]), address: match[2] }));
    if (accounts.length !== 2 || accounts[0].account !== 0 || accounts[1].account !== 1) {
      throw new Error("Could not identify OffCKB accounts #0 and #1.");
    }
    return { scripts, accounts };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
