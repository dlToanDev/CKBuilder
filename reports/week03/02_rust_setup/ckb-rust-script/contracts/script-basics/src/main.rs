
#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    debug,
    default_alloc,
    entry,
    high_level::{load_cell_data, load_script},
};

entry!(program_entry);
default_alloc!();

#[repr(i8)]
enum Error {
    LoadScript = 1,
    LoadCellData = 2,
    EmptyArgs = 3,
    DataMismatch = 4,
}

pub fn program_entry() -> i8 {
    match validate() {
        Ok(()) => 0,
        Err(error) => error as i8,
    }
}

fn validate() -> Result<(), Error> {
    debug!("=== CKB SCRIPT BASICS ===");

    // Load current script and arguments
    let script = load_script()
        .map_err(|_| Error::LoadScript)?;

    let args = script.args().raw_data();

    debug!("Script arguments: {:?}", args.as_ref());
    debug!("Arguments length: {}", args.len());

    // Reject empty arguments
    if args.is_empty() {
        debug!("Validation failed: empty arguments");
        return Err(Error::EmptyArgs);
    }

    // Load data from the first output cell
    let cell_data = load_cell_data(0, Source::Output)
        .map_err(|_| Error::LoadCellData)?;

    debug!("Output cell data: {:?}", cell_data);
    debug!("Cell data length: {}", cell_data.len());

    // Compare script arguments with cell data
    if args.as_ref() != cell_data.as_slice() {
        debug!("Validation failed: data mismatch");
        return Err(Error::DataMismatch);
    }

    debug!("Validation passed");

    Ok(())
}
