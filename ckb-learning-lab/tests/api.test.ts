import assert from "node:assert/strict";
import { request, type IncomingHttpHeaders } from "node:http";
import { test } from "node:test";

// These tests connect only to the existing local server. Never start/stop services,
// send valid mutations, replay operation keys, or request a signer from this suite.
type Reply = { status: number; headers: IncomingHttpHeaders; body: any };
type Options = { method?: string; headers?: Record<string, string>; body?: string };
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const KEY = "tests-invalid-only";
const validHeaders = { Origin: "http://localhost:2507", "Content-Type": "application/json", "Idempotency-Key": KEY };

function api(path: string, options: Options = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: 2507, path,
      method: options.method ?? "GET", headers: { Host: "localhost:2507", ...options.headers },
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          assert.match(res.headers["content-type"] ?? "", /^application\/json\b/);
          assert.equal(res.headers["x-content-type-options"], "nosniff");
          assert.equal(res.headers["referrer-policy"], "no-referrer");
          assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'none'/);
          assert.match(String(res.headers["content-security-policy"]), /default-src 'self'/);
          assert.equal(res.headers["x-powered-by"], undefined);
          assert.equal(res.headers["access-control-allow-origin"], undefined);
          assertNoSecrets(body);
          resolve({ status: res.statusCode!, headers: res.headers, body });
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error(`Local API timed out: ${path}`)));
    req.on("error", reject);
    req.end(options.body);
  });
}

function assertNoSecrets(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoSecrets(entry);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assert.doesNotMatch(key.replace(/[-_]/g, ""), /^(privatekeys?|secretkeys?|secret|mnemonic|seed|seedphrase|signedtransaction|fingerprint|stack)$/i,
        `Response exposes an internal field: ${key}`);
      assertNoSecrets(entry);
    }
  } else if (typeof value === "string") {
    assert.doesNotMatch(value, /-----BEGIN .*PRIVATE KEY-----|devnet-account-0\.key|test-only-sensitive-input/);
  }
}

function expectError(reply: Reply, status: number, code: string): void {
  assert.equal(reply.status, status, JSON.stringify(reply.body));
  assert.deepEqual(Object.keys(reply.body), ["error"]);
  assert.deepEqual(Object.keys(reply.body.error).sort(), ["code", "message"]);
  assert.equal(reply.body.error.code, code);
  assert.equal(typeof reply.body.error.message, "string");
  assert.ok(reply.body.error.message.length > 0);
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return api(path, { method: "POST", headers: { ...validHeaders, ...headers }, body: JSON.stringify(body) });
}

