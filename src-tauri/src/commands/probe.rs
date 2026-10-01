use crate::domain::error::NativeError;
use crate::domain::probe::ProbeRecord;
use crate::services::probe_service;

#[tauri::command]
pub async fn list_supported_probes() -> Result<Vec<ProbeRecord>, NativeError> {
    tauri::async_runtime::spawn_blocking(probe_service::list_supported_probes)
        .await
        .map_err(|error| NativeError::internal(error.to_string()))
}
