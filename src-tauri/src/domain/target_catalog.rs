use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackRecord {
    pub id: String,
    pub vendor: String,
    pub name: String,
    pub version: String,
    pub sha256: String,
    pub imported_at: String,
    pub devices: Vec<DeviceRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRecord {
    pub name: String,
    pub family: String,
    pub core: Option<String>,
    pub memory_regions: Vec<MemoryRegionRecord>,
    pub algorithms: Vec<AlgorithmRecord>,
    pub algorithm_files: Vec<String>,
    pub capability: TargetCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRegionRecord {
    pub id: String,
    pub start: String,
    pub size: String,
    pub access: Option<String>,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlgorithmRecord {
    pub file: String,
    pub start: Option<String>,
    pub size: Option<String>,
    pub ram_start: Option<String>,
    pub ram_size: Option<String>,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TargetCapability {
    /// A PDSC entry exists, but its flash algorithm has not been converted and validated.
    DescriptionOnly,
    /// An FLM was referenced and found in the Pack, but it still needs conversion.
    AlgorithmPresent,
    /// The PDSC references an FLM that is absent from the Pack.
    MissingAlgorithm,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TargetAnalysis {
    pub name: String,
    pub ready: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackAnalysis {
    pub pack_id: String,
    pub sha256: String,
    pub converter_version: String,
    pub target_definition_sha256: String,
    pub targets: Vec<TargetAnalysis>,
}
