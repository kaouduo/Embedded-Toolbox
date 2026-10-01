use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryFlashPlan {
    pub format: String,
    pub segments: Vec<FirmwareSegmentPlan>,
    pub pack_id: String,
    pub pack_sha256: String,
    pub device: String,
    pub firmware_sha256: String,
    pub byte_count: u64,
    pub start_address: String,
    pub end_address_exclusive: String,
    pub memory_region: String,
    pub flash_algorithm: String,
    pub erase_start_address: String,
    pub erase_end_address_exclusive: String,
    pub erase_sector_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareSegmentPlan {
    pub start_address: String,
    pub end_address_exclusive: String,
    pub byte_count: u64,
    pub erase_start_address: String,
    pub erase_end_address_exclusive: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryProgramResult {
    pub firmware_sha256: String,
    pub byte_count: u64,
    pub verified: bool,
}
