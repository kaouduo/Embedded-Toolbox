use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryFlashPlan {
    pub pack_id: String,
    pub pack_sha256: String,
    pub device: String,
    pub firmware_sha256: String,
    pub byte_count: u64,
    pub start_address: String,
    pub end_address_exclusive: String,
    pub memory_region: String,
    pub flash_algorithm: String,
}
