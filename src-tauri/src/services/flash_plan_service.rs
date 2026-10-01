use std::fs;
use std::ops::Range;
use std::path::Path;

use probe_rs::config::{MemoryRegion, Target};
use sha2::{Digest, Sha256};

use crate::domain::error::NativeError;
use crate::domain::flash_plan::{BinaryFlashPlan, FirmwareSegmentPlan};
use crate::services::{firmware_image, target_catalog_service};

const MAX_FIRMWARE_BYTES: u64 = 512 * 1024 * 1024;

/// Resolve the one primary Flash area that a Pack can safely describe as a
/// full-erase target. No silicon-specific ID or capacity register is read.
pub fn plan_full_erase(target: &Target) -> Result<Range<u64>, NativeError> {
    let nvm_regions: Vec<_> = target
        .memory_map
        .iter()
        .filter_map(|region| match region {
            MemoryRegion::Nvm(nvm) if !nvm.is_alias => Some(nvm),
            _ => None,
        })
        .collect();
    let region = if nvm_regions.len() == 1 {
        nvm_regions[0]
    } else {
        return Err(NativeError::invalid_argument(
            "Pack must define exactly one non-alias Flash region for full erase",
        ));
    };
    let range = region.range.clone();
    if range.start >= range.end {
        return Err(NativeError::invalid_argument(
            "Primary Flash range is empty",
        ));
    }
    let algorithms: Vec<_> = target
        .flash_algorithms
        .iter()
        .filter(|algorithm| {
            algorithm.flash_properties.address_range.start <= range.start
                && range.end <= algorithm.flash_properties.address_range.end
        })
        .collect();
    if algorithms.len() != 1 {
        return Err(NativeError::invalid_argument(
            "Full erase requires one Flash algorithm covering the primary region",
        ));
    }
    let properties = &algorithms[0].flash_properties;
    let sectors: Vec<_> = properties
        .sectors
        .iter()
        .map(|sector| (sector.address, sector.size))
        .collect();
    let (erase_start, erase_end, sector_count) = erase_footprint(
        properties.address_range.clone(),
        &sectors,
        range.start,
        range.end,
    )?;
    if erase_start != range.start || erase_end != range.end || sector_count == 0 {
        return Err(NativeError::invalid_argument(
            "Flash algorithm sectors do not exactly cover the primary region",
        ));
    }
    Ok(range)
}

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
    let size = fs::metadata(firmware)?.len();
    if size == 0 || size > MAX_FIRMWARE_BYTES {
        return Err(NativeError::invalid_argument(
            "Firmware must be between 1 byte and 512 MiB",
        ));
    }
    let bytes = fs::read(firmware)?;
    if bytes.len() as u64 != size {
        return Err(NativeError::io("Firmware file changed during planning"));
    }
    let image = firmware_image::parse(firmware, &bytes, start_address)?;

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
    let mut plans = Vec::new();
    let mut selected_region = None;
    let mut selected_algorithm = None;
    let mut erased = std::collections::BTreeSet::new();
    for segment in &image.segments {
        let start = segment.address;
        let end = start + segment.data.len() as u64;
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
            return Err(NativeError::invalid_argument(format!(
                "Firmware segment 0x{start:08X}..0x{end:08X} must fit one non-alias Flash region"
            )));
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
            return Err(NativeError::invalid_argument(format!(
                "Firmware segment at 0x{start:08X} needs exactly one Flash algorithm"
            )));
        }
        let algorithm = algorithms[0];
        let region_name = regions[0]
            .name
            .clone()
            .unwrap_or_else(|| "unnamed Flash".to_owned());
        if selected_region
            .as_ref()
            .is_some_and(|name| name != &region_name)
            || selected_algorithm
                .as_ref()
                .is_some_and(|name| name != &algorithm.name)
        {
            return Err(NativeError::invalid_argument(
                "Firmware spans multiple Flash regions or algorithms",
            ));
        }
        selected_region = Some(region_name);
        selected_algorithm = Some(algorithm.name.clone());
        let properties = &algorithm.flash_properties;
        let sectors: Vec<_> = properties
            .sectors
            .iter()
            .map(|sector| (sector.address, sector.size))
            .collect();
        let (erase_start, erase_end, _) =
            erase_footprint(properties.address_range.clone(), &sectors, start, end)?;
        let mut address = erase_start;
        while address < erase_end {
            let (_, sector_end, _) = erase_footprint(
                properties.address_range.clone(),
                &sectors,
                address,
                address + 1,
            )?;
            erased.insert(address);
            address = sector_end;
        }
        plans.push(FirmwareSegmentPlan {
            start_address: format!("0x{start:08X}"),
            end_address_exclusive: format!("0x{end:08X}"),
            byte_count: segment.data.len() as u64,
            erase_start_address: format!("0x{erase_start:08X}"),
            erase_end_address_exclusive: format!("0x{erase_end:08X}"),
        });
    }
    let start = image.segments.first().unwrap().address;
    let end =
        image.segments.last().unwrap().address + image.segments.last().unwrap().data.len() as u64;
    let erase_start = plans.first().unwrap().erase_start_address.clone();
    let erase_end = plans.last().unwrap().erase_end_address_exclusive.clone();
    Ok(BinaryFlashPlan {
        format: image.format.to_owned(),
        segments: plans,
        pack_id: pack_id.to_owned(),
        pack_sha256: pack_sha256.to_owned(),
        device: device.to_owned(),
        firmware_sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_count: image
            .segments
            .iter()
            .map(|segment| segment.data.len() as u64)
            .sum(),
        start_address: format!("0x{start:08X}"),
        end_address_exclusive: format!("0x{end:08X}"),
        memory_region: selected_region.unwrap(),
        flash_algorithm: selected_algorithm.unwrap(),
        erase_start_address: erase_start,
        erase_end_address_exclusive: erase_end,
        erase_sector_count: erased.len(),
    })
}

pub(crate) fn erase_footprint(
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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn full_erase_requires_exact_sector_coverage() {
        let complete = [
            (0, 16 * 1024),
            (64 * 1024, 64 * 1024),
            (128 * 1024, 128 * 1024),
        ];
        assert_eq!(
            erase_footprint(
                0x0800_0000..0x0810_0000,
                &complete,
                0x0800_0000,
                0x0810_0000
            )
            .unwrap(),
            (0x0800_0000, 0x0810_0000, 12),
        );
        let incomplete = [(0, 16 * 1024), (64 * 1024, 64 * 1024), (128 * 1024, 0)];
        assert!(erase_footprint(
            0x0800_0000..0x0810_0000,
            &incomplete,
            0x0800_0000,
            0x0810_0000
        )
        .is_err());
    }
}
