# CKBuilder — Week 01 Technical Report

| | |
|---|---|
| Participant | Hoang Anh Toan |
| Programme | Community Keeps Building — Builder Track |
| Reporting period | 10–11 November 2026 |
| Development environment | Ubuntu 24.04.5 LTS · OffCKB Local Devnet |
| Project | CKB Learning Lab |

## 1. Overview

During the first week of CKBuilder, I focused on understanding how Nervos CKB represents assets and application state, then applying those concepts through transactions on a local development network. The work covered environment setup, CKB transfers, Cell data, fungible tokens, digital objects, and Lock Script authorization.

For the practical exercises, I used CKB Learning Lab, a TypeScript-based application that brings the main workflows into one browser interface. The application communicates with an OffCKB Devnet and provides a consistent way to submit transactions, inspect Cells, and review their status. Keeping the exercises in one environment was particularly useful when comparing how different operations are represented on-chain.

A recurring lesson was that the action shown in an interface is only part of the story. Whether I was transferring CKB, moving tokens, or spending a locked Cell, the underlying operation involved consuming existing Cells and creating new outputs. Examining those inputs and outputs helped me understand the results more clearly than relying on a success message alone.

### Exercise summary

| Evidence | Topic | Work performed |
|---|---|---|
| [`01_environment/`](./01_environment/) | Development environment | Set up OffCKB, access Devnet accounts, and verify RPC connectivity |
| [`02_ckb_transfer/`](./02_ckb_transfer/) | CKB transfer | Transfer CKB between local accounts and inspect the confirmed transaction |
| [`03_cell_data/`](./03_cell_data/) | Cell data | Write a message to a Cell and read it back |
| [`04_fungible_token/`](./04_fungible_token/) | Fungible token | Issue CKBT, inspect token Cells, and test transfers |
| [`05_dob/`](./05_dob/) | Digital object | Create a TYPE_ID object, read it back, and transfer it to Account #1 |
| [`06_lock_script/`](./06_lock_script/) | Lock Script | Inspect a standard lock and compare authorized and unauthorized spending |

## 2. Development Environment and Approach

All exercises were performed against a local OffCKB Devnet, rather than CKB mainnet or a public testnet. This provided a controlled environment in which I could work with development accounts and inspect blockchain behavior without using real funds.

| Component | Version or configuration |
|---|---|
| Operating system | Ubuntu 24.04.5 LTS |
| Node.js | v22.23.2 |
| npm | 10.9.8 |
| Git | 2.43.0 |
| OffCKB CLI | 0.4.13 |
| CKB RPC | `http://127.0.0.1:8114` |
| CKB Learning Lab | `http://localhost:2507` |
| Backend | Node.js, Express, TypeScript |
| Frontend | HTML, CSS, Vanilla JavaScript |
| CKB integration | CCC SDK (`@ckb-ccc/core`) |

The repository separates the application from the supporting evidence:

```text
CKBuilder/
├── ckb-learning-lab/
└── reports/
    └── week01/
        ├── 01_environment/
        ├── 02_ckb_transfer/
        ├── 03_cell_data/
        ├── 04_fungible_token/
        ├── 05_dob/
        └── 06_lock_script/
```

I started the local node with `offckb node` and launched the application separately with `npm run dev`. Running the two components independently made troubleshooting more straightforward: I could distinguish application errors from RPC connectivity issues and check whether a transaction had actually reached the network.

For each exercise, I tried to verify the result through the transaction status and relevant Cell information. A submitted transaction hash was useful for tracking progress, but I treated **committed** as the stronger indication that a transaction had been included in a block.

## 3. CKB Transfer: From Submission to Confirmation

The first transaction exercise involved transferring 100 CKB from Devnet Account #0 to Account #1. After submitting the transaction through the Learning Lab, I inspected its status and output structure.

**Transaction hash**

`0x7331bf4e510c8b0f11a7b0c4508138e81cf576f014056ad512868a884386cca4`

The transaction was recorded as committed in block 87. Its inspection view showed one input and two outputs. One output represented the transfer to the recipient, while the other accounted for the remaining capacity.

This was an important introduction to the Cell Model. Instead of interpreting the transfer only as a change in two account balances, I could see the specific Cell being consumed and the new Cells produced by the transaction. It also established a verification habit that I used throughout the remaining exercises: check the transaction details before describing an operation as complete.

**Evidence:** [`02_ckb_transfer/`](./02_ckb_transfer/)

## 4. Reading and Writing Cell Data

The next exercise examined how application data can be included in a CKB Cell. I used the following message as the test content:

`Hello CKB!`

The application displayed its encoded representation as `0x48656c6c6f20434b4221`. After submitting the write transaction, I used the read function to retrieve the value from the chain.

**Write transaction hash**

`0x7219569e29811300d0d010b0430d6f581223bd71708ae4f2060c35d11ec8f45c`

