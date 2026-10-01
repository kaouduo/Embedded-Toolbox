mod commands;
mod domain;
mod services;

use std::sync::Arc;

use services::connection_service::ConnectionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Arc::new(ConnectionManager::new()))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info::get_app_info,
            commands::connection::list_serial_ports,
            commands::connection::open_connection,
            commands::connection::write_connection,
            commands::connection::close_connection,
            commands::target_catalog::list_target_packs,
            commands::target_catalog::import_target_pack,
            commands::target_catalog::list_target_analyses,
            commands::target_catalog::analyze_target_pack,
            commands::probe::list_supported_probes,
            commands::probe::test_target_connection,
            commands::flash_plan::plan_binary_flash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
