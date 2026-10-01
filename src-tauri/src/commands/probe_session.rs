use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::domain::error::NativeError;
use crate::domain::flash_plan::BinaryProgramResult;
use crate::domain::probe::{ProbeSelection, ProbeSessionInfo, RamReadResult, TargetIdentityResult};
use crate::services::probe_service::ProbeSessionManager;

/// Thin command layer over `ProbeSessionManager`. All session operations
/// perform blocking probe I/O, so every command hops to `spawn_blocking`.
fn catalog_root(app: &AppHandle) -> Result<std::path::PathBuf, NativeError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| NativeError::io(error.to_string()))?
        .join("target-catalog"))
}

#[tauri::command]
pub async fn attach_probe_session(
    app: AppHandle,
    state: State<'_, Arc<ProbeSessionManager>>,
    probe: ProbeSelection,
    pack_id: String,
    sha256: String,
    device: String,
    speed_khz: u32,
) -> Result<ProbeSessionInfo, NativeError> {
    let root = catalog_root(&app)?;
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager.attach(&root, &probe, &pack_id, &sha256, &device, speed_khz)
    })
    .await
    .map_err(|_| NativeError::internal("Probe attach task failed"))?
}

#[tauri::command]
pub async fn probe_session_status(
    state: State<'_, Arc<ProbeSessionManager>>,
    session_id: String,
) -> Result<ProbeSessionInfo, NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || manager.status(&session_id))
        .await
        .map_err(|_| NativeError::internal("Probe status task failed"))?
}

#[tauri::command]
pub async fn inspect_probe_target(
    state: State<'_, Arc<ProbeSessionManager>>,
    session_id: String,
) -> Result<TargetIdentityResult, NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || manager.inspect_target(&session_id))
        .await
        .map_err(|_| NativeError::internal("Probe identity task failed"))?
}

#[tauri::command]
pub async fn program_probe_binary(
    app: AppHandle,
    state: State<'_, Arc<ProbeSessionManager>>,
    session_id: String,
    firmware_path: String,
    start_address: String,
    expected_sha256: String,
    confirmed_part: bool,
) -> Result<BinaryProgramResult, NativeError> {
    let root = catalog_root(&app)?;
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager.program_binary(
            &root,
            &session_id,
            std::path::Path::new(&firmware_path),
            &start_address,
            &expected_sha256,
            confirmed_part,
        )
    })
    .await
    .map_err(|_| NativeError::internal("Programming task failed"))?
}

#[tauri::command]
pub async fn erase_probe_internal_flash(
    app: AppHandle,
    state: State<'_, Arc<ProbeSessionManager>>,
    session_id: String,
    confirmed: bool,
) -> Result<(), NativeError> {
    let root = catalog_root(&app)?;
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager.erase_internal_flash(&root, &session_id, confirmed)
    })
    .await
    .map_err(|_| NativeError::internal("Full Flash erase task failed"))?
}

#[tauri::command]
pub async fn halt_probe_session(
    state: State<'_, Arc<ProbeSessionManager>>,
    session_id: String,
) -> Result<ProbeSessionInfo, NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || manager.halt(&session_id))
        .await
        .map_err(|_| NativeError::internal("Probe halt task failed"))?
}

#[tauri::command]
pub async fn resume_probe_session(
    state: State<'_, Arc<ProbeSessionManager>>,
    session_id: String,
) -> Result<ProbeSessionInfo, NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || manager.resume(&session_id))
        .await
        .map_err(|_| NativeError::internal("Probe resume task failed"))?
}

#[tauri::command]
pub async fn read_probe_ram(
    state: State<'_, Arc<ProbeSessionManager>>,
    session_id: String,
    address: u64,
    length: u32,
) -> Result<RamReadResult, NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager.read_ram(&session_id, address, length as usize)
    })
    .await
    .map_err(|_| NativeError::internal("Probe read task failed"))?
}

#[tauri::command]
pub async fn disconnect_probe_session(
    state: State<'_, Arc<ProbeSessionManager>>,
    session_id: String,
) -> Result<(), NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || manager.disconnect(&session_id))
        .await
        .map_err(|_| NativeError::internal("Probe disconnect task failed"))?
}
