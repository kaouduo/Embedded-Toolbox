/**
 * Mirrors `domain::app_info::AppInfo` on the Rust side.
 * Returned by the `get_app_info` Tauri command.
 */
export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
}
