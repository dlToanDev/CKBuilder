# CKBuilder — Week 03 Technical Report

| | |
|---|---|
| Participant | Hoang Anh Toan |
| Programme | Community Keeps Building — Builder Track |
| Reporting period | 26 November 2026 |
| Development environment | Ubuntu 24.04.5 LTS · Rust · CKB Debugger |
| Project | CKB Script Development |

## 1. Overview

After working with the Cell Model and CCC SDK in Weeks 01–02, I started writing CKB scripts in Rust this week.

I inspected the transfer from Week 02, set up the Rust toolchain, and built three small contracts: an argument/data check, a hash lock, and a simplified UDT validator. I tested them with CKB Debugger using local mock transactions.

I followed the Script Development Course and Rust scripting materials in the CKBuilder Handbook. For each contract, I tested both accepted and rejected inputs and recorded the return codes and cycles.

### Exercise summary

| Evidence | Topic | Work performed |
|---|---|---|
| [`01_validation_model/`](./01_validation_model/) | Validation model | Inspect the Week 02 transfer and count Lock and Type Script Groups |
| [`02_rust_setup/`](./02_rust_setup/) | Rust development | Verify the toolchain, configure Clang, and compile a contract |
| [`03_script_basics/`](./03_script_basics/) | Script basics | Read script arguments and compare them with output Cell data |
| [`04_script_debugging/`](./04_script_debugging/) | Debugging | Run three mock cases and record return codes and cycles |
| [`05_custom_lock_script/`](./05_custom_lock_script/) | Custom Lock Script | Test a hash lock with valid and invalid preimages |
| [`06_type_script_udt/`](./06_type_script_udt/) | Type Script and UDT | Test token transfers, rejected minting, burning, malformed data, and overflow |

## 2. Development Environment

All four contracts use the same Rust workspace and build configuration.

| Component | Version or configuration |
|---|---|
| Operating system | Ubuntu 24.04.5 LTS |
| Rust | 1.100.0 |
| Cargo | 1.100.0 |
| Rustup | 1.29.3 |
| Cargo Generate | 0.26.0 |
| GNU Make | 4.3 |
| Clang | 18.1.3 |
| CKB Debugger | 1.1.1 |
| ckb-std | 1.1.0 |
| Compilation target | `riscv64imac-unknown-none-elf` |

The workspace contains four contracts: `hello-world`, `script-basics`, `custom-lock`, and `simple-udt`.

```text
reports/week03/
├── 01_validation_model/
├── 02_rust_setup/
│   └── ckb-rust-script/
│       └── contracts/
│           ├── hello-world/
│           ├── script-basics/
│           ├── custom-lock/
│           └── simple-udt/
├── 03_script_basics/
├── 04_script_debugging/
├── 05_custom_lock_script/
└── 06_type_script_udt/
```

The transaction inspection exercise was performed on CKB Testnet through CCC Playground. All subsequent script execution tests were performed locally using mock transactions.

## 3. CKB Validation Model

I used the existing 100 CKB transfer from Week 02 for this exercise.

**Transaction hash:**

`0x1fbed40716ac9950b9d74eb7018638f364f841812c749a64a4c2f6eedd887906`

Using the CCC SDK, I retrieved the transaction, inspected its output Cells, and calculated the number of Lock and Type Script Groups. The saved results are in `01_script_details.png`, `02_script_groups.png`, and `03_validation_result.png`.

| Property | Result |
|---|---|
| Input Cells | 1 |
| Output Cells | 2 |
| Witnesses | 1 |
| Lock Script Groups | 1 |
| Type Script Groups | 0 |
| Total Input Capacity | 10000 CKB |
| Total Output Capacity | 9999.99984584 CKB |
| Transaction Fee | 0.00015416 CKB |
| Transaction Status | committed |

The transaction has two output Cells but only one input Lock Script Group to execute. The output locks will be checked when those Cells are spent in a later transaction.

Subtracting the output capacity from the input capacity gave the same fee recorded in Week 02: 0.00015416 CKB. This script reads the transaction and checks the totals; it does not rerun on-chain validation.

The inspection script counts Lock Script Groups from input Cells and Type Script Groups from both inputs and outputs. It groups scripts by their full script hash, so scripts sharing a code hash but having different arguments are counted separately.

**Evidence:** [`01_validation_model/`](./01_validation_model/) · [Inspection source](./01_validation_model/src/validation-model.ts)

