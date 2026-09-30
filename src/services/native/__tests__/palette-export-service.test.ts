import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { save, writeTextFile, isTauriRuntime } = vi.hoisted(() => ({
  save: vi.fn(),
  writeTextFile: vi.fn(),
  isTauriRuntime: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile }));
vi.mock("../native-service", () => ({ isTauriRuntime }));

import { exportPaletteJson } from "../palette-export-service";

describe("palette JSON export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
  });

  it("writes UTF-8 JSON to the path selected in Save As", async () => {
    const path = "C:\\Design\\color-palettes\\dashboard-light-v1.json";
    const palette = { version: 4, name: "Dashboard", palette: [] };
    save.mockResolvedValue(path);

    await expect(exportPaletteJson(palette, "dashboard.json")).resolves.toEqual({
      status: "saved",
      path,
    });
    expect(save).toHaveBeenCalledWith({
      defaultPath: "dashboard.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    expect(writeTextFile).toHaveBeenCalledWith(path, `\uFEFF${JSON.stringify(palette, null, 2)}`);
  });

  it("does not write a file when Save As is cancelled", async () => {
    save.mockResolvedValue(null);

    await expect(exportPaletteJson({ version: 4 }, "palette.json")).resolves.toEqual({
      status: "cancelled",
    });
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});
