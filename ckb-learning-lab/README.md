# CKB Learning Lab

Reusable local learning modules for CKBuilder. The Fungible Token module implements a real sUDT initial mint, live-cell balances, transfers, confirmation polling, and output inspection using the existing OffCKB Devnet. Module 05 adds custom Cell digital objects with built-in TYPE_ID identity, on-chain text metadata, ownership transfer and a separate persistent journal. HTML, CSS and vanilla JavaScript call an Express/TypeScript backend; CCC handles construction and signing.

For DOB protocol details, exact run commands, limitations and the manual Create → View → Transfer checklist, see [05_dob](../reports/week01/05_dob/README.md). This is a custom Cell format, **not Spore**. DOB runtime acceptance is pending the user's manual tests. No DOB transaction, deployment or screenshot was produced during implementation.

## Run

Prerequisites: Node.js 22+, installed OffCKB 0.4.13 with the existing initialized Devnet, and the existing Account #0 key at `~/.config/offckb/devnet-account-0.key`. Never put that key in this project or browser.

```bash
offckb node --daemon
cd /home/sotatek/toan/code/CKBuilder/ckb-learning-lab
npm ci
npm run dev
```

Reuse an already-running Devnet. Open **http://localhost:2507**. The server binds only to **127.0.0.1:2507**; the node/indexer is **http://127.0.0.1:8114**. `npm start` runs without the watch process. No mint occurs on startup or refresh.

## Use

1. Refresh connection and wallet information. Accounts #0/#1 are discovered with `offckb accounts`, without private-key output.
2. Open Fungible Token. The sUDT contract and dependencies are resolved from `offckb system-scripts --output` and checked against live Cells. This Devnet already has sUDT in genesis; deployment is unnecessary.
3. Click **Create Token** once to mint the requested positive whole-number initial supply to Account #0. This lab supports one token identity per issuer. Names and symbols are application metadata only.
4. Wait for the RPC-confirmed **committed** status, then query either account or another valid `ckt1` address.
5. Transfer a positive whole-number quantity to the prefilled actual Account #1 address or another receiver. Wait for committed before continuing.
6. Inspect the full transaction hash, block, sender, receiver, token amount and raw output data. Use the copy buttons or the transaction history to revisit operations.

Token amounts are uint128 values encoded in 16 bytes, little endian. They use `bigint` internally and strings in JSON. Output capacity and transaction fees are CKB, separate from token quantity. The wallet shows spendable CKB in plain Cells; token/data Cells occupy additional capacity.

## Structure

- `src/server.ts`: local HTTP boundary, existing health/wallet APIs, token routes, JSON/error handling.
- `src/modules/offckb.ts`: safe fixed-argument CLI inspection, actual accounts and script configuration.
- `src/ckb/client.ts`: local-only CCC client, address validation, uncached RPC helper.
- `src/ckb/signer.ts`: existing server-side local development signer.
- `src/ckb/token.ts`: dependencies, exact-type balances, uint128 data, transaction construction and inspection.
- `src/modules/fungible-token.ts`: initial issuance policy, operation serialization, persistence and idempotency.
- `src/errors.ts`: consistent public errors without internal signing data.
- `public/`: frontend; all module tabs retain their DOM state.
- `data/token-config.json`: ignored local token/operation journal; no private keys.
- `tests/`: amount, validation and HTTP tests. No test automatically issues tokens.
- `scripts/capture-evidence.cjs`: optional real-browser evidence capture.

## HTTP API

| Method | Route | Input/result |
| --- | --- | --- |
| GET | `/api/health` | Connection, RPC, network, current block |
| GET | `/api/wallet` | Original Account #0 fields plus `accounts` #0/#1 |
| GET | `/api/token/info` | Script info, token metadata, prior operations |
| GET | `/api/token/balance?address=...` | Actual live token Cells and decimal-string balance |
| POST | `/api/token/create` | `{ "name": "CKBuilder Token", "symbol": "CKBT", "initialSupply": "1000" }` |
| POST | `/api/token/transfer` | `{ "receiver": "ckt1...", "amount": "10" }` |
| GET | `/api/token/transaction/:hash` | Uncached node status, block, operation and outputs |

