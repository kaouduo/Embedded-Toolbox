import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

import { isTauriRuntime } from "./native-service";

export type PaletteExportResult =
  | { status: "saved"; path: string }
  | { status: "downloaded" }
  | { status: "cancelled" };

/** A native Save As dialog in Tauri, with ordinary browser downloads in web preview. */
export async function exportPaletteJson(
  payload: unknown,
  filename: string,
): Promise<PaletteExportResult> {
  const json = `\uFEFF${JSON.stringify(payload, null, 2)}`;

  if (isTauriRuntime()) {
    const path = await save({
      defaultPath: filename,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return { status: "cancelled" };
    await writeTextFile(path, json);
    return { status: "saved", path };
  }

  const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return { status: "downloaded" };
}