## 4. Rust Development Setup

The first contract build failed because the build system could not locate Clang. Rust, Cargo, Cargo Generate, and the RISC-V target were already installed.

Clang 18 was also installed, but the compiler and archiver paths were empty during compilation. I set them explicitly:

```bash
export CLANG=/usr/bin/clang-18
export TARGET_CC=/usr/bin/clang-18
export TARGET_AR=/usr/bin/llvm-ar-18
export PATH="/usr/lib/llvm-18/bin:$PATH"
```

After applying these settings, the `hello-world` contract compiled successfully. The generated binary was approximately 21 KB and identified as an ELF 64-bit RISC-V executable.

I also checked the SHA256 checksum of the binary as a local build reference. This checksum is separate from the CKB script code hash used in transactions.

**Evidence:** [`02_rust_setup/`](./02_rust_setup/) · [Toolchain versions](./02_rust_setup/images/01_rust_environment.png) · [Build artifact](./02_rust_setup/images/03_contract_build.png)

## 5. CKB Script Basics

After fixing the build, I wrote `script-basics`. It reads its own script arguments and compares them with the data in output Cell `0`.

I used `load_script()` to get the arguments and `load_cell_data(0, Source::Output)` to read the output data. I added `debug!()` calls to print the values before comparing them.

Empty arguments return code `3`; a data mismatch returns code `4`. The data check uses output index `0` from the transaction, regardless of its Script Group. Failures to load the script or Cell data return codes `1` and `2`, respectively. I did not include those two failure cases in the tests below.

The final build completed without compiler warnings and produced a RISC-V binary of approximately 40 KB.

**Evidence:** [`03_script_basics/`](./03_script_basics/) · [Contract source](./02_rust_setup/ckb-rust-script/contracts/script-basics/src/main.rs)

## 6. Script Debugging

I used CKB Debugger to test the contract from the previous exercise. A small Python script generated mock transactions containing different combinations of arguments and Cell data. The following results correspond to `02_validation_pass.png`, `03_validation_fail.png`, and `04_empty_arguments.png`.

| Test Case | Expected Code | Actual Code | Cycles |
|---|---:|---:|---:|
| Valid Data | 0 | 0 | 40,950 |
| Invalid Data | 4 | 4 | 41,744 |
| Empty Arguments | 3 | 3 | 24,315 |

All three return codes matched the expected values. The empty-arguments case used 24,315 cycles, compared with 40,950 for the valid case, because it returned before loading the output data.

The logs show the arguments and output data for the mismatch case. In the empty-arguments case, execution stops before the output-data log.

To reproduce the valid case from `reports/week03/`:

```bash
ckb-debugger --tx-file 04_script_debugging/mocks/valid_data.json --script input.0.lock --mode fast
```

The mock JSON includes the contract binary in its Cell dependency data, so this command does not require a separate build artifact. `Run result` is the script return code; the cycle count is reported under `All cycles`.

**Evidence:** [`04_script_debugging/`](./04_script_debugging/) · [Mock generator](./04_script_debugging/src/generate_mocks.py) · [Mock transactions](./04_script_debugging/mocks/)

## 7. Custom Lock Script

For `custom-lock`, I used a hash check as the unlocking condition. The contract hashes the raw witness bytes with CKB-personalized Blake2b-256 and compares the result with the 32-byte hash in its script arguments.

I used `Source::GroupInput` to retrieve the witness associated with the current Lock Script Group.

The first version had an unresolved Blake2b import from `ckb-std`. I added `ckb-hash` with `default-features = false` and the `ckb-contract` feature enabled.

The contract compiled successfully after this change, producing a binary of approximately 50 KB.

| Test Case | Expected Code | Actual Code | Cycles |
|---|---:|---:|---:|
| Authorized Unlock | 0 | 0 | 85,422 |
| Unauthorized Unlock | 4 | 4 | 85,072 |
| Empty Witness | 3 | 3 | 27,768 |
| Invalid Arguments | 2 | 2 | 25,099 |

The correct preimage returned `0`, and the wrong preimage returned `4`. The other two cases checked an empty witness and arguments shorter than the required 32 bytes.

`03_authorized_unlock.png` and `04_unauthorized_unlock.png` record the preimage checks; `05_edge_cases.png` records the empty-witness and invalid-arguments cases. From `reports/week03/`, the valid case can be rerun with:

