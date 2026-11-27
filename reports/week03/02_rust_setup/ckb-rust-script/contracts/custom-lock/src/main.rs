
#![no_std]
#![no_main]

use ckb_hash::blake2b_256;

use ckb_std::{
    ckb_constants::Source,
    debug,
    default_alloc,
    entry,
    high_level::{load_script, load_witness},
};

entry!(program_entry);
default_alloc!();

#[repr(i8)]
enum Error {
    LoadScript = 1,
    InvalidArgs = 2,
    InvalidWitness = 3,
    HashMismatch = 4,
}

pub fn program_entry() -> i8 {
    match validate() {
        Ok(()) => 0,
        Err(error) => error as i8,
    }
}

fn validate() -> Result<(), Error> {
    debug!("=== CKB CUSTOM HASH LOCK ===");

    // Load expected hash from script arguments
    let script = load_script()
        .map_err(|_| Error::LoadScript)?;

    let args = script.args().raw_data();

    debug!("Arguments length: {}", args.len());

    if args.len() != 32 {
        debug!("Invalid arguments: expected 32 bytes");
        return Err(Error::InvalidArgs);
    }

    // Load witness from the current lock group
    let witness = load_witness(0, Source::GroupInput)
        .map_err(|_| Error::InvalidWitness)?;

    debug!("Witness length: {}", witness.len());

    if witness.is_empty() {
        debug!("Invalid witness: empty preimage");
        return Err(Error::InvalidWitness);
    }

    // Calculate CKB Blake2b-256 hash
    let calculated_hash = blake2b_256(&witness);

    debug!("Expected hash: {:02x?}", args.as_ref());
    debug!("Calculated hash: {:02x?}", calculated_hash);

    // Verify the unlocking condition
    if args.as_ref() != calculated_hash.as_slice() {
        debug!("Unlock rejected: hash mismatch");
        return Err(Error::HashMismatch);
    }

    debug!("Unlock authorized: hash matched");

    Ok(())
}
