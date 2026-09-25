use serde::Serialize;

/// Application metadata exposed to the frontend.
/// Field names are camelCase on the wire to match the TypeScript
/// `AppInfo` interface in `src/shared/types/app-info.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
}
