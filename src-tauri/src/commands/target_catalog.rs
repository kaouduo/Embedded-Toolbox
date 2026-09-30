use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::domain::error::NativeError;
use crate::domain::target_catalog::PackRecord;
use crate::services::target_catalog_service;

fn catalog_dir(app: &AppHandle) -> Result<PathBuf, NativeError> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("target-catalog"))
        .map_err(|error| NativeError::io(error.to_string()))
}

#[tauri::command]
pub async fn list_target_packs(app: AppHandle) -> Result<Vec<PackRecord>, NativeError> {
    let root = catalog_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || target_catalog_service::list_packs(&root))
        .await
        .map_err(|_| NativeError::internal("target catalog task failed"))?
}

#[tauri::command]
pub async fn import_target_pack(app: AppHandle, path: String) -> Result<PackRecord, NativeError> {
    let root = catalog_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        target_catalog_service::import_pack(&root, &PathBuf::from(path))
    })
    .await
    .map_err(|_| NativeError::internal("target pack import task failed"))?
}