The transaction was confirmed at block 799. The read operation returned `Hello CKB!`, and the application reported a successful verification.

The exercise clarified the distinction between a Cell's data and the Cell itself. The message was the application content, but storing it still required a valid Cell structure, an appropriate lock, and sufficient capacity. That distinction becomes relevant when working with more complex on-chain data later.

**Evidence:** [`03_cell_data/`](./03_cell_data/)

## 5. Fungible Token: Issuing and Transferring CKBT

For the token exercise, I created CKBuilder Token (CKBT) with an initial supply of 1,000 tokens using an sUDT-based implementation. The application provided separate views for token configuration, issuance, balance inspection, and transfers.

**Mint transaction hash**

`0x7c732722e0e84bc87fb9ab3a87aa4a0775e572678412100278689c26dfc3f848`

The mint transaction was confirmed. I then inspected the token's balance and associated Cell information, including the type hash and script dependencies. This helped distinguish the CKBT amount from the CKB capacity required to hold its Cells.

I completed two confirmed transfers of 10 CKBT each from Account #0 to Account #1. At that point, the displayed balances were:

| Account | Recorded CKBT balance |
|---|---|
| Account #0 | 980 CKBT |
| Account #1 | 20 CKBT |

A later transfer of 15 CKBT used this hash:

`0x93878335d160be85e60fedf388f627bd793aa9caf5d4bed28d0af73e94709c25`

`06_token_transfer.png` shows that submission. `07_token_transfer.png` shows the same hash as **committed**, with 0 pending. The balance screenshot still shows Account #0 at 980 CKBT, which matches the state after the two 10 CKBT transfers and before this 15 CKBT confirmation. I have not used a later balance screenshot, so I am not stating a new balance for that transfer.

This exercise demonstrated that a fungible-token transfer involves more than a token amount. The transaction must also use the correct type script, satisfy the lock conditions of its input Cells, and allocate sufficient capacity for its outputs.

**Evidence:** [`04_fungible_token/`](./04_fungible_token/)

## 6. Digital Objects and Ownership

The Digital Object module used the lab's custom Cell format with a built-in TYPE_ID, not a Spore mint. The object checked in the view screenshots was **My First CKB DOB**, with description `My first digital object on Nervos CKB`, content type `text/plain`, and content `Hello CKB DOB!`.

| Item | Value shown |
|---|---|
| Object ID | `0xe5715ce1d98b53973627da52f23d8a6c20fcb37ec960327aaeacc826e94f5f5d` |
| Creation transaction | `0x71cfaebaccc808945882fae1cc536fbe389897910f1288e8b31081d02cacc37f` |
| Creation status | committed, block 13964 |
| Owner after creation | Account #0 |
| Cell capacity | 307 CKB |
| Data source | on-chain live Cell, matching the saved creation data |
| Transfer transaction | `0xf25db94528c074156a1609c583e6c2e9107c3489c424afbd5325af077f5fb69c` |
| Transfer status | committed, block 14166 |
| Receiver | Account #1 |
| Current owner after transfer | Account #1 |

`03_dob_creation.png` and `04_dob_details.png` show the live Cell after creation. `05_dob_transfer.png` shows the transfer inspection as committed. `06_dob_verified.png` shows both operations committed and the current owner as Account #1.

The same history screenshot also lists an earlier object, ID `0x3137420a484dd5b0ccd8d1ecc5e7a710cc30a6d63852e11fdfc7d0bbcba10d36` (`CKB DOB`, content `Hello CKB DOB! I'm Toan`). Its creation `0x4637a38c16e01414055359449c188c4e471a909dd5c5a15562df56d63cd8d1d0` is committed at block 13789, and its transfer `0xa7009049b04b7d95bb3a3d40f05547efa144185028e74834b10aaafa336de06b` is committed at block 14147. The current owner shown there is also Account #1.

The main point I took from this work was the need to distinguish displayed metadata from verified ownership. An interface may retain an object's name or a previously selected owner, but the current state must ultimately be checked through the relevant on-chain Cell and the lock that controls it.

**Evidence:** [`05_dob/`](./05_dob/)

## 7. Lock Script: Testing Spending Authorization

The Lock Script exercise provided the clearest demonstration of how CKB enforces spending conditions. I used the standard Secp256k1 / Blake160 lock available on the local OffCKB network. This was an investigation of an existing script, not the development or deployment of a custom hash-lock contract.

The inspection view displayed the account address, code hash, hash type, script arguments, script hash, and relevant Cell dependencies. It also reported the minimum Cell capacity for the selected configuration.

### Creating a locked Cell

I selected Account #0 as the authorized owner and entered 150 CKB in the creation form. The screenshot shows the submitted transaction `0x2fcae00915f642c82330fd7907fe90be35cb12c447a171491bde210674a720fb`, output index 0, with status **pending**.

### Verifying the unauthorized case

