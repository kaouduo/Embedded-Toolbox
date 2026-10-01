use std::path::Path;

use goblin::elf::{header::EM_ARM, program_header::PT_LOAD, Elf};
use ihex::{Reader, Record};

use crate::domain::error::NativeError;

#[derive(Debug, Clone)]
pub struct Segment {
    pub address: u64,
    pub data: Vec<u8>,
}

pub struct FirmwareImage {
    pub format: &'static str,
    pub segments: Vec<Segment>,
}

pub fn parse(path: &Path, bytes: &[u8], bin_address: &str) -> Result<FirmwareImage, NativeError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (format, segments) = match extension.as_str() {
        "bin" => (
            "BIN",
            vec![Segment {
                address: parse_address(bin_address)?,
                data: bytes.to_vec(),
            }],
        ),
        "elf" => ("ELF", parse_elf(bytes)?),
        "hex" => ("HEX", parse_hex(bytes)?),
        _ => {
            return Err(NativeError::invalid_argument(
                "Choose a .bin, .elf or .hex firmware file",
            ))
        }
    };
    normalize(format, segments)
}

fn parse_address(input: &str) -> Result<u64, NativeError> {
    let value = input.trim();
    if value.is_empty() {
        return Err(NativeError::invalid_argument(
            "BIN start address is required",
        ));
    }
    if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16)
    } else {
        value.parse::<u64>()
    }
    .map_err(|_| NativeError::invalid_argument("Invalid BIN start address"))
}

fn parse_elf(bytes: &[u8]) -> Result<Vec<Segment>, NativeError> {
    let elf = Elf::parse(bytes)
        .map_err(|error| NativeError::invalid_argument(format!("Invalid ELF: {error}")))?;
    if elf.header.e_machine != EM_ARM || elf.is_64 || !elf.little_endian {
        return Err(NativeError::invalid_argument("Only 32-bit little-endian ARM ELF is supported"));
    }
    let mut segments = Vec::new();
    for header in elf
        .program_headers
        .iter()
        .filter(|header| header.p_type == PT_LOAD && header.p_filesz > 0)
    {
        let start = usize::try_from(header.p_offset)
            .map_err(|_| NativeError::invalid_argument("ELF file offset overflows"))?;
        let size = usize::try_from(header.p_filesz)
            .map_err(|_| NativeError::invalid_argument("ELF segment size overflows"))?;
        let end = start
            .checked_add(size)
            .ok_or_else(|| NativeError::invalid_argument("ELF segment offset overflows"))?;
        let data = bytes
            .get(start..end)
            .ok_or_else(|| NativeError::invalid_argument("ELF segment exceeds file"))?;
        // p_paddr is the load address (LMA); p_vaddr may point to RAM for initialized data.
        let address = if header.p_paddr != 0 {
            header.p_paddr
        } else {
            header.p_vaddr
        };
        segments.push(Segment {
            address,
            data: data.to_vec(),
        });
    }
    Ok(segments)
}

fn parse_hex(bytes: &[u8]) -> Result<Vec<Segment>, NativeError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| NativeError::invalid_argument("HEX is not UTF-8 text"))?;
    let mut base = 0u64;
    let mut ended = false;
    let mut segments = Vec::new();
    for (line, record) in Reader::new(text).enumerate() {
        if ended {
            return Err(NativeError::invalid_argument(
                "HEX has records after end-of-file",
            ));
        }
        let record = record.map_err(|error| {
            NativeError::invalid_argument(format!("HEX line {}: {error}", line + 1))
        })?;
        match record {
            Record::Data { offset, value } if !value.is_empty() => segments.push(Segment {
                address: base + u64::from(offset),
                data: value,
            }),
            Record::ExtendedLinearAddress(value) => base = u64::from(value) << 16,
            Record::ExtendedSegmentAddress(value) => base = u64::from(value) << 4,
            Record::EndOfFile => ended = true,
            _ => {}
        }
    }
    if !ended {
        return Err(NativeError::invalid_argument(
            "HEX is missing end-of-file record",
        ));
    }
    Ok(segments)
}

fn normalize(
    format: &'static str,
    mut segments: Vec<Segment>,
) -> Result<FirmwareImage, NativeError> {
    segments.retain(|segment| !segment.data.is_empty());
    segments.sort_by_key(|segment| segment.address);
    let mut merged: Vec<Segment> = Vec::new();
    for segment in segments {
        let end = segment
            .address
            .checked_add(segment.data.len() as u64)
            .ok_or_else(|| NativeError::invalid_argument("Firmware address range overflows"))?;
        if end > u64::from(u32::MAX) + 1 {
            return Err(NativeError::invalid_argument(
                "Firmware address exceeds 32-bit address space",
            ));
        }
        if let Some(previous) = merged.last_mut() {
            let previous_end = previous.address + previous.data.len() as u64;
            if segment.address < previous_end {
                return Err(NativeError::invalid_argument("Firmware segments overlap"));
            }
            if segment.address == previous_end {
                previous.data.extend_from_slice(&segment.data);
                continue;
            }
        }
        merged.push(segment);
    }
    if merged.is_empty() {
        return Err(NativeError::invalid_argument(
            "Firmware contains no loadable data",
        ));
    }
    Ok(FirmwareImage {
        format,
        segments: merged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_preserves_gaps_and_extended_addresses() {
        let hex = b":020000040800F2\n:0400100001020304E2\n:020000040801F1\n:02002000AABB79\n:00000001FF\n";
        let image = parse(Path::new("test.hex"), hex, "").unwrap();
        assert_eq!(image.segments.len(), 2);
        assert_eq!(image.segments[0].address, 0x0800_0010);
        assert_eq!(image.segments[1].address, 0x0801_0020);
    }

    #[test]
    fn hex_rejects_bad_checksum_and_missing_eof() {
        assert!(parse(Path::new("test.hex"), b":0100000001FF\n:00000001FF\n", "").is_err());
        assert!(parse(Path::new("test.hex"), b":0100000001FE\n", "").is_err());
    }

    #[test]
    fn rejects_overlapping_segments() {
        assert!(normalize(
            "HEX",
            vec![
                Segment {
                    address: 1,
                    data: vec![1, 2]
                },
                Segment {
                    address: 2,
                    data: vec![3]
                }
            ]
        )
        .is_err());
    }

    #[test]
    fn bin_requires_address() {
        assert!(parse(Path::new("test.bin"), &[1], "").is_err());
        assert_eq!(
            parse(Path::new("test.bin"), &[1], "0x08000000")
                .unwrap()
                .segments[0]
                .address,
            0x0800_0000
        );
    }

    #[test]
    fn validates_optional_local_elf_and_hex_samples() {
        if let Ok(root) = std::env::var("FIRMWARE_SAMPLE_DIR") {
            for name in ["zephyr.elf", "zephyr.hex"] {
                let path = Path::new(&root).join(name);
                let bytes = std::fs::read(&path).unwrap();
                let image = parse(&path, &bytes, "").unwrap();
                assert_eq!(image.segments[0].address, 0x0800_0000);
                assert!(image
                    .segments
                    .iter()
                    .all(|segment| segment.address >= 0x0800_0000));
            }
        }
    }
}
