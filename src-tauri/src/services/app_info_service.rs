use crate::domain::app_info::AppInfo;

/// Business logic for application metadata. Kept out of the command
/// layer so it stays testable and reusable.
pub fn current_app_info() -> AppInfo {
    AppInfo {
        name: "Embedded Toolbox".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}
