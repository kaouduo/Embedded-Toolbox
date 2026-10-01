use probe_rs::config::MemoryRegion;
use probe_rs::flashing::{erase, DownloadOptions, FlashProgress};
use probe_rs::probe::{
    cmsisdap::CmsisDapFactory,
    list::{Accessibility, ProbeListItem},
    stlink::StLinkFactory,
    ProbeFactory,
};
use probe_rs::{probe::WireProtocol, MemoryInterface, Permissions, Session};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use crate::domain::error::NativeError;
use crate::domain::flash_plan::BinaryProgramResult;
use crate::domain::probe::{
    ProbeConnectionResult, ProbeRecord, ProbeSelection, ProbeSessionInfo, RamReadResult,
    TargetIdentityResult,
};
use crate::services::flash_plan_service;
use crate::services::target_catalog_service;
use crate::services::target_catalog_service::remove_pack;
use crate::services::target_identity_service;

/// Upper bound for one-shot RAM diagnostics reads, to avoid stalling the UI.
const MAX_RAM_READ_BYTES: usize = 4096;

/// Attaches to the selected target over SWD and returns a live session.
///
/// Shared by the one-shot connection test and the persistent session
/// manager. The Pack registry is validated per target before any probe is
/// opened, and the caller must have ensured the device is marked ready.
fn attach_validated(
    root: &Path,
    selection: &ProbeSelection,
    pack_id: &str,
    sha256: &str,
    device: &str,
    speed_khz: u32,
) -> Result<(Session, Option<f32>), NativeError> {
    if !(100..=10_000).contains(&speed_khz) {
        return Err(NativeError::invalid_argument(
            "SWD speed must be 100-10000 kHz",
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
    Ok((session, voltage))
}

fn describe_cores(session: &Session) -> Vec<String> {
    session
        .list_cores()
        .into_iter()
        .map(|(_, core)| format!("{core:?}"))
        .collect()
}

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
    let (session, voltage) = attach_validated(root, selection, pack_id, sha256, device, speed_khz)?;
    Ok(ProbeConnectionResult {
        probe_kind: selection.kind.clone(),
        target_name: session.target().name.clone(),
        core_types: describe_cores(&session),
        voltage,
        identity_verified: false,
    })
}

/// A live debug session plus the metadata reported to the frontend.
struct SessionHandle {
    session: Session,
    pack_id: String,
    pack_sha256: String,
    probe_kind: String,
    probe_serial: Option<String>,
    speed_khz: u32,
    voltage: Option<f32>,
    core_halted: bool,
}

impl SessionHandle {
    fn info(&self, session_id: &str) -> ProbeSessionInfo {
        ProbeSessionInfo {
            session_id: session_id.to_owned(),
            probe_kind: self.probe_kind.clone(),
            probe_serial: self.probe_serial.clone(),
            target_name: self.session.target().name.clone(),
            core_types: describe_cores(&self.session),
            speed_khz: self.speed_khz,
            voltage: self.voltage,
            identity_verified: false,
            core_halted: self.core_halted,
        }
    }
}

/// Owns all persistent probe sessions. Managed by Tauri (`app.manage`).
///
/// Sessions are blocking handles, so every method that touches one must run
/// on `spawn_blocking`. The registry lock remains held during an operation,
/// so status and disconnect wait instead of observing a temporarily missing session.
pub struct ProbeSessionManager {
    sessions: Mutex<std::collections::HashMap<String, SessionHandle>>,
    next_id: AtomicU64,
}

impl ProbeSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(std::collections::HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    fn lock_sessions(
        &self,
    ) -> Result<
        std::sync::MutexGuard<'_, std::collections::HashMap<String, SessionHandle>>,
        NativeError,
    > {
        self.sessions
            .lock()
            .map_err(|_| NativeError::internal("probe session registry is poisoned"))
    }

    /// Attaches and keeps the session open, returning its snapshot.
    ///
    /// Attaching may fail after the probe was opened; in that case no entry
    /// is inserted and the probe is dropped, releasing the USB device.
    pub fn attach(
        &self,
        root: &Path,
        selection: &ProbeSelection,
        pack_id: &str,
        sha256: &str,
        device: &str,
        speed_khz: u32,
    ) -> Result<ProbeSessionInfo, NativeError> {
        let mut sessions = self.lock_sessions()?;
        let (session, voltage) =
            attach_validated(root, selection, pack_id, sha256, device, speed_khz)?;
        let session_id = format!("probe-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let handle = SessionHandle {
            session,
            pack_id: pack_id.to_owned(),
            pack_sha256: sha256.to_owned(),
            probe_kind: selection.kind.clone(),
            probe_serial: selection.serial_number.clone(),
            speed_khz,
            voltage,
            core_halted: false,
        };
        let info = handle.info(&session_id);
        sessions.insert(session_id, handle);
        Ok(info)
    }

    /// Serializes deletion with attach and all live session operations.
    pub fn remove_imported_pack(
        &self,
        root: &Path,
        pack_id: &str,
        sha256: &str,
    ) -> Result<(), NativeError> {
        let sessions = self.lock_sessions()?;
        if sessions.values().any(|handle| {
            handle.pack_id == pack_id && handle.pack_sha256.eq_ignore_ascii_case(sha256)
        }) {
            return Err(NativeError::conflict(
                "Disconnect the probe session using this Pack before removing it",
            ));
        }
        remove_pack(root, pack_id, sha256)
    }

    /// Returns the current snapshot without disturbing the target.
    pub fn status(&self, session_id: &str) -> Result<ProbeSessionInfo, NativeError> {
        let sessions = self.lock_sessions()?;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| NativeError::not_found("Probe session is not open"))?;
        Ok(handle.info(session_id))
    }

    /// Read-only physical compatibility check supplied by a target provider.
    pub fn inspect_target(&self, session_id: &str) -> Result<TargetIdentityResult, NativeError> {
        let mut sessions = self.lock_sessions()?;
        let handle = sessions
            .get_mut(session_id)
            .ok_or_else(|| NativeError::not_found("Probe session is not open"))?;
        Ok(target_identity_service::inspect(&mut handle.session)?.report)
    }

    /// Sector erase, program and read-back verification using Pack metadata
    /// and an independent provider for physical target compatibility.
    pub fn program_binary(
        &self,
        root: &Path,
        session_id: &str,
        firmware: &Path,
        start_address: &str,
        expected_sha256: &str,
    ) -> Result<BinaryProgramResult, NativeError> {
        let mut sessions = self.lock_sessions()?;
        let handle = sessions
            .get_mut(session_id)
            .ok_or_else(|| NativeError::not_found("Probe session is not open"))?;
        let device = handle.session.target().name.clone();
        let plan = flash_plan_service::plan_binary(
            root,
            &handle.pack_id,
            &handle.pack_sha256,
            &device,
            firmware,
            start_address,
        )?;
        if plan.firmware_sha256 != expected_sha256 {
            return Err(NativeError::conflict("Firmware changed since plan preview"));
        }
        let erase_start = u64::from_str_radix(&plan.erase_start_address[2..], 16)
            .map_err(|_| NativeError::internal("Invalid planned erase boundary"))?;
        let erase_end = u64::from_str_radix(&plan.erase_end_address_exclusive[2..], 16)
            .map_err(|_| NativeError::internal("Invalid planned erase boundary"))?;
        let identity = target_identity_service::inspect(&mut handle.session)?;
        if !identity.report.program_compatible {
            return Err(NativeError::conflict(format!(
                "Physical target is not compatible: device ID {}, Flash {} KiB",
                identity.report.device_id, identity.report.flash_kib,
            )));
        }
        let program_end = u64::from_str_radix(
            &identity.report.program_flash_end_address_exclusive[2..],
            16,
        )
        .map_err(|_| NativeError::internal("Invalid validated program range"))?;
        if erase_start < identity.flash_range.start || erase_end > program_end {
            return Err(NativeError::invalid_argument(
                "Plan exceeds the validated programming range",
            ));
        }
        let bytes = fs::read(firmware)?;
        if format!("{:x}", Sha256::digest(&bytes)) != plan.firmware_sha256 {
            return Err(NativeError::conflict(
                "Firmware changed during programming preparation",
            ));
        }
        let image = crate::services::firmware_image::parse(firmware, &bytes, start_address)?;
        if image.format != plan.format || image.segments.len() != plan.segments.len() {
            return Err(NativeError::conflict(
                "Firmware layout changed since plan preview",
            ));
        }
        let mut loader = handle.session.target().flash_loader();
        for (segment, preview) in image.segments.iter().zip(&plan.segments) {
            let end = segment.address + segment.data.len() as u64;
            if format!("0x{:08X}", segment.address) != preview.start_address
                || format!("0x{end:08X}") != preview.end_address_exclusive
                || segment.address < identity.flash_range.start
                || end > program_end
            {
                return Err(NativeError::conflict(
                    "Firmware segment exceeds the validated Flash plan",
                ));
            }
            loader
                .add_data(segment.address, &segment.data)
                .map_err(|error| NativeError::io(format!("Prepare Flash data failed: {error}")))?;
        }
        let mut options = DownloadOptions::default();
        options.verify = true;
        options.keep_unwritten_bytes = true;
        options.do_chip_erase = false;
        options.preferred_algos = vec![plan.flash_algorithm.clone()];
        let result = loader.commit(&mut handle.session, options);
        handle.core_halted = true;
        result.map_err(|error| {
            NativeError::io(format!(
                "Programming or verification failed; Flash may be partially changed: {error}"
            ))
        })?;
        Ok(BinaryProgramResult {
            firmware_sha256: plan.firmware_sha256,
            byte_count: plan.byte_count,
            verified: true,
        })
    }

    /// Erases the physically checked internal Flash range, including sectors
    /// outside the current firmware. Option bytes and other NVM are excluded.
    pub fn erase_internal_flash(
        &self,
        root: &Path,
        session_id: &str,
        confirmed: bool,
    ) -> Result<(), NativeError> {
        if !confirmed {
            return Err(NativeError::invalid_argument(
                "Confirm full internal Flash erase",
            ));
        }
        let mut sessions = self.lock_sessions()?;
        let handle = sessions
            .get_mut(session_id)
            .ok_or_else(|| NativeError::not_found("Probe session is not open"))?;
        let device = handle.session.target().name.clone();
        let (_, analysis) = target_catalog_service::load_validated_registry(
            root,
            &handle.pack_id,
            &handle.pack_sha256,
        )?;
        if !analysis
            .targets
            .iter()
            .any(|target| target.name == device && target.ready)
        {
            return Err(NativeError::invalid_argument(
                "Device target definition is not validated",
            ));
        }
        let identity = target_identity_service::inspect(&mut handle.session)?;
        if !identity.report.flash_compatible {
            return Err(NativeError::conflict(format!(
                "Physical target is not compatible: device ID {}, Flash {} KiB",
                identity.report.device_id, identity.report.flash_kib,
            )));
        }
        let range = identity.flash_range;
        let target = handle.session.target();
        let nvm_regions = target
            .memory_map
            .iter()
            .filter(|region| {
                matches!(region, MemoryRegion::Nvm(nvm)
                if !nvm.is_alias && nvm.range.start <= range.start && range.end <= nvm.range.end)
            })
            .count();
        let overlapping_regions = target
            .memory_map
            .iter()
            .filter(|region| {
                matches!(region, MemoryRegion::Nvm(nvm)
                    if nvm.range.start < range.end && range.start < nvm.range.end)
            })
            .count();
        let algorithms: Vec<_> = target
            .flash_algorithms
            .iter()
            .filter(|algorithm| {
                algorithm.flash_properties.address_range.start <= range.start
                    && range.end <= algorithm.flash_properties.address_range.end
            })
            .collect();
        if nvm_regions != 1 || overlapping_regions != 1 || algorithms.len() != 1 {
            return Err(NativeError::invalid_argument(
                "Full internal Flash range requires one NVM region and one Flash algorithm",
            ));
        }
        let properties = &algorithms[0].flash_properties;
        let sectors: Vec<_> = properties
            .sectors
            .iter()
            .map(|sector| (sector.address, sector.size))
            .collect();
        let (erase_start, erase_end, sector_count) = flash_plan_service::erase_footprint(
            properties.address_range.clone(),
            &sectors,
            range.start,
            range.end,
        )?;
        if erase_start != range.start
            || erase_end != range.end
            || sector_count != identity.erase_sectors.len()
        {
            return Err(NativeError::invalid_argument(
                "Flash algorithm sectors do not cover the exact internal Flash range",
            ));
        }
        for expected in &identity.erase_sectors {
            let (start, end, count) = flash_plan_service::erase_footprint(
                properties.address_range.clone(),
                &sectors,
                expected.start,
                expected.end,
            )?;
            if start != expected.start || end != expected.end || count != 1 {
                return Err(NativeError::invalid_argument(
                    "Flash algorithm sector geometry differs from the physical target",
                ));
            }
        }
        let result = erase(
            &mut handle.session,
            &mut FlashProgress::empty(),
            range.start,
            range.end,
            false,
        );
        handle.core_halted = true;
        result.map_err(|error| {
            NativeError::io(format!(
                "Full internal Flash erase failed; contents may be partially erased: {error}"
            ))
        })?;
        let mut core = handle.session.core(0).map_err(|error| {
            NativeError::io(format!("Open core for erase verification failed: {error}"))
        })?;
        let mut buffer = [0u8; 4096];
        for address in (range.start..range.end).step_by(buffer.len()) {
            let length = ((range.end - address) as usize).min(buffer.len());
            core.read(address, &mut buffer[..length]).map_err(|error| {
                NativeError::io(format!(
                    "Read after full erase failed at {address:#010X}: {error}"
                ))
            })?;
            if buffer[..length].iter().any(|byte| *byte != 0xFF) {
                return Err(NativeError::conflict(format!(
                    "Full erase verification found nonblank Flash at {address:#010X}"
                )));
            }
        }
        Ok(())
    }

    /// Halts the primary core (index 0) and marks the session halted.
    pub fn halt(&self, session_id: &str) -> Result<ProbeSessionInfo, NativeError> {
        let mut sessions = self.lock_sessions()?;
        let handle = sessions
            .get_mut(session_id)
            .ok_or_else(|| NativeError::not_found("Probe session is not open"))?;
        handle
            .session
            .core(0)
            .and_then(|mut core| core.halt(Duration::from_millis(500)))
            .map_err(|error| NativeError::io(format!("Halt failed: {error}")))?;
        handle.core_halted = true;
        Ok(handle.info(session_id))
    }

    /// Resumes the primary core and marks the session running.
    pub fn resume(&self, session_id: &str) -> Result<ProbeSessionInfo, NativeError> {
        let mut sessions = self.lock_sessions()?;
        let handle = sessions
            .get_mut(session_id)
            .ok_or_else(|| NativeError::not_found("Probe session is not open"))?;
        handle
            .session
            .core(0)
            .and_then(|mut core| core.run())
            .map_err(|error| NativeError::io(format!("Resume failed: {error}")))?;
        handle.core_halted = false;
        Ok(handle.info(session_id))
    }

    /// Reads target RAM for bring-up diagnostics. The core is halted first;
    /// it stays halted afterwards so the operator decides when to resume.
    pub fn read_ram(
        &self,
        session_id: &str,
        address: u64,
        length: usize,
    ) -> Result<RamReadResult, NativeError> {
        if length == 0 || length > MAX_RAM_READ_BYTES {
            return Err(NativeError::invalid_argument(format!(
                "Read length must be 1-{MAX_RAM_READ_BYTES} bytes"
            )));
        }
        let mut sessions = self.lock_sessions()?;
        let handle = sessions
            .get_mut(session_id)
            .ok_or_else(|| NativeError::not_found("Probe session is not open"))?;
        let end = address
            .checked_add(length as u64)
            .ok_or_else(|| NativeError::invalid_argument("RAM read range overflows"))?;
        let in_ram = handle.session.target().memory_map.iter().any(|region| {
            matches!(region, MemoryRegion::Ram(ram)
                if ram.range.start <= address && end <= ram.range.end)
        });
        if !in_ram {
            return Err(NativeError::invalid_argument(
                "Read range must fit one target RAM region",
            ));
        }
        let data = {
            let mut core = handle
                .session
                .core(0)
                .map_err(|error| NativeError::io(format!("Open core failed: {error}")))?;
            core.halt(Duration::from_millis(500))
                .map_err(|error| NativeError::io(format!("Halt failed: {error}")))?;
            handle.core_halted = true;
            let mut data = vec![0u8; length];
            core.read(address, &mut data)
                .map_err(|error| NativeError::io(format!("Read RAM failed: {error}")))?;
            data
        };
        Ok(RamReadResult {
            address: format!("0x{address:08X}"),
            bytes_read: data.len(),
            data,
            core_halted: handle.core_halted,
        })
    }

    /// Detaches and releases the probe. Missing sessions are reported.
    pub fn disconnect(&self, session_id: &str) -> Result<(), NativeError> {
        self.lock_sessions()?
            .remove(session_id)
            .map(|_| ())
            .ok_or_else(|| NativeError::not_found("Probe session is not open"))
    }
}
