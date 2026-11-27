
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
    / "simple-udt"
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


def encode_amount(amount):
    return to_hex(amount.to_bytes(16, "little"))


code_hash = to_hex(ckb_hash(binary))

# Placeholder lock for isolated Type Script tests
lock_script = {
    "code_hash": code_hash,
    "hash_type": "data2",
    "args": "0x"
}

type_script = {
    "code_hash": code_hash,
    "hash_type": "data2",
    "args": "0x" + "aa" * 32
}

cell_dep = {
    "out_point": {
        "tx_hash": "0x" + "22" * 32,
        "index": "0x0"
    },
    "dep_type": "code"
}


def token_cell(capacity):
    return {
        "capacity": hex(capacity * 10**8),
        "lock": lock_script,
        "type": type_script
    }


def create_mock(filename, inputs, outputs, invalid=False):

    tx_inputs = []
    mock_inputs = []

    for index, amount in enumerate(inputs):

        cell_input = {
            "previous_output": {
                "tx_hash": "0x" + "11" * 32,
                "index": hex(index)
            },
            "since": "0x0"
        }

        tx_inputs.append(cell_input)

        mock_inputs.append({
            "input": cell_input,
            "output": token_cell(1000),
            "data": encode_amount(amount),
            "header": None
        })

    tx_outputs = []
    outputs_data = []

    for index, amount in enumerate(outputs):

        tx_outputs.append(token_cell(200))

        if invalid and index == 0:
            outputs_data.append("0x0102")
        else:
            outputs_data.append(encode_amount(amount))

    dep_cell = {
        "capacity": hex((len(binary) + 100) * 10**8),
        "lock": lock_script,
        "type": None
    }

    mock_tx = {
        "mock_info": {
            "inputs": mock_inputs,
            "cell_deps": [{
                "cell_dep": cell_dep,
                "output": dep_cell,
                "data": to_hex(binary),
                "header": None
            }],
            "header_deps": []
        },
        "tx": {
            "version": "0x0",
            "cell_deps": [cell_dep],
            "header_deps": [],
            "inputs": tx_inputs,
            "outputs": tx_outputs,
            "outputs_data": outputs_data,
            "witnesses": ["0x"] * len(tx_inputs)
        }
    }

    path = MOCKS / filename
    path.write_text(json.dumps(mock_tx, indent=2))

    print(f"Created: {filename}")


create_mock(
    "valid_transfer.json",
    [600, 400],
    [300, 700]
)

create_mock(
    "unauthorized_mint.json",
    [1000],
    [1100]
)

create_mock(
    "valid_burn.json",
    [1000],
    [900]
)

create_mock(
    "invalid_token_data.json",
    [1000],
    [1000],
    invalid=True
)

create_mock(
    "amount_overflow.json",
    [(2**128) - 1, 1],
    [1000]
)

print("\n=== UDT INFORMATION ===")
print("Token amount format: uint128 little endian")
print("1000 tokens:", encode_amount(1000))
print("300 tokens:", encode_amount(300))
print("700 tokens:", encode_amount(700))
print("Contract code hash:", code_hash)
print("Mock generation completed.")
