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
    pub identity_verified: bool,
}
