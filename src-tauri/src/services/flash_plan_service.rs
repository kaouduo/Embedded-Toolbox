use std::fs;
use std::path::Path;

use probe_rs::config::{ChipFamily, MemoryRegion, Registry};
use sha2::{Digest, Sha256};

use crate::domain::error::NativeError;
use crate::domain::flash_plan::BinaryFlashPlan;
use crate::domain::target_catalog::PackAnalysis;

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

    let safe_id: String = pack_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let dir = root.join(format!("{}-{}", safe_id, &pack_sha256[..12]));
    let conversion = dir.join("conversion-target-gen-0.32.0");
    let analysis: PackAnalysis =
        serde_json::from_slice(&fs::read(conversion.join("analysis.json"))?)
            .map_err(|error| NativeError::io(format!("Invalid target analysis: {error}")))?;
    if analysis.pack_id != pack_id || analysis.sha256 != pack_sha256 {
        return Err(NativeError::invalid_argument(
            "Pack analysis identity mismatch",
        ));
    }
    if !analysis
        .targets
        .iter()
        .any(|target| target.name == device && target.ready)
    {
        return Err(NativeError::invalid_argument(
            "Device target definition is not validated",
        ));
    }
    let converted = fs::read(conversion.join("target-families.bin"))?;
    if format!("{:x}", Sha256::digest(&converted)) != analysis.target_definition_sha256 {
        return Err(NativeError::invalid_argument(
            "Converted target hash does not match analysis",
        ));
    }
    let (families, _): (Vec<ChipFamily>, usize) =
        bincode::serde::decode_from_slice(&converted, bincode::config::standard())
            .map_err(|error| NativeError::io(format!("Invalid converted targets: {error}")))?;
    let mut registry = Registry::new();
    for family in families {
        registry.add_target_family(family).map_err(|error| {
            NativeError::invalid_argument(format!("Converted target invalid: {error}"))
        })?;
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
    })
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
}
