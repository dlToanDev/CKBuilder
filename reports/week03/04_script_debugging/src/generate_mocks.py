
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
    / "script-basics"
)

binary = BINARY.read_bytes()

code_hash = "0x" + hashlib.blake2b(
    binary,
    digest_size=32,
    person=b"ckb-default-hash"
).hexdigest()

input_hash = "0x" + "11" * 32
dep_hash = "0x" + "22" * 32

MOCKS.mkdir(parents=True, exist_ok=True)


def to_hex(text):
    return "0x" + text.encode().hex()


def create_mock(filename, args, data):
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
                    "data": "0x" + binary.hex(),
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
            "outputs_data": [to_hex(data)],
            "witnesses": ["0x"]
        }
    }

    path = MOCKS / filename

    path.write_text(
        json.dumps(mock_tx, indent=2)
    )

    print(f"Created: {filename}")
    print(f"  Args: {args!r}")
    print(f"  Data: {data!r}")


create_mock(
    "valid_data.json",
    "Hello CKB",
    "Hello CKB"
)

create_mock(
    "invalid_data.json",
    "Hello CKB",
    "Hello Rust"
)

create_mock(
    "empty_arguments.json",
    "",
    "Hello CKB"
)

print("\nMock transaction generation completed.")