test("live localhost:2507 API: reads and rejected requests only", async (t) => {
  let health: Reply;
  try { health = await api("/api/health"); }
  catch (error) {
    // Only a refused connection skips integration checks. HTTP/RPC errors, malformed
    // responses and a hung server fail, so an unhealthy running server cannot pass.
    if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      t.skip("localhost:2507 is unavailable (ECONNREFUSED). Start the app and Devnet separately, then rerun npm test; tests never manage services.");
      return;
    }
    throw error;
  }

  await t.test("health comes from the live node and disables caching", () => {
    assert.equal(health.status, 200);
    assert.equal(health.body.app, "CKB Learning Lab");
    assert.equal(health.body.status, "connected");
    assert.equal(health.body.network, "OffCKB Local Devnet");
    assert.equal(health.body.rpc, "http://127.0.0.1:8114");
    assert.match(health.body.block, DECIMAL);
    assert.equal(health.headers["cache-control"], "no-store");
  });

  let wallet: any;
  await t.test("wallet exposes two public accounts and exact string balances", async () => {
    const reply = await api("/api/wallet");
    assert.equal(reply.status, 200);
    assert.equal(reply.headers["cache-control"], "no-store");
    wallet = reply.body;
    assert.deepEqual(Object.keys(wallet).sort(), ["account", "accounts", "address", "balanceCkb", "balanceShannon"]);
    assert.equal(wallet.accounts.length, 2);
    for (const [index, account] of wallet.accounts.entries()) {
      assert.deepEqual(Object.keys(account).sort(), ["account", "address", "balanceCkb", "balanceShannon"]);
      assert.equal(account.account, index);
      assert.match(account.address, /^ckt1[a-z0-9]+$/);
      assert.match(account.balanceShannon, DECIMAL);
      assert.match(account.balanceCkb, /^\d+(?:\.\d{1,8})?$/);
      const [whole, fraction = ""] = account.balanceCkb.split(".");
      assert.equal(BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0")), BigInt(account.balanceShannon));
    }
    assert.notEqual(wallet.accounts[0].address, wallet.accounts[1].address);
    assert.deepEqual(Object.fromEntries(Object.entries(wallet).filter(([key]) => key !== "accounts")), wallet.accounts[0]);
  });

  let info: any;
  await t.test("token info exposes the real deployment and redacted operation history", async () => {
    const reply = await api("/api/token/info");
    assert.equal(reply.status, 200);
    assert.equal(reply.headers["cache-control"], "no-store");
    info = reply.body;
    assert.equal(info.standard, "sUDT");
    assert.equal(info.metadataLocation, "application-only");
    assert.equal(info.decimals, 0);
    assert.equal(info.deploymentNeeded, false);
    assert.match(info.scriptInfo.codeHash, HASH);
    assert.ok(info.scriptInfo.cellDeps.length > 0);
    assert.ok(Array.isArray(info.operations));
    if (info.token !== null) {
      assert.equal(typeof info.token.name, "string");
      assert.match(info.token.symbol, /^[A-Z][A-Z0-9]{0,11}$/);
      assert.match(info.token.initialSupply, /^[1-9][0-9]*$/);
      assert.match(info.token.typeHash, HASH);
      assert.match(info.token.mintTxHash, HASH);
      assert.equal(info.token.typeScript.codeHash, info.scriptInfo.codeHash);
      assert.ok(info.operations.some((operation: any) => operation.hash === info.token.mintTxHash));
    }
    for (const operation of info.operations) {
      assert.deepEqual(Object.keys(operation).sort(), ["amount", "createdAt", "hash", "id", "kind", "receiver", "sender"]);
      assert.match(operation.hash, HASH);
      assert.match(operation.amount, /^[1-9][0-9]*$/);
      assert.ok(["mint", "transfer"].includes(operation.kind));
      assert.match(operation.sender, /^ckt1/);
      assert.match(operation.receiver, /^ckt1/);
      assert.ok(Number.isFinite(Date.parse(operation.createdAt)));
    }
  });

  await t.test("balance reads either token lifecycle state and sums Cell amounts exactly", async () => {
    assert.ok(wallet, "wallet must be readable");
    for (const account of wallet.accounts) {
      const reply = await api(`/api/token/balance?address=${encodeURIComponent(account.address)}`);
      if (reply.status === 409) { expectError(reply, 409, "TOKEN_NOT_CREATED"); continue; }
      assert.equal(reply.status, 200);
      assert.equal(reply.body.address, account.address);
      assert.match(reply.body.balance, DECIMAL);
      assert.ok(Array.isArray(reply.body.cells));
      let total = 0n;
      const seen = new Set<string>();
      for (const cell of reply.body.cells) {
        assert.match(cell.txHash, HASH);
        assert.match(cell.amount, DECIMAL);
        assert.match(cell.capacityShannon, DECIMAL);
        assert.ok(BigInt(cell.capacityShannon) > 0n);
        assert.match(cell.data, /^0x[0-9a-fA-F]{32}(?:[0-9a-fA-F]{2})*$/);
        const bytes = Buffer.from(cell.data.slice(2, 34), "hex");
        const amount = bytes.readBigUInt64LE(0) + (bytes.readBigUInt64LE(8) << 64n);
        assert.equal(cell.amount, amount.toString());
        const outpoint = `${cell.txHash}:${cell.index}`;
        assert.equal(seen.has(outpoint), false, "duplicate live Cell");
        seen.add(outpoint);
        total += amount;
      }
      assert.equal(reply.body.balance, total.toString());
    }
  });

  await t.test("unknown transaction stays unknown instead of claiming confirmation", async () => {
    const hash = `0x${"00".repeat(32)}`;
    const reply = await api(`/api/token/transaction/${hash}`);
    assert.equal(reply.status, 200);
    assert.equal(reply.body.hash, hash);
    assert.equal(reply.body.status, "unknown");
    assert.equal(reply.body.blockNumber, null);
    assert.deepEqual(reply.body.outputs, []);
    for (const field of ["sender", "receiver", "amount", "kind"]) assert.equal(reply.body[field], null);
  });

  await t.test("existing transactions can be inspected without replaying operations", async () => {
    assert.ok(info, "token info must be readable");
    if (info.operations.length === 0) {
      t.diagnostic("No saved operations yet; unknown-hash coverage still exercises transaction reads.");
    }
    for (const operation of info.operations.slice(0, 2)) {
      const reply = await api(`/api/token/transaction/${operation.hash}`);
      assert.equal(reply.status, 200);
      assert.equal(reply.body.hash, operation.hash);
      assert.ok(["unknown", "pending", "proposed", "committed", "rejected"].includes(reply.body.status));
      for (const field of ["sender", "receiver", "amount", "kind"]) assert.equal(reply.body[field], operation[field]);
      if (reply.body.status === "committed") {
        assert.match(reply.body.blockNumber, DECIMAL);
        assert.match(reply.body.blockHash, HASH);
        assert.ok(reply.body.outputs.length > 0);
      } else assert.equal(reply.body.blockNumber, null);
    }
  });

  for (const [path, code] of [
    ["/api/token/balance", "INVALID_ADDRESS"],
    ["/api/token/balance?address=ckt1invalid", "INVALID_ADDRESS"],
    ["/api/token/balance?address=ckb1invalid", "INVALID_ADDRESS"],
    ["/api/token/balance?address=a&address=b", "INVALID_ADDRESS"],
    ["/api/token/balance?address[]=ckt1invalid", "INVALID_ADDRESS"],
    ["/api/token/transaction/0x1234", "INVALID_HASH"],
    [`/api/token/transaction/0x${"gg".repeat(32)}`, "INVALID_HASH"],
  ]) {
    await t.test(`invalid read ${path}`, async () => expectError(await api(path), 400, code));
  }
  await t.test("unknown endpoints have a structured 404", async () => {
    expectError(await api("/api/not-a-real-endpoint"), 404, "NOT_FOUND");
  });

  for (const host of ["attacker.example:2507", "localhost", "localhost:80", "localhost:2507.attacker.example", "127.0.0.2:2507"]) {
    await t.test(`rejects untrusted Host ${host}`, async () => {
      expectError(await api("/api/health", { headers: { Host: host } }), 403, "INVALID_HOST");
    });
  }
  await t.test("accepts the explicit loopback Host", async () => {
    assert.equal((await api("/api/health", { headers: { Host: "127.0.0.1:2507" } })).status, 200);
  });

  for (const route of ["create", "transfer"]) {
    const path = `/api/token/${route}`;
    // Even if a security check regresses, these bodies cannot create a transaction.
    const invalidBody = route === "create" ? { initialSupply: "0" } : { amount: "0" };
    for (const origin of ["", "null", "https://localhost:2507", "http://attacker.example", "http://localhost:2507.attacker.example", "http://127.0.0.1:2507"]) {
      await t.test(`${route}: rejects Origin ${JSON.stringify(origin)}`, async () => {
        expectError(await post(path, invalidBody, { Origin: origin }), 403, "INVALID_ORIGIN");
      });
    }
    await t.test(`${route}: rejects missing Origin`, async () => {
      expectError(await api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invalidBody) }), 403, "INVALID_ORIGIN");
    });
    for (const site of ["cross-site", "same-site", "none"]) {
      await t.test(`${route}: rejects Sec-Fetch-Site ${site}`, async () => {
        expectError(await post(path, invalidBody, { "Sec-Fetch-Site": site }), 403, "INVALID_ORIGIN");
      });
    }
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp"]) {
      await t.test(`${route}: rejects Content-Type ${contentType}`, async () => {
        expectError(await post(path, invalidBody, { "Content-Type": contentType }), 415, "JSON_REQUIRED");
      });
    }
    await t.test(`${route}: rejects missing Content-Type`, async () => {
      expectError(await api(path, { method: "POST", headers: { Origin: validHeaders.Origin }, body: JSON.stringify(invalidBody) }), 415, "JSON_REQUIRED");
    });
    await t.test(`${route}: matching loopback Origin passes security and still rejects the amount`, async () => {
      expectError(await post(path, invalidBody, { Host: "127.0.0.1:2507", Origin: "http://127.0.0.1:2507", "Sec-Fetch-Site": "same-origin" }), 400, "INVALID_AMOUNT");
    });
    for (const body of ["{", '{"amount":', '{"amount":"0",}', "null", "true", '"text"']) {
      await t.test(`${route}: rejects malformed or scalar JSON ${body}`, async () => {
        expectError(await api(path, { method: "POST", headers: validHeaders, body }), 400, "INVALID_JSON");
      });
    }
    await t.test(`${route}: rejects a body over the 4KB limit without echoing it`, async () => {
      expectError(await post(path, { extra: "test-only-sensitive-input".repeat(250) }), 413, "BODY_TOO_LARGE");
    });
    for (const body of [[], [invalidBody]]) {
      await t.test(`${route}: rejects array bodies ${JSON.stringify(body)}`, async () => {
        expectError(await post(path, body), 400, "INVALID_BODY");
      });
    }
    await t.test(`${route}: rejects the missing amount in an empty JSON request body`, async () => {
      // express.json normalizes this zero-length application/json body to {}.
      expectError(await api(path, { method: "POST", headers: validHeaders }), 400, "INVALID_AMOUNT");
    });
    for (const key of ["", "short", "a".repeat(101), "has spaces"]) {
      await t.test(`${route}: rejects invalid idempotency key length=${key.length}`, async () => {
        expectError(await post(path, invalidBody, { "Idempotency-Key": key }), 400, "INVALID_IDEMPOTENCY_KEY");
      });
    }
    await t.test(`${route}: rejects a missing idempotency key`, async () => {
      expectError(await api(path, { method: "POST", headers: { Origin: validHeaders.Origin, "Content-Type": "application/json" }, body: JSON.stringify(invalidBody) }), 400, "INVALID_IDEMPOTENCY_KEY");
    });
    for (const extra of ["privateKey", "signedTransaction", "__proto__"]) {
      await t.test(`${route}: rejects unknown field ${extra} without reflecting it`, async () => {
        const body = JSON.parse(`{"${extra}":"test-only-sensitive-input"}`);
        expectError(await post(path, body), 400, "INVALID_BODY");
      });
    }
    for (const amount of [null, 1, "0", "-1", "01", "1.5", "1e3", "340282366920938463463374607431768211456"]) {
      await t.test(`${route}: rejects invalid amount ${JSON.stringify(amount)}`, async () => {
        const body = route === "create" ? { initialSupply: amount } : { amount };
        expectError(await post(path, body), 400, "INVALID_AMOUNT");
      });
    }
  }

  for (const name of ["", " ", "<script>", "x".repeat(65)]) {
    await t.test(`create: validates name ${JSON.stringify(name)}`, async () => {
      expectError(await post("/api/token/create", { name, symbol: "TEST", initialSupply: "1" }), 400, "INVALID_NAME");
    });
  }
  for (const symbol of ["", "test", "1ABC", "A".repeat(13)]) {
    await t.test(`create: validates symbol ${JSON.stringify(symbol)}`, async () => {
      expectError(await post("/api/token/create", { name: "Test", symbol, initialSupply: "1" }), 400, "INVALID_SYMBOL");
    });
  }
  for (const receiver of [null, 123, "ckb1invalid", "ckt1invalid"]) {
    await t.test(`transfer: validates receiver ${JSON.stringify(receiver)}`, async () => {
      expectError(await post("/api/token/transfer", { receiver, amount: "9007199254740993" }), 400, "INVALID_ADDRESS");
    });
  }
});