The next test attempted to satisfy the lock with a key that did not belong to the authorized account. Because Account #1's backend key was unavailable during this run, the application used a temporary unauthorized key.

Rather than broadcasting an invalid transaction, the test used Devnet's `estimate_cycles` validation path. The script returned:

`ValidationFailure -31 (ERROR_PUBKEY_BLAKE160_HASH)`

This result is meaningful because the failure occurred during Lock Script validation. The signer did not meet the public-key-hash condition required to spend the selected Cell. The test also included a valid-signature control, which helped distinguish an authorization failure from a generally invalid transaction template.

### Confirming an authorized spend

For the authorized transaction, Account #0 was the signer and Account #1 was the destination. The final verification screen reported:

| Verification item | Observed result |
|---|---|
| Transaction hash | `0x6ff726ef1d9cc26afeaa41b81cde4332e85e55d755cc036b8981231d0bbbfbb3` |
| Transaction status | committed |
| Block number | 14978 |
| New output | Index 0, reported as live |
| Original input Cell | Reported as consumed |
| Script authorization | Passed |
| Unauthorized spending test | Failed for the expected reason |

The verification panel marked its learning checks as passed. It also clarified a point that initially required attention: the `:0` suffix in a Cell outpoint indicates output index zero, not a transfer of zero CKB. The amount of CKB belongs to the Cell's capacity field.

The unauthorized-spending screenshot and the final verification do not use the 150 CKB creation above. Both use outpoint `0xbd02fead9a21960925512d32644861c4211eb6a0a24fbfbb5ccabf25deb279a7:0`, shown as **100 CKB**. The creation screenshot is still pending and has a different hash. These screenshots support the individual test outcomes, but they are not one uninterrupted Cell history.

**Evidence:** [`06_lock_script/`](./06_lock_script/)

## 8. Technical Observations and Challenges

Several details became more significant as I reviewed the transactions and screenshots together.

**Transaction submission and confirmation are different stages.** A transaction hash shows that a transaction has been constructed or submitted, but it does not by itself establish confirmation. The 15 CKBT transfer and the 150 CKB locked-Cell creation were first captured as submitted or pending. Later screenshots confirm the 15 CKBT transfer. The locked-Cell creation screenshot itself remains pending.

**Cell outpoints must be interpreted precisely.** A transaction hash combined with an output index identifies a particular Cell. An outpoint ending in `:0` refers to the first output, while the Cell's capacity records its CKB amount. Understanding this avoided a misleading interpretation of the Lock Script result.

**An expected failure still needs technical evidence.** In the unauthorized-spending test, the error code `-31` was more informative than a generic failure notification. Together with the authorized control, it showed that the rejection was related to the lock's signature condition.

**Evidence should allow a transaction to be traced.** Some screenshots were captured at different stages or referenced different Cells. I found that a useful screenshot should identify the transaction hash, output index, and status wherever possible. These details make subsequent review more reliable and reduce ambiguity when several transactions are performed in the same module.

## 9. Key Learning Outcomes

By the end of this reporting period, I had a more practical understanding of the relationship between CKB transactions, Cells, and scripts. The transfer and data exercises established the basic structure; the CKBT exercise introduced type-script-controlled assets; and the Lock Script tests showed how spending authorization is enforced.

I also became more careful about what constitutes a verified result. The screenshots now cover the 100 CKB transfer, the Cell-data write and readback, CKBT issuance and the later 15 CKBT transfer, the DOB creation and ownership transfer, and the Lock Script authorization checks. The 150 CKB creation form and the 100 CKB Cell used in the lock tests still refer to different outpoints.

Using a shared Learning Lab reduced the amount of setup needed between exercises and made it easier to revisit transaction details. For future reports, I intend to keep the evidence more closely linked to individual transaction outpoints so that the sequence of operations can be followed without ambiguity.

## 10. Next Steps

In Week 2, I plan to spend more time examining how CKB transactions are assembled in code. My immediate focus will be the CCC SDK and its TypeScript examples, particularly how inputs, outputs, witnesses, fees, and Cell dependencies are prepared and submitted.

I also intend to begin studying CKB Script development with Rust and become familiar with tools used to investigate script execution. The goal is to move beyond operating the completed interface and become more confident in explaining why a transaction succeeds or fails from its underlying data.

## 11. Evidence and Reporting Notes

The links in this report refer to the exercise folders in my local repository, not to another participant's project. Before publication, the following items should be checked against the saved screenshots and transaction records:

- Confirm that each exercise folder contains the corresponding evidence files.
- Keep the 150 CKB pending creation separate from the 100 CKB Cell used in the unauthorized and authorized lock tests.
- Ensure that screenshots do not expose private keys or other signing secrets.

All transaction hashes and block heights listed here refer to local Devnet activity. They are included as records of the exercises and should not be interpreted as public mainnet transactions.
