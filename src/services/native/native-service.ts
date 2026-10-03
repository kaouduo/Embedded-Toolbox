import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * NativeService is the ONLY place in the frontend allowed to call
 * Tauri's `invoke` / `listen`. Vue components and module code must never
 * import `@tauri-apps/api` directly — they go through services in
 * `src/services/` which delegate here.
 */

export interface NativeError {
  /** Stable machine-readable error kind, e.g. "io", "serial", "internal". */
  kind: string;
  message: string;
}

export class NativeInvokeError extends Error {
  constructor(readonly kind: string, message: string) {
    super(message);
    this.name = "NativeInvokeError";
  }
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
      throw new NativeInvokeError(error.kind, error.message);
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

/**
 * Subscribe to a Tauri event. Returns an unsubscribe function.
 *
 * Kept here so `@tauri-apps/api/event` is only imported by this module,
 * matching the `invoke` boundary above.
 */
export async function listenNative<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const unlisten = await listen<T>(event, (message) => handler(message.payload));
  return () => {
    unlisten();
  };
}
