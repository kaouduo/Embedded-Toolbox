use crate::domain::app_info::AppInfo;
use crate::services::app_info_service;

/// Thin command layer: receive parameters, delegate to services,
/// convert results/errors for the frontend. No business logic here.
#[tauri::command]
pub fn get_app_info() -> AppInfo {
    app_info_service::current_app_info()
}
