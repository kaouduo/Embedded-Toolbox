use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use roxmltree::{Document, Node};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::domain::error::NativeError;
use crate::domain::target_catalog::{
    AlgorithmRecord, DeviceRecord, MemoryRegionRecord, PackRecord, TargetCapability,
};

const MAX_PACK_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PDSC_BYTES: u64 = 16 * 1024 * 1024;

pub fn list_packs(root: &Path) -> Result<Vec<PackRecord>, NativeError> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut packs = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let manifest = entry.path().join("manifest.json");
        if manifest.exists() {
            let record = serde_json::from_slice(&fs::read(&manifest)?)
                .map_err(|error| NativeError::io(format!("{}: {error}", manifest.display())))?;
            packs.push(record);
        }
    }
    packs.sort_by(|a: &PackRecord, b: &PackRecord| a.id.cmp(&b.id));
    Ok(packs)
}

pub fn import_pack(root: &Path, source: &Path) -> Result<PackRecord, NativeError> {
    let metadata = fs::metadata(source)?;
    if metadata.len() > MAX_PACK_BYTES {
        return Err(NativeError::invalid_argument("Pack exceeds 512 MiB"));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(source)?
        .take(MAX_PACK_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PACK_BYTES {
        return Err(NativeError::invalid_argument("Pack exceeds 512 MiB"));
    }
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let mut archive = ZipArchive::new(std::io::Cursor::new(&bytes))
        .map_err(|error| NativeError::invalid_argument(format!("Invalid Pack ZIP: {error}")))?;
    let pdsc_indices: Vec<_> = (0..archive.len())
        .filter(|index| {
            archive.by_index(*index).is_ok_and(|entry| {
                entry.name().to_ascii_lowercase().ends_with(".pdsc") && !entry.is_dir()
            })
        })
        .collect();
    if pdsc_indices.len() != 1 {
        return Err(NativeError::invalid_argument(
            "Pack must contain exactly one PDSC",
        ));
    }
    let mut pdsc = String::new();
    {
        let entry = archive
            .by_index(pdsc_indices[0])
            .map_err(|error| NativeError::invalid_argument(error.to_string()))?;
        if entry.size() > MAX_PDSC_BYTES {
            return Err(NativeError::invalid_argument("PDSC exceeds 16 MiB"));
        }
        entry
            .take(MAX_PDSC_BYTES + 1)
            .read_to_string(&mut pdsc)
            .map_err(|error| {
                NativeError::invalid_argument(format!("Invalid PDSC text: {error}"))
            })?;
    }
    if pdsc.len() as u64 > MAX_PDSC_BYTES {
        return Err(NativeError::invalid_argument("PDSC exceeds 16 MiB"));
    }
    let files: BTreeSet<String> = archive
        .file_names()
        .map(|name| normalize_path(name))
        .collect();
    let mut record = parse_pdsc(&pdsc, &files, sha256)?;
    let imported_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| NativeError::internal(error.to_string()))?;
    record.imported_at = imported_at.as_secs().to_string();
    let dir_name = format!("{}-{}", safe_component(&record.id), &record.sha256[..12]);
    fs::create_dir_all(root)?;
    let destination = root.join(dir_name);
    if destination.exists() {
        let existing: PackRecord =
            serde_json::from_slice(&fs::read(destination.join("manifest.json"))?)
                .map_err(|error| NativeError::io(error.to_string()))?;
        return Ok(existing);
    }
    for prior in list_packs(root)? {
        if prior.id == record.id && prior.sha256 != record.sha256 {
            return Err(NativeError::conflict(format!(
                "Pack {} already exists with a different hash",
                record.id
            )));
        }
    }
    let staging = root.join(format!(
        ".{}.tmp-{}-{}",
        safe_component(&record.id),
        std::process::id(),
        imported_at.as_nanos()
    ));
    fs::create_dir(&staging)?;
    let result = (|| -> Result<(), NativeError> {
        let mut pack_file = File::create(staging.join("source.pack"))?;
        pack_file.write_all(&bytes)?;
        pack_file.sync_all()?;
        drop(pack_file);
        let manifest = serde_json::to_vec_pretty(&record)
            .map_err(|error| NativeError::internal(error.to_string()))?;
        let mut manifest_file = File::create(staging.join("manifest.json"))?;
        manifest_file.write_all(&manifest)?;
        manifest_file.sync_all()?;
        drop(manifest_file);
        fs::rename(&staging, &destination)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;
    Ok(record)
}

fn parse_pdsc(
    xml: &str,
    files: &BTreeSet<String>,
    sha256: String,
) -> Result<PackRecord, NativeError> {
    let doc = Document::parse(xml)
        .map_err(|error| NativeError::invalid_argument(format!("Invalid PDSC XML: {error}")))?;
    let package = doc.root_element();
    if package.tag_name().name() != "package" {
        return Err(NativeError::invalid_argument("PDSC root must be package"));
    }
    let text = |name: &str| -> Result<String, NativeError> {
        package
            .children()
            .find(|node| node.has_tag_name(name))
            .and_then(|node| node.text())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| NativeError::invalid_argument(format!("PDSC missing {name}")))
    };
    let vendor = text("vendor")?;
    let name = text("name")?;
    let version = package
        .descendants()
        .filter(|node| node.has_tag_name("release"))
        .filter_map(|node| node.attribute("version"))
        .next()
        .ok_or_else(|| NativeError::invalid_argument("PDSC missing release version"))?
        .to_owned();
    let mut devices = Vec::new();
    if let Some(devices_node) = package.children().find(|node| node.has_tag_name("devices")) {
        for family in devices_node
            .children()
            .filter(|node| node.has_tag_name("family"))
        {
            walk_devices(
                family,
                family.attribute("Dfamily").unwrap_or(""),
                &[],
                &[],
                None,
                files,
                &mut devices,
            );
        }
    }
    if devices.is_empty() {
        return Err(NativeError::invalid_argument("PDSC contains no devices"));
    }
    devices.sort_by(|a, b| a.name.cmp(&b.name));
    devices.dedup_by(|a, b| a.name == b.name);
    Ok(PackRecord {
        id: format!("{vendor}.{name}.{version}"),
        vendor,
        name,
        version,
        sha256,
        imported_at: String::new(),
        devices,
    })
}

fn walk_devices(
    node: Node<'_, '_>,
    family: &str,
    inherited_algorithms: &[AlgorithmRecord],
    inherited_memory: &[MemoryRegionRecord],
    inherited_core: Option<&str>,
    files: &BTreeSet<String>,
    out: &mut Vec<DeviceRecord>,
) {
    let mut algorithms = inherited_algorithms.to_vec();
    for child in node
        .children()
        .filter(|child| child.has_tag_name("algorithm"))
    {
        if let Some(name) = child.attribute("name") {
            algorithms.push(AlgorithmRecord {
                file: normalize_path(name),
                start: child.attribute("start").map(str::to_owned),
                size: child.attribute("size").map(str::to_owned),
                ram_start: child.attribute("RAMstart").map(str::to_owned),
                ram_size: child.attribute("RAMsize").map(str::to_owned),
                default: child.attribute("default") == Some("1"),
            });
        }
    }
    let mut memory_regions = inherited_memory.to_vec();
    for child in node.children().filter(|child| child.has_tag_name("memory")) {
        if let (Some(id), Some(start), Some(size)) = (
            child.attribute("id").or_else(|| child.attribute("name")),
            child.attribute("start"),
            child.attribute("size"),
        ) {
            let region = MemoryRegionRecord {
                id: id.to_owned(),
                start: start.to_owned(),
                size: size.to_owned(),
                access: child.attribute("access").map(str::to_owned),
                default: child.attribute("default") == Some("1"),
            };
            if let Some(previous) = memory_regions.iter_mut().find(|item| item.id == region.id) {
                *previous = region;
            } else {
                memory_regions.push(region);
            }
        }
    }
    let core = node
        .children()
        .find(|child| child.has_tag_name("processor"))
        .and_then(|child| child.attribute("Dcore"))
        .or_else(|| node.attribute("Dcore"))
        .or(inherited_core);
    let family = node.attribute("Dfamily").unwrap_or(family);
    if let Some(name) = node
        .attribute("Dname")
        .or_else(|| node.attribute("Dvariant"))
    {
        let capability = if algorithms.is_empty() {
            TargetCapability::DescriptionOnly
        } else if algorithms
            .iter()
            .all(|algorithm| files.contains(&algorithm.file))
        {
            TargetCapability::AlgorithmPresent
        } else {
            TargetCapability::MissingAlgorithm
        };
        out.push(DeviceRecord {
            name: name.to_owned(),
            family: family.to_owned(),
            core: core.map(str::to_owned),
            memory_regions: memory_regions.clone(),
            algorithm_files: algorithms
                .iter()
                .map(|algorithm| algorithm.file.clone())
                .collect(),
            algorithms: algorithms.clone(),
            capability,
        });
    }
    for child in node.children().filter(|child| {
        matches!(
            child.tag_name().name(),
            "family" | "subFamily" | "device" | "variant"
        )
    }) {
        walk_devices(
            child,
            family,
            &algorithms,
            &memory_regions,
            core,
            files,
            out,
        );
    }
}

fn normalize_path(path: &str) -> String {
    let mut parts = Vec::new();
    for part in path.replace('\\', "/").split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part.to_ascii_lowercase()),
        }
    }
    parts.join("/")
}

