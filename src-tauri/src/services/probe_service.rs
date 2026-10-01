use probe_rs::probe::{
    cmsisdap::CmsisDapFactory,
    list::{Accessibility, ProbeListItem},
    stlink::StLinkFactory,
    ProbeFactory,
};
use probe_rs::{probe::WireProtocol, Permissions};
use std::path::Path;

use crate::domain::error::NativeError;
use crate::domain::probe::{ProbeConnectionResult, ProbeRecord, ProbeSelection};
use crate::services::target_catalog_service;

pub fn list_supported_probes() -> Vec<ProbeRecord> {
    // Call only these factories; the generic lister also probes J-Link devices.
    let mut probes = Vec::new();
    probes.extend(convert("ST-Link", StLinkFactory.list_probes()));
    probes.extend(convert("CMSIS-DAP", CmsisDapFactory.list_probes()));
    probes
}

fn convert(kind: &str, items: Vec<ProbeListItem>) -> Vec<ProbeRecord> {
    items
        .into_iter()
        .map(|item| ProbeRecord {
            kind: kind.to_owned(),
            name: item.info.identifier,
            vendor_id: item.info.vendor_id,
            product_id: item.info.product_id,
            serial_number: item.info.serial_number,
            interface: item.info.interface,
            accessible: item.accessibility == Accessibility::Accessible,
        })
        .collect()
}

pub fn test_target_connection(
    root: &Path,
    selection: &ProbeSelection,
    pack_id: &str,
    sha256: &str,
    device: &str,
    speed_khz: u32,
) -> Result<ProbeConnectionResult, NativeError> {
    if !(100..=10_000).contains(&speed_khz) {
        return Err(NativeError::invalid_argument(
            "SWD speed must be 100–10000 kHz",
        ));
    }
    let (registry, analysis) =
        target_catalog_service::load_validated_registry(root, pack_id, sha256)?;
    if !analysis
        .targets
        .iter()
        .any(|target| target.name == device && target.ready)
    {
        return Err(NativeError::invalid_argument(
            "Device target definition is not validated",
        ));
    }
    let listed = match selection.kind.as_str() {
        "ST-Link" => StLinkFactory.list_probes(),
        "CMSIS-DAP" => CmsisDapFactory.list_probes(),
        _ => return Err(NativeError::invalid_argument("Unsupported probe type")),
    };
    let mut matches = listed.into_iter().filter(|item| {
        item.info.vendor_id == selection.vendor_id
            && item.info.product_id == selection.product_id
            && item.info.serial_number == selection.serial_number
            && item.info.interface == selection.interface
    });
    let item = matches
        .next()
        .ok_or_else(|| NativeError::not_found("Selected probe is not connected"))?;
    if matches.next().is_some() {
        return Err(NativeError::conflict(
            "Multiple probes match; select one with a serial number",
        ));
    }
    if item.accessibility != Accessibility::Accessible {
        return Err(NativeError::io("Selected probe is not accessible"));
    }
    let mut probe = item
        .info
        .open()
        .map_err(|error| NativeError::io(format!("Open probe failed: {error}")))?;
    probe
        .select_protocol(WireProtocol::Swd)
        .map_err(|error| NativeError::io(format!("Select SWD failed: {error}")))?;
    probe
        .set_speed(speed_khz)
        .map_err(|error| NativeError::io(format!("Set SWD speed failed: {error}")))?;
    let voltage = probe.get_target_voltage().ok().flatten();
    let session = probe
        .attach_with_registry(device, Permissions::default(), &registry)
        .map_err(|error| NativeError::io(format!("Attach failed: {error}")))?;
    let core_types = session
        .list_cores()
        .into_iter()
        .map(|(_, core)| format!("{core:?}"))
        .collect();
    Ok(ProbeConnectionResult {
        probe_kind: selection.kind.clone(),
        target_name: session.target().name.clone(),
        core_types,
        voltage,
        identity_verified: false,
    })
}
