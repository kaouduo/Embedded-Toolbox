use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRecord {
    pub kind: String,
    pub name: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub serial_number: Option<String>,
    pub interface: Option<u8>,
    pub accessible: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSelection {
    pub kind: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub serial_number: Option<String>,
    pub interface: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeConnectionResult {
    pub probe_kind: String,
    pub target_name: String,
    pub core_types: Vec<String>,
    pub voltage: Option<f32>,
}

/// Snapshot of a persistent probe session. The session owns the probe
/// exclusively until it is explicitly disconnected.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSessionInfo {
    pub session_id: String,
    pub probe_kind: String,
    pub probe_serial: Option<String>,
    pub target_name: String,
    pub core_types: Vec<String>,
    pub speed_khz: u32,
    pub voltage: Option<f32>,
    pub core_halted: bool,
}

/// One-shot target RAM read used for bring-up diagnostics. Reading halts
/// the core briefly; the previous run state is not restored automatically.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RamReadResult {
    pub address: String,
    pub bytes_read: usize,
    pub data: Vec<u8>,
    pub core_halted: bool,
}
