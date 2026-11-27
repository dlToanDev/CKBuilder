
#![no_std]
#![no_main]

use ckb_std::{
    ckb_constants::Source,
    debug,
    default_alloc,
    entry,
    error::SysError,
    high_level::load_cell_data,
};

entry!(program_entry);
default_alloc!();

#[repr(i8)]
enum Error {
    LoadCellData = 1,
    InvalidTokenData = 2,
    AmountOverflow = 3,
    UnauthorizedMint = 4,
}

pub fn program_entry() -> i8 {
    match validate() {
        Ok(()) => 0,
        Err(error) => error as i8,
    }
}

// Calculate the total token amount in a script group
fn sum_tokens(source: Source) -> Result<u128, Error> {
    let mut total = 0u128;
    let mut index = 0;

    loop {
        match load_cell_data(index, source) {
            Ok(data) => {
                // Token amount occupies the first 16 bytes
                if data.len() < 16 {
                    debug!("Invalid token data length: {}", data.len());
                    return Err(Error::InvalidTokenData);
                }

                let mut amount_bytes = [0u8; 16];
                amount_bytes.copy_from_slice(&data[..16]);

                let amount = u128::from_le_bytes(amount_bytes);

                debug!("Cell {} token amount: {}", index, amount);

                total = total
                    .checked_add(amount)
                    .ok_or(Error::AmountOverflow)?;

                index += 1;
            }

            Err(SysError::IndexOutOfBound) => break,

            Err(_) => return Err(Error::LoadCellData),
        }
    }

    Ok(total)
}

fn validate() -> Result<(), Error> {
    debug!("=== CKB SIMPLE UDT VALIDATION ===");

    let input_total = sum_tokens(Source::GroupInput)?;
    let output_total = sum_tokens(Source::GroupOutput)?;

    debug!("Total input tokens: {}", input_total);
    debug!("Total output tokens: {}", output_total);

    // Prevent unauthorized token creation
    if output_total > input_total {
        debug!("Validation failed: unauthorized mint");
        return Err(Error::UnauthorizedMint);
    }

    if output_total < input_total {
        debug!("Burned tokens: {}", input_total - output_total);
    }

    debug!("Token validation passed");

    Ok(())
}
