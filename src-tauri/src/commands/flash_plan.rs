use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::domain::error::NativeError;
use crate::domain::flash_plan::BinaryFlashPlan;
use crate::services::flash_plan_service;

#[tauri::command]
pub async fn plan_binary_flash(
    app: AppHandle,
    pack_id: String,
    pack_sha256: String,
    device: String,
    firmware_path: String,
    start_address: String,
) -> Result<BinaryFlashPlan, NativeError> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| NativeError::io(error.to_string()))?
        .join("target-catalog");
    tauri::async_runtime::spawn_blocking(move || {
        flash_plan_service::plan_binary(
            &root,
            &pack_id,
            &pack_sha256,
            &device,
            &PathBuf::from(firmware_path),
            &start_address,
        )
    })
    .await
    .map_err(|_| NativeError::internal("Flash plan task failed"))?
}
