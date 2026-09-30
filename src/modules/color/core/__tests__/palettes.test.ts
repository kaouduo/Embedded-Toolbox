import { describe, expect, it } from "vite-plus/test";

import {
  createDefaultPalettes,
  exportPaletteCollection,
  exportSinglePalette,
  normalizeColor,
  parseImportedPalettes,
  parseSavedPalettes,
  serializePalettes,
  uniquePaletteName,
} from "../palettes";

describe("color palettes", () => {
  it("accepts arbitrary color counts and the original v4 JSON formats", () => {
    const single = parseImportedPalettes(
      { name: "UI", palette: [{ name: "Accent", color: "16a0ff" }] },
      "fallback",
    );
    expect(single[0]?.items).toEqual([{ name: "Accent", color: "#16A0FF" }]);

    const collection = exportPaletteCollection(single);
    const imported = parseImportedPalettes(collection, "fallback");
    expect(imported).toHaveLength(1);
    expect(imported[0]?.items).toHaveLength(1);
    expect(parseImportedPalettes(exportSinglePalette(single[0]!), "fallback")).toHaveLength(1);
  });

  it("keeps an explicitly saved empty collection empty", () => {
    expect(parseSavedPalettes(serializePalettes([]))).toEqual([]);
    expect(parseSavedPalettes(null)).toBeNull();
    expect(createDefaultPalettes()[0]?.items).toHaveLength(35);
  });

  it("rejects invalid colors without losing valid palettes in a collection", () => {
    expect(normalizeColor("#12345")).toBeNull();
    const palettes = parseImportedPalettes(
      {
        palettes: [
          { name: "Good", palette: [] },
          { name: "Bad", palette: [{ name: "X", color: "red" }] },
        ],
      },
      "fallback",
    );
    expect(palettes.map((palette) => palette.name)).toEqual(["Good"]);
    expect(
      parseSavedPalettes('{"version":1,"palettes":[{"palette":[{"name":"X","color":"red"}]}]}'),
    ).toBeNull();
  });

  it("assigns a unique name when importing the same palette repeatedly", () => {
    const palettes = parseImportedPalettes({ name: "UI", palette: [] }, "fallback");
    expect(uniquePaletteName("ui", palettes)).toBe("ui (2)");
  });
});
