use std::fs;
use std::ops::Range;
use std::path::Path;

use probe_rs::config::MemoryRegion;
use sha2::{Digest, Sha256};

use crate::domain::error::NativeError;
use crate::domain::flash_plan::BinaryFlashPlan;
use crate::services::target_catalog_service;

const MAX_FIRMWARE_BYTES: u64 = 512 * 1024 * 1024;

pub fn plan_binary(
    root: &Path,
    pack_id: &str,
    pack_sha256: &str,
    device: &str,
    firmware: &Path,
    start_address: &str,
) -> Result<BinaryFlashPlan, NativeError> {
    if pack_sha256.len() != 64 || !pack_sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(NativeError::invalid_argument("Invalid Pack SHA-256"));
    }
    let start = parse_address(start_address)?;
    let size = fs::metadata(firmware)?.len();
    if size == 0 || size > MAX_FIRMWARE_BYTES {
        return Err(NativeError::invalid_argument(
            "BIN must be between 1 byte and 512 MiB",
        ));
    }
    let end = start
        .checked_add(size)
        .ok_or_else(|| NativeError::invalid_argument("Firmware address range overflows"))?;

    let (registry, analysis) =
        target_catalog_service::load_validated_registry(root, pack_id, pack_sha256)?;
    if !analysis
        .targets
        .iter()
        .any(|target| target.name == device && target.ready)
    {
        return Err(NativeError::invalid_argument(
            "Device target definition is not validated",
        ));
    }
    let target = registry.get_target_by_name(device).map_err(|error| {
        NativeError::invalid_argument(format!("Unknown converted target: {error}"))
    })?;
    let regions: Vec<_> = target
        .memory_map
        .iter()
        .filter_map(|region| match region {
            MemoryRegion::Nvm(nvm)
                if !nvm.is_alias && nvm.range.start <= start && end <= nvm.range.end =>
            {
                Some(nvm)
            }
            _ => None,
        })
        .collect();
    if regions.len() != 1 {
        return Err(NativeError::invalid_argument(
            "BIN range must fit exactly one non-alias Flash region",
        ));
    }
    let mut algorithms: Vec<_> = target
        .flash_algorithms
        .iter()
        .filter(|algorithm| {
            algorithm.flash_properties.address_range.start <= start
                && end <= algorithm.flash_properties.address_range.end
        })
        .collect();
    if algorithms.len() > 1 {
        let defaults: Vec<_> = algorithms
            .iter()
            .copied()
            .filter(|algorithm| algorithm.default)
            .collect();
        if defaults.len() == 1 {
            algorithms = defaults;
        }
    }
    if algorithms.len() != 1 {
        return Err(NativeError::invalid_argument(
            "BIN range must have exactly one Flash algorithm; choose a different target or address",
        ));
    }
    let properties = &algorithms[0].flash_properties;
    let sectors: Vec<_> = properties
        .sectors
        .iter()
        .map(|sector| (sector.address, sector.size))
        .collect();
    let (erase_start, erase_end, erase_sector_count) =
        erase_footprint(properties.address_range.clone(), &sectors, start, end)?;
    let bytes = fs::read(firmware)?;
    if bytes.len() as u64 != size {
        return Err(NativeError::io("Firmware file changed during planning"));
    }
    Ok(BinaryFlashPlan {
        pack_id: pack_id.to_owned(),
        pack_sha256: pack_sha256.to_owned(),
        device: device.to_owned(),
        firmware_sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_count: size,
        start_address: format!("0x{start:08X}"),
        end_address_exclusive: format!("0x{end:08X}"),
        memory_region: regions[0]
            .name
            .clone()
            .unwrap_or_else(|| "unnamed Flash".to_owned()),
        flash_algorithm: algorithms[0].name.clone(),
        erase_start_address: format!("0x{erase_start:08X}"),
        erase_end_address_exclusive: format!("0x{erase_end:08X}"),
        erase_sector_count,
    })
}

fn erase_footprint(
    flash: Range<u64>,
    sectors: &[(u64, u64)],
    start: u64,
    end: u64,
) -> Result<(u64, u64, usize), NativeError> {
    let mut address = start;
    let mut first = None;
    let mut last = start;
    let mut count = 0;
    while address < end {
        let relative = address - flash.start;
        let (group_offset, size) = sectors
            .iter()
            .copied()
            .filter(|(offset, _)| *offset <= relative)
            .max_by_key(|(offset, _)| *offset)
            .ok_or_else(|| NativeError::invalid_argument("Flash sector layout is incomplete"))?;
        if size == 0 {
            return Err(NativeError::invalid_argument("Flash sector size is zero"));
        }
        let group_start = flash
            .start
            .checked_add(group_offset)
            .ok_or_else(|| NativeError::invalid_argument("Flash sector address overflows"))?;
        let next_group = sectors
            .iter()
            .filter(|(offset, _)| *offset > group_offset)
            .map(|(offset, _)| flash.start.saturating_add(*offset))
            .min()
            .unwrap_or(flash.end)
            .min(flash.end);
        let sector_start = group_start + ((address - group_start) / size) * size;
        let sector_end = sector_start
            .checked_add(size)
            .ok_or_else(|| NativeError::invalid_argument("Flash sector address overflows"))?;
        if sector_end > next_group || sector_end > flash.end {
            return Err(NativeError::invalid_argument(
                "Flash sector crosses its declared region",
            ));
        }
        first.get_or_insert(sector_start);
        last = sector_end;
        address = sector_end;
        count += 1;
    }
    Ok((
        first.ok_or_else(|| NativeError::invalid_argument("No Flash sectors selected"))?,
        last,
        count,
    ))
}

fn parse_address(input: &str) -> Result<u64, NativeError> {
    let value = input.trim();
    if value.is_empty() {
        return Err(NativeError::invalid_argument(
            "BIN start address is required",
        ));
    }
    let parsed = if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16)
    } else {
        value.parse::<u64>()
    };
    parsed.map_err(|_| NativeError::invalid_argument("Invalid BIN start address"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_explicit_address() {
        assert!(parse_address("").is_err());
        assert_eq!(parse_address("0x08000000").unwrap(), 0x08000000);
        assert_eq!(parse_address("134217728").unwrap(), 0x08000000);
    }

    #[test]
    fn previews_sectors_across_size_boundaries() {
        let sectors = [
            (0, 16 * 1024),
            (64 * 1024, 64 * 1024),
            (128 * 1024, 128 * 1024),
        ];
        assert_eq!(
            erase_footprint(0x0800_0000..0x0810_0000, &sectors, 0x0800_F000, 0x0802_0100).unwrap(),
            (0x0800_C000, 0x0804_0000, 3)
        );
    }
}
