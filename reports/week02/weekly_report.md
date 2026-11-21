# CKBuilder — Week 02 Technical Report

| | |
|---|---|
| Participant | Hoang Anh Toan |
| Programme | Community Keeps Building — Builder Track |
| Reporting period | 21 November 2026 |
| Development environment | Ubuntu 24.04.5 LTS · CCC Playground · CKB Testnet |
| Project | CCC exercises and a small Testnet dApp |

## 1. Overview

In Week 01, the exercises were completed through the CKB Learning Lab on a local Devnet. This week, I moved to writing the CCC SDK calls directly and running them against CKB Testnet.

Lessons 01–03 and 05 were executed in the CCC Playground. None of these scripts broadcast a transaction. Lessons 04 and 06 were run locally in the browser with UTXO Global Wallet. The only transaction actually submitted to the network this week was the 100 CKB transfer sent from the dApp in Lesson 06.

| Evidence | Topic | Work performed |
|---|---|---|
| [`01_ccc_sdk/`](./01_ccc_sdk/) | CCC SDK | Read the Testnet tip and convert 100 CKB to shannons |
| [`02_rpc_client/`](./02_rpc_client/) | RPC client | Query a block by number and by hash, then read the fee rate |
| [`03_transactions/`](./03_transactions/) | Transaction assembly | Build a skeleton, complete inputs and fee, stop before broadcast |
| [`04_wallet_integration/`](./04_wallet_integration/) | Wallet | Connect UTXO Global Wallet and display address, balance, and lock script |
| [`05_cell_query/`](./05_cell_query/) | Cell query | List live Cells, inspect one Cell, compare the total with `getBalance()` |
| [`06_first_dapp/`](./06_first_dapp/) | First dApp | Connect a wallet, list Cells, and send 100 CKB after review |

## 2. Development Environment

| Component | Version or configuration |
|---|---|
| Operating system | Ubuntu 24.04.5 LTS |
| Node.js | v22.23.2 |
| npm | 10.9.8 |
| Git | 2.43.0 |
| Playground | `live.ckbccc.com`, Testnet (`ckt`) |
| Wallet app | Create React App, `http://localhost:3002` |
| dApp | Vite 7, React 18, TypeScript 5.9, `http://localhost:3010` |
| dApp SDK | `@ckb-ccc/connector-react` 2.3.0 |

```text
reports/week02/
├── 01_ccc_sdk/
├── 02_rpc_client/
├── 03_transactions/
├── 04_wallet_integration/
├── 05_cell_query/
└── 06_first_dapp/
    └── ckb-simple-dapp/
```

Two setup issues are worth noting:

- The React starter I used was based on Create React App and TypeScript 4. I encountered compatibility issues with the connector package, so I kept the generated app for the wallet exercise (Lesson 04) and built Lesson 06 separately using Vite and `connector-react` 2.3.0.
- `npm run dev` binds strictly to port 3010. A second start failed because the first Vite process was still running, so I continued with the existing server.

## 3. CCC SDK Basics

Result from `01_ccc_fundamentals.png`:

| Item | Value |
|---|---|
| Network prefix | `ckt` |
| `getTip()` | 23091420 |
| Header number | 23091420 |
| Header hash | `0xc847640d6df8d9094d741a5177ce00fe7603ac08b7e99e6f8a037f7594bafc1f` |
| 100 CKB in shannons | `10000000000` |
| Converted back | `100` |

`getTip()` and `getTipHeader()` returned the same block number (23091420), meaning no new block was produced between the two calls. The unit conversion was consistent in both directions: 100 CKB corresponds to `10000000000` shannons (1 CKB = 10⁸ shannons) and converts back to 100.

**Evidence:** [`01_ccc_sdk/`](./01_ccc_sdk/)

## 4. Blocks and Fee Rate

`01_block_header.png` shows network prefix `ckt`, with both the tip and the header at block 23092378:

| Field | Value |
|---|---|
| Header hash | `0x0239ac0a64b66ce85632676afb3a9d8cc22efd2e10c87371e772a7616b2bb67e` |
| Parent hash | `0x371dfd7db4d5439e6fea3d0661675fb9ba4ae2d20d5fbbcbf20eaab9f9f01244` |

`02_block_query_and_fee.png` shows the following:

| Field | Value |
|---|---|
| Block number | 23092392 |
| Block hash | `0x130529c5ea3522cc616132dbfa1503e10f32f96b13dd010bcec9bd2655d3c9c0` |
| Transaction count | 1 |
| Query by hash | Same block returned (`Matching Block: true`) |
| Fee rate | 33222 shannons/KB |

The tip advanced from 23092378 to 23092392 between the two runs. Since the block number alone changes quickly, the hash comparison is the more reliable way to confirm that both queries refer to the same block.

**Evidence:** [`02_rpc_client/`](./02_rpc_client/)

## 5. Building a Transaction

