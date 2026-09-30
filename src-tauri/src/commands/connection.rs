use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::domain::connection::{ConnectionConfig, SerialPortInfo};
use crate::domain::error::NativeError;
use crate::services::connection_service::{self, ConnectionManager};

/// 薄命令层：只负责参数转换与状态取用，业务逻辑在 `services::connection_service`。
///
/// open / write / close 均含阻塞 I/O（连接超时、写超时、join 读线程），
/// 必须经 `spawn_blocking` 移出 async 运行时线程，避免阻塞其他命令。
#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, NativeError> {
    connection_service::list_serial_ports()
}

#[tauri::command]
pub async fn open_connection(
    app: AppHandle,
    state: State<'_, Arc<ConnectionManager>>,
    connection_id: String,
    config: ConnectionConfig,
) -> Result<(), NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || manager.open(&app, &connection_id, &config))
        .await
        .map_err(|_| NativeError::internal("open connection task failed to complete"))?
}

#[tauri::command]
pub async fn write_connection(
    state: State<'_, Arc<ConnectionManager>>,
    connection_id: String,
    data: Vec<u8>,
) -> Result<(), NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || manager.write(&connection_id, &data))
        .await
        .map_err(|_| NativeError::internal("write connection task failed to complete"))?
}

#[tauri::command]
pub async fn close_connection(
    state: State<'_, Arc<ConnectionManager>>,
    connection_id: String,
) -> Result<(), NativeError> {
    let manager = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || manager.close(&connection_id))
        .await
        .map_err(|_| NativeError::internal("close connection task failed to complete"))?
}