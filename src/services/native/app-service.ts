import type { AppInfo } from "@/shared/types/app-info";

import { invokeNative, isTauriRuntime } from "./native-service";

/**
 * Application-level native services: app metadata, window, updates.
 * Components consume this service; they never call `invokeNative`
 * (and certainly never `invoke`) directly.
 */
export const AppService = {
  /**
   * Fetch name / version / platform from the Rust backend.
   * Falls back to build-time info when running in a plain browser
   * (e.g. `vp dev` without Tauri), so the UI stays usable.
   */
  async getAppInfo(): Promise<AppInfo> {
    if (!isTauriRuntime()) {
      return {
        name: "Embedded Toolbox",
        version: "0.1.0",
        platform: "browser",
        arch: "unknown",
      };
    }
    return invokeNative<AppInfo>("get_app_info");
  },
};