Each script creates a single 100 CKB output to the Playground signer's own address and stops before sending.

`01_transaction_skeleton.png`: 0 inputs, 1 output, 0 witnesses, output capacity 100 CKB. Status: `Skeleton only`.

`02_transaction_completed.png`:

| Stage | Inputs | Outputs | Witnesses |
|---|---|---|---|
| After `Transaction.from` | 0 | 1 | — |
| After `completeInputsByCapacity` | 2 | 1 | — |
| After `completeFeeBy` | 3 | 2 | 1 |

Output 0 remained at 100 CKB, and Output 1 was `82.99981661` CKB. Status: `NOT broadcasted`.

The fee step added one more input and a second output. The second output is the change returned to the sender, not an additional payment. The witness added at this stage is the placeholder reserved for the signature. The transaction was intentionally not broadcast.

`03_transaction_inspection.png` shows the same two amounts. Both outputs use lock code hash `0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8` with hash type `type`, and neither has a type script. Status: `Built only - NOT broadcasted`.

**Evidence:** [`03_transactions/`](./03_transactions/)

## 6. Wallet Connection

`create-ccc-app` did not create a new project because the `wallet-app` folder already existed, so I continued with the existing app.

`01_wallet_disconnected.png`: status Disconnected, network CKB Testnet, at `localhost:3002`.

`02_wallet_connected.png`, using UTXO Global Wallet:

| Field | Value |
|---|---|
| Status | Connected |
| Network | CKB Testnet |
| Address | `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqtn9ev8klx68jsgx6r93ryun8n9ldg0dzqpwl2de` |
| Balance | 0 CKB |
| Lock code hash | `0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8` |
| Hash type | `type` |
| Args | `0x732e587b7cda3ca083686588c9c99e65fb50f688` |

At first, the 0 CKB balance appeared to be a display issue. However, the dApp in Lesson 06 also reported 0 CKB and no live Cells for the same address, which confirms the account was simply unfunded at that time. This wallet uses the same lock code hash as the Playground signer in Section 7, but different lock args, so they are two separate accounts.

**Evidence:** [`04_wallet_integration/`](./04_wallet_integration/)

## 7. Live Cells and Balance

The queries in this section use the Playground signer, not the wallet in Section 6.

First live Cell, from `02_cell_details.png`:

| Field | Value |
|---|---|
| Transaction hash | `0x56834f7763533f4170ef3ed8728bd57eb8e2f6a59cf3b5bfa84b554e338606fe` |
| Output index | 0 |
| Capacity | 200 CKB |
| Lock code hash | `0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8` |
| Hash type | `type` |
| Lock args | `0x36053c1bbc237e164137c03664fe8384b2cf9b26` |
| Type script | none |
| Output data | `0x` |

`01_live_cells.png` shows the end of the list (Cells 11 to 14), each with output index 0.

Balance check, from `03_balance_verification.png`:

| Check | Printed value |
|---|---|
| Cells counted | 14 |
| Sampled capacity | 11870 CKB |
| `signer.getBalance()` | 11444 CKB |
| Balance in shannons | `1144400000000` |
| Sample matches total | `false` |

The two figures do not match (`Sample matches total: false`), yet the script still prints `Balance Verification: SUCCESS` because that line is unconditional. The result should therefore be read from the boolean, not from the final message.

**Follow-up check (21 November 2026).** To understand the difference, I queried the same lock (args `0x36053c1bbc237e164137c03664fe8384b2cf9b26`) directly through the Testnet RPC method `get_cells` and listed the type script and data of each Cell. The lock still held the same 14 Cells, including the Cells shown in `02_cell_details.png` and `01_live_cells.png`:

| Cells | Capacity | Type script | Output data |
|---|---|---|---|
| #1–#6 | 6 × 200 CKB | none | `0x` |
| #7, #8 | 2 × 142 CKB | `0xb193a0433d22b301…` | non-empty |
| #9 | 142 CKB | `0x25c29dc317811a6f…` | non-empty |
| #10 | 10000 CKB | none | `0x` |
| #11–#14 | 4 × 61 CKB | none | `0x` |

| Group | Total |
|---|---|
| All Cells | 11870 CKB |
| Plain Cells (no type script, empty data) | 11444 CKB |
| Cells with a type script and data | 426 CKB (3 × 142 CKB) |

This explains both observations:

- **426 CKB difference.** `signer.getBalance()` only counts plain CKB Cells, which total exactly 11444 CKB. The query in the script uses no filter, so it also includes three Cells carrying a type script and data. These appear to be token (UDT) Cells; their capacity is occupied by the token state and is not part of the spendable CKB balance.
- **14 Cells instead of 10.** The last argument of `findCellsByLock` is the page size of each RPC request, not a total limit. The `for await` loop keeps requesting pages until all Cells are returned.

