
import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOCKS = ROOT / "mocks"

BINARY = (
    ROOT.parent
    / "02_rust_setup"
    / "ckb-rust-script"
    / "build"
    / "release"
    / "custom-lock"
)

binary = BINARY.read_bytes()

MOCKS.mkdir(parents=True, exist_ok=True)


def ckb_hash(data):
    return hashlib.blake2b(
        data,
        digest_size=32,
        person=b"ckb-default-hash"
    ).digest()


def to_hex(data):
    return "0x" + data.hex()


code_hash = to_hex(ckb_hash(binary))

secret = b"CKBuilder2026"
expected_hash = ckb_hash(secret)

input_hash = "0x" + "11" * 32
dep_hash = "0x" + "22" * 32


def create_mock(filename, args, witness):

    lock = {
        "code_hash": code_hash,
        "hash_type": "data2",
        "args": to_hex(args)
    }

    cell_input = {
        "previous_output": {
            "tx_hash": input_hash,
            "index": "0x0"
        },
        "since": "0x0"
    }

    cell_dep = {
        "out_point": {
            "tx_hash": dep_hash,
            "index": "0x0"
        },
        "dep_type": "code"
    }

    input_cell = {
        "capacity": hex(1000 * 10**8),
        "lock": lock,
        "type": None
    }

    output_cell = {
        "capacity": hex(999 * 10**8),
        "lock": lock,
        "type": None
    }

    dep_cell = {
        "capacity": hex(
            (len(binary) + 100) * 10**8
        ),
        "lock": lock,
        "type": None
    }

    mock_tx = {
        "mock_info": {
            "inputs": [
                {
                    "input": cell_input,
                    "output": input_cell,
                    "data": "0x",
                    "header": None
                }
            ],
            "cell_deps": [
                {
                    "cell_dep": cell_dep,
                    "output": dep_cell,
                    "data": to_hex(binary),
                    "header": None
                }
            ],
            "header_deps": []
        },
        "tx": {
            "version": "0x0",
            "cell_deps": [cell_dep],
            "header_deps": [],
            "inputs": [cell_input],
            "outputs": [output_cell],
            "outputs_data": ["0x"],
            "witnesses": [to_hex(witness)]
        }
    }

    path = MOCKS / filename
    path.write_text(json.dumps(mock_tx, indent=2))

    print(f"Created: {filename}")
    print(f"  Args length: {len(args)}")
    print(f"  Witness: {witness!r}")


create_mock(
    "valid_unlock.json",
    expected_hash,
    secret
)

create_mock(
    "invalid_unlock.json",
    expected_hash,
    b"WrongPassword"
)

create_mock(
    "empty_witness.json",
    expected_hash,
    b""
)

create_mock(
    "invalid_args.json",
    b"invalid",
    secret
)

print("\n=== HASH LOCK INFORMATION ===")
print("Test preimage:", secret.decode())
print("Expected hash:", to_hex(expected_hash))
print("Contract code hash:", code_hash)
print("Mock generation completed.")
