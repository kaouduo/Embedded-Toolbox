import { invoke } from "@tauri-apps/api/core";

/**
 * NativeService is the ONLY place in the frontend allowed to call
 * Tauri's `invoke`. Vue components and module code must never import
 * `@tauri-apps/api` directly — they go through services in
 * `src/services/` which delegate here.
 */

export interface NativeError {
  /** Stable machine-readable error kind, e.g. "io", "serial", "internal". */
  kind: string;
  message: string;
}

function isNativeError(value: unknown): value is NativeError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as NativeError).message === "string"
  );
}

/**
 * Invoke a Tauri command and normalize failures into `Error`s whose
 * `message` is understandable by the UI layer.
 */
export async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    if (isNativeError(error)) {
      throw new Error(error.message);
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
}

/** True when running inside the Tauri webview (vs. plain browser dev). */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