I also reran a revised version of the script in the CCC Playground that separates plain Cells from Cells with a type script or data, and prints `SUCCESS` only when the plain total equals `getBalance()`. The Playground now requires a connected wallet, and its example wallet is a different account (100 CKB, no token Cells), so that run confirms the revised logic but not the original figures. The RPC query above is the evidence for the original account.

**Evidence:** [`05_cell_query/`](./05_cell_query/)

## 8. First dApp

The dApp, `ckb-simple-dapp`, runs on port 3010 and accepts only Testnet and `ckt1` addresses.

- `01_dapp_overview.png` shows the page before connecting.
- `02_wallet_connected.png` shows the same UTXO Global address as Lesson 04, with 0 CKB and no live Cells. No transfer was possible in that state.
- `03_live_cell_explorer.png` was captured after the address had been funded: one Cell of 10000 CKB, outpoint `0x31c4547cfd4d91eba779b351065d389e0fdcf0e7dbb03ae64c4ba62752418794:0`.
- `04_transaction_prepared.png` shows a transfer of 100 CKB to `ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq26faqtdckmmwjrtj2g0w6afu9slrvpnpgxh56gn`. The review panel lists 1 input, 2 outputs, 1 witness, and an estimated fee of 0.00015416 CKB, with the note that the transaction has not yet been signed or broadcast. Since the sender and recipient share the prefix `ckt1qzda`, the recipient has to be checked by the rest of the address, not by the prefix.
- `05_wallet_signing.png` shows the UTXO Global signing prompt for `http://localhost:3010`, account `tests`. The payload includes cell dep `0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37` with dep type `depGroup`, and the dApp button reads `Waiting for wallet / Testnet...`. The wallet popup displays the raw transaction JSON but not the fee; the fee of 0.00015416 CKB is visible on the dApp page behind it.

Explorer record from `06_transaction_confirmed.png`, timestamp 17:14:33 on 17 November 2026:

| Explorer field | Value |
|---|---|
| Transaction | `0x1fbed40716ac9950b9d74eb7018638f364f841812c749a64a4c2f6eedd887906` |
| Block height | 23092323 |
| Fee | 0.00015416 CKB |
| Fee rate | 33224 shannons/KB |
| Size | 460 bytes |
| Cycles | 1,639,157 |
| Status at capture | 0 Confirmation |
| Input 0 | 10000 CKB from the sender |
| Output 0 | 100 CKB to the recipient |
| Output 1 | 9899.99984584 CKB back to the sender |

The change output is consistent with the inputs: 10000 − 100 − 0.00015416 = 9899.99984584 CKB. The fee rate of this transaction (33224 shannons/KB) is very close to the value returned by `getFeeRate()` in Section 4 (33222 shannons/KB), which was queried about ten minutes later.

At the time of capture, the explorer still showed 0 confirmations. I rechecked the transaction on 21 November 2026: the RPC method `get_transaction` returned status `committed` in block 23092323, with the tip at 23135009 (42,686 confirmations), and the explorer page showed `1000+ Confirmations` with the same fee and amounts. The transaction is now well-confirmed on Testnet.

**Evidence:** [`06_first_dapp/`](./06_first_dapp/)

## 9. Summary and Next Steps

This week, I was able to build a Testnet transfer in TypeScript with the CCC SDK and submit it from my own dApp through a browser wallet. The transfer `0x1fbed40716ac9950b9d74eb7018638f364f841812c749a64a4c2f6eedd887906` has since been confirmed on Testnet.

Two lessons stand out from this week:

- A `SUCCESS` message printed by a script is not a reliable result on its own. In Lesson 05, that message appeared even though the balance check returned `false`; the final message should depend on the actual comparison.
- "Balance" in CKB depends on which Cells are counted. Summing every Cell under a lock includes Cells that hold token state, while `getBalance()` counts only plain CKB Cells. Identifying this required looking at the type script and data of each Cell rather than only at the totals.

All addresses and hashes in this report come from Testnet or the CCC Playground. No private keys appear in the screenshots.

### Plan for Week 03

Next week, I plan to focus on CKB Script development, starting with the validation model and basic Rust scripts. I also want to learn how to build and debug scripts using CKB Debugger, then explore how Type Scripts are used to validate token Cells, such as the three found in Section 7. This should help me better understand the on-chain logic behind the transactions I worked with this week.

| Lesson | Topic | Planned work |
|---|---|---|
| 01 | Script Fundamentals | Study CKB-VM, the validation model, and how Lock Scripts and Type Scripts are executed |
| 02 | Rust Development Setup | Verify Rust, Cargo, and CKB Debugger, and prepare a Script project |
| 03 | First Rust Script | Write and compile a simple Script in Rust |
| 04 | Script Debugging | Run the Script with CKB Debugger and observe the result and cycle count |
| 05 | Custom Lock Validation | Study and test a simple Lock Script validation rule |
| 06 | Type Script & UDT Basics | Analyse the structure of Type Scripts and token Cells, and test token data validation |

I would greatly appreciate any feedback or corrections on this report.