```bash
ckb-debugger --tx-file 05_custom_lock_script/mocks/valid_unlock.json --script input.0.lock --mode fast
```

This lock only checks knowledge of the preimage. It does not verify a signature or restrict the recipient, so I would keep it as a local learning example.

**Evidence:** [`05_custom_lock_script/`](./05_custom_lock_script/) · [Contract source](./02_rust_setup/ckb-rust-script/contracts/custom-lock/src/main.rs) · [Mock generator](./05_custom_lock_script/src/generate_mocks.py)

## 8. Type Script and UDT Validation

For `simple-udt`, I implemented the token conservation check used in sUDT: the output total must not exceed the input total.

The contract reads the first 16 bytes of each Cell's data as a little-endian `u128`. Data shorter than 16 bytes is rejected; trailing bytes are ignored. I used `Source::GroupInput` and `Source::GroupOutput` to sum only the Cells in the current Type Script Group.

The totals use `checked_add()` so that an overflowing sum returns an error.

| Test Case | Expected Code | Actual Code | Cycles |
|---|---:|---:|---:|
| Valid Token Transfer | 0 | 0 | 33,387 |
| Unauthorized Mint | 4 | 4 | 26,684 |
| Token Burn | 0 | 0 | 28,000 |
| Invalid Token Data | 2 | 2 | 19,560 |
| Amount Overflow | 3 | 3 | 21,166 |

The transfer case used inputs of 600 + 400 tokens and outputs of 300 + 700. Increasing the output total to 1100 was rejected. Reducing it from 1000 to 900 passed, allowing a burn of 100 tokens.

The malformed-data case uses a two-byte output (`0x0102`) and is rejected with code `2`. The overflow case sums two individually valid input amounts, `u128::MAX` and `1`; `checked_add()` detects that their total cannot fit in a `u128` and returns code `3`.

`03_valid_token_transfer.png`, `04_unauthorized_mint.png`, `05_token_burn.png`, and `06_edge_cases.png` record these results. To rerun the valid transfer from `reports/week03/`:

```bash
ckb-debugger --tx-file 06_type_script_udt/mocks/valid_transfer.json --script input.0.type --mode fast
```

These mocks use a placeholder lock. The command runs only the Type Script Group selected by `input.0.type`; it does not check the input locks or validate the whole transaction.

I have not implemented sUDT Owner Mode or authorized issuance. This version only checks transfers and burns of existing token amounts.

**Evidence:** [`06_type_script_udt/`](./06_type_script_udt/) · [Contract source](./02_rust_setup/ckb-rust-script/contracts/simple-udt/src/main.rs) · [Mock generator](./06_type_script_udt/src/generate_mocks.py)

## 9. Summary and Next Steps

I completed the six exercises planned in Week 02. The main setup issue was getting the build to use the installed Clang and archiver. After fixing those paths, I could build the contracts in the same workspace and test them with mock transactions.

The debugger results gave me something specific to check beyond compilation: whether each input reached the expected error branch and how many cycles it used. The UDT exercise also showed why selecting a Type Script Group is only part of checking a transaction. I still need to test these rules together with working input locks.

During the report review on 26 November 2026, all 12 saved mock cases were rerun with CKB Debugger 1.1.1 in `fast` mode. The return codes and cycle counts matched the tables in Sections 6–8. The embedded binaries also matched the code hashes of the selected scripts. Some error branches remain untested, including the load failures noted in Section 5.

All contract runs were local. Section 3 uses the existing Week 02 Testnet transfer; I did not deploy a new contract to Testnet or Mainnet this week.

### Plan for Week 04

Next week, I plan to work through the following topics:

| Lesson | Topic | Planned work |
|---|---|---|
| 01 | WebAssembly on CKB | Study how WebAssembly is executed on CKB and run a small local example |
| 02 | Type ID | Examine Cell identity and test creation and update rules |
| 03 | Advanced Duktape Examples | Review more complex JavaScript script examples and their validation logic |
| 04 | Performant WebAssembly | Compare build options and execution costs using a repeatable example |
| 05 | Cycle Optimization | Use debugger measurements to compare changes to the same validation rule |
| 06 | Language Choices and Molecule Serialization | Compare scripting approaches and practise encoding and decoding structured data |

For the performance exercises, I want to keep the validation rule the same and measure how changes to the implementation affect its cycle count.

Feedback on the Script Group handling and UDT test cases would be especially useful.
