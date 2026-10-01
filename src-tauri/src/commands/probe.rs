use crate::domain::error::NativeError;
use crate::domain::probe::{ProbeConnectionResult, ProbeRecord, ProbeSelection};
use crate::services::probe_service;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn list_supported_probes() -> Result<Vec<ProbeRecord>, NativeError> {
    tauri::async_runtime::spawn_blocking(probe_service::list_supported_probes)
        .await
        .map_err(|error| NativeError::internal(error.to_string()))
}

#[tauri::command]
pub async fn test_target_connection(
    app: AppHandle,
    probe: ProbeSelection,
    pack_id: String,
    sha256: String,
    device: String,
    speed_khz: u32,
) -> Result<ProbeConnectionResult, NativeError> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| NativeError::io(error.to_string()))?
        .join("target-catalog");
    tauri::async_runtime::spawn_blocking(move || {
        probe_service::test_target_connection(&root, &probe, &pack_id, &sha256, &device, speed_khz)
    })
    .await
    .map_err(|_| NativeError::internal("Probe connection task failed"))?
}