fn safe_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn inherits_flash_algorithm_and_marks_it_unconverted() {
        let xml = r#"<package><vendor>ST</vendor><name>STM32F1</name><releases><release version="1.0" /></releases><devices><family Dfamily="STM32F1"><processor Dcore="Cortex-M3"/><memory id="IROM1" start="0x08000000" size="0x10000"/><algorithm name="Flash/F1.FLM" start="0x08000000" size="0x10000" RAMstart="0x20000000" RAMsize="0x2000"/><device Dname="STM32F103C8"/></family></devices></package>"#;
        let files = BTreeSet::from(["flash/f1.flm".to_owned()]);
        let pack = parse_pdsc(xml, &files, "hash".into()).unwrap();
        assert_eq!(
            pack.devices[0].capability,
            TargetCapability::AlgorithmPresent
        );
        assert_eq!(pack.devices[0].algorithm_files, vec!["flash/f1.flm"]);
        assert_eq!(pack.devices[0].core.as_deref(), Some("Cortex-M3"));
        assert_eq!(pack.devices[0].memory_regions[0].start, "0x08000000");
        assert_eq!(
            pack.devices[0].algorithms[0].ram_start.as_deref(),
            Some("0x20000000")
        );
    }

    #[test]
    fn missing_algorithm_is_diagnostic_not_flashable() {
        let xml = r#"<package><vendor>ST</vendor><name>STM32G4</name><releases><release version="1.0" /></releases><devices><family Dfamily="STM32G4"><device Dname="STM32G431"><algorithm name="missing.flm"/></device></family></devices></package>"#;
        let pack = parse_pdsc(xml, &BTreeSet::new(), "hash".into()).unwrap();
        assert_eq!(
            pack.devices[0].capability,
            TargetCapability::MissingAlgorithm
        );
    }

    #[test]
    fn imports_and_lists_pack_without_changing_hash_or_timestamp() {
        let temp = std::env::temp_dir().join(format!(
            "target-catalog-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&temp).unwrap();
        let source = temp.join("test.pack");
        let file = File::create(&source).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("Test.pdsc", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(br#"<package><vendor>Test</vendor><name>MCU</name><releases><release version="1.0" /></releases><devices><family Dfamily="Test"><device Dname="Test1"><algorithm name="Flash/Test.FLM"/></device></family></devices></package>"#).unwrap();
        zip.start_file("Flash/Test.FLM", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"dummy").unwrap();
        zip.finish().unwrap();

        let root = temp.join("catalog");
        let first = import_pack(&root, &source).unwrap();
        let again = import_pack(&root, &source).unwrap();
        assert_eq!(first, again);
        assert_eq!(list_packs(&root).unwrap(), vec![first]);
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn imports_external_pack_when_supplied() {
        let Ok(path) = std::env::var("CMSIS_PACK_TEST_PATH") else {
            return;
        };
        let temp =
            std::env::temp_dir().join(format!("target-catalog-external-{}", std::process::id()));
        let pack = import_pack(&temp, Path::new(&path)).unwrap();
        assert!(!pack.devices.is_empty());
        if let Ok(expected) = std::env::var("CMSIS_PACK_EXPECTED_DEVICES") {
            assert_eq!(pack.devices.len(), expected.parse::<usize>().unwrap());
        }
        fs::remove_dir_all(temp).unwrap();
    }
}
