use std::ops::Range;

use probe_rs::{MemoryInterface, Session};

use crate::domain::error::NativeError;
use crate::domain::probe::TargetIdentityResult;

/// A provider validates the physical Flash geometry before the generic
/// programmer is allowed to use a Pack-supplied target and algorithm.
pub struct ValidatedIdentity {
    pub report: TargetIdentityResult,
    pub flash_range: Range<u64>,
    pub erase_sectors: Vec<Range<u64>>,
}

pub fn inspect(session: &mut Session) -> Result<ValidatedIdentity, NativeError> {
    let target_name = session.target().name.as_str();
    if target_name.starts_with("STM32F407ZG") {
        return inspect_stm32f407zg(session);
    }
    Err(NativeError::invalid_argument(format!(
        "No physical target identity provider for {target_name}"
    )))
}

pub(crate) fn stm32f407zg_erase_sectors() -> Vec<Range<u64>> {
    (0..4)
        .map(|index| {
            let start = 0x0800_0000 + index * 0x4000;
            start..start + 0x4000
        })
        .chain(std::iter::once(0x0801_0000..0x0802_0000))
        .chain((0..7).map(|index| {
            let start = 0x0802_0000 + index * 0x20000;
            start..start + 0x20000
        }))
        .collect()
}

fn inspect_stm32f407zg(session: &mut Session) -> Result<ValidatedIdentity, NativeError> {
    // RM0090: DEV_ID 0x413 covers STM32F405/407/415/417; it cannot prove
    // the package or exact printed part. The board owner confirms the marking.
    let mut core = session
        .core(0)
        .map_err(|error| NativeError::io(format!("Open core failed: {error}")))?;
    let idcode = core
        .read_word_32(0xE004_2000)
        .map_err(|error| NativeError::io(format!("Read DBGMCU ID failed: {error}")))?;
    // RM0090 locates the 16-bit F_ID at 0x1FFF7A22. Read its containing
    // aligned word: some CMSIS-DAP transports return the lower halfword for
    // a halfword access at +2, which produces a bogus capacity (e.g. 4610 KiB).
    let size_word = core
        .read_word_32(0x1FFF_7A20)
        .map_err(|error| NativeError::io(format!("Read Flash size failed: {error}")))?;
    let flash_kib = flash_size_from_aligned_word(size_word);
    Ok(ValidatedIdentity {
        report: TargetIdentityResult {
            device_id: format!("0x{:03X}", idcode & 0x0FFF),
            flash_kib,
            flash_compatible: (idcode & 0x0FFF) == 0x413 && flash_kib == 1024,
            exact_part_verified: false,
            expected_marking: "STM32F407ZGT6".to_owned(),
        },
        flash_range: 0x0800_0000..0x0810_0000,
        erase_sectors: stm32f407zg_erase_sectors(),
    })
}

fn flash_size_from_aligned_word(word: u32) -> u16 {
    (word >> 16) as u16
}

#[cfg(test)]
mod tests {
    use super::flash_size_from_aligned_word;

    #[test]
    fn flash_size_uses_upper_halfword_at_offset_two() {
        assert_eq!(flash_size_from_aligned_word(0x0400_1202), 1024);
        assert_eq!(flash_size_from_aligned_word(0x0200_1202), 512);
    }
}