POSTs require `Content-Type: application/json`, a matching local `Origin` (for example `http://localhost:2507` with Host `localhost:2507`), and an `Idempotency-Key` of 8–100 letters/digits/underscores/hyphens. Use a new key for a new intended transfer; reuse the original key and identical payload for a retry. Browser fetch supplies Origin automatically. No CORS permission is granted to external origins. Errors use `{ "error": { "code": "...", "message": "..." } }`.

Creation returns the existing mint for identical metadata, and rejects changed metadata/supply. The backend rejects unexpected request fields and never accepts arbitrary transactions, private keys, shell commands, arbitrary RPC URLs or signing instructions.

## Persistence and uncertain outcomes

The journal stores token metadata, the Devnet genesis hash, idempotency keys, operation details and signed transaction bytes. It is written atomically and flushed **before** broadcast. Signed transactions contain signatures, never the private key; their bytes are excluded from public API responses. Restarting loads the same token/history. Do not delete or edit the journal to trigger another mint.

Only one mutation is processed at a time. Pending/unknown operations block new operations. After a timeout, inspect the saved hash and use **Retry same submission**, which retains the original request key in session storage. This sends the identical saved transaction if the node has no record. If its hash is already committed, no broadcast occurs. No replacement mint is constructed. If the browser's session is lost, use the saved operation ID and the same original payload in a local API request.

Corrupt metadata, a different genesis, a signer other than Account #0, missing live dependencies, and existing on-chain issuer Cells without metadata all fail closed. Explicit node rejections are retained; transport failures stay unknown. A rejected mint requires inspection of its local record before further operations; the app does not automatically discard or remint it.

For a development-server restart, stop only the web process with Ctrl+C and run `npm run dev` again. Preserve Devnet and `data/`. A read-only check should still show the same token hash, mint hash, transfer history and balances.

## Verification

```bash
npm run typecheck
npm test
```

The tests do not broadcast valid token transactions. Some HTTP checks require the server and node; consult their skip output if they are unavailable.

Optional browser evidence uses an already installed Playwright module and Chrome without adding runtime dependencies:

```bash
# Point to your existing Playwright installation, or omit if locally resolvable.
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/capture-evidence.cjs
```

The read-only run expects this assignment's existing 1000-unit mint and 10-unit transfer. `--submit` explicitly permits missing first operations via UI clicks; it reuses existing recorded operations rather than issuing them again. The script asserts RPC commitment, 990/10 balances, 10/990 token outputs, two operation records, navigation persistence, no browser errors and no extra issuance on reload. Historical screenshots are preserved instead of overwritten.

Actual results, the complete type script, transaction hashes, raw RPC evidence and six screenshots are in [the assignment report](../reports/week01/04_fungible_token/README.md).

The DOB and Lock Script tabs now contain their workflows and reuse the shared connection/accounts. CKB Transfer and Cell Data retain their preexisting interfaces. Earlier assignment scripts, screenshots and transaction records remain in `reports/week01`; this change does not replace them.

Token, DOB and Lock Script builders share an in-process transaction lock and block new funding operations while another module has pending/unknown transactions. Keep one server process per data directory. Use `npm run test:unit` for offline checks without the existing live HTTP integration suite.

## Lock Script lesson

The Lock Script tab inspects the actual OffCKB Secp256k1 deployment, creates a Cell owned by Account #0, tests a valid signature from an unauthorized key with read-only `estimate_cycles`, spends with Account #0, and verifies commitment, outpoints, scripts and liveness. The lesson Cell carries `0x4c` data, so its minimum is 62 CKB with a standard 20-byte lock. Existing plain funding collectors skip it.

No custom contract deployment is required for this implementation. No separate assignment requiring a custom lock was found in the repository. The full rationale, manual commands, testing checklist and limitations are documented in [Week 01 / 06 — Lock Script](../reports/week01/06_lock_script/README.md). Implementation was checked offline; real Devnet and browser testing remains manual.

The module writes `data/lock-script-config.json` only following explicit Create, Test or Spend requests. Preserve this journal with the existing Token/DOB journals. Its private signing keys remain in the existing backend OffCKB directory. Optional Account #1 key support uses `~/.config/offckb/devnet-account-1.key`; when absent, the unauthorized test uses an ephemeral backend key, named explicitly in its result.
