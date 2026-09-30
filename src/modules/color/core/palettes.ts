export interface ColorItem {
  name: string;
  color: string;
}

export interface Palette {
  id: string;
  name: string;
  description: string;
  items: ColorItem[];
}

export const PALETTE_STORAGE_KEY = "embedded-toolbox.color-palettes.v1";

const defaultItems: ColorItem[] = [
  { name: "Black", color: "#000000" },
  { name: "Blue 1", color: "#06064D" },
  { name: "Blue 2", color: "#0B0788" },
  { name: "Blue 3", color: "#120AC0" },
  { name: "Blue 4", color: "#1614F2" },
  { name: "Gray 1", color: "#4A4A4A" },
  { name: "Green 1", color: "#00520D" },
  { name: "Green 2", color: "#008D0A" },
  { name: "Green 3", color: "#00C50A" },
  { name: "Green 4", color: "#05F20D" },
  { name: "Gray 2", color: "#8A8A8A" },
  { name: "Cyan 1", color: "#07524F" },
  { name: "Cyan 2", color: "#078E8A" },
  { name: "Cyan 3", color: "#12BDBD" },
  { name: "Cyan 4", color: "#10DEE7" },
  { name: "Gray 3", color: "#BFBFBF" },
  { name: "Red 1", color: "#570500" },
  { name: "Red 2", color: "#980700" },
  { name: "Red 3", color: "#D00600" },
  { name: "Red 4", color: "#F9140C" },
  { name: "White", color: "#FFFFFF" },
  { name: "Magenta 1", color: "#4D064A" },
  { name: "Magenta 2", color: "#890784" },
  { name: "Magenta 3", color: "#C30BC1" },
  { name: "Magenta 4", color: "#EE0BEA" },
  { name: "L.Yellow", color: "#FFFDB5" },
  { name: "Brown 1", color: "#4B4B00" },
  { name: "Brown 2", color: "#878800" },
  { name: "Yellow 3", color: "#C5C800" },
  { name: "Yellow 4", color: "#FFF900" },
  { name: "L.Orange", color: "#FFE6C1" },
  { name: "Orange 1", color: "#8C5600" },
  { name: "Orange 2", color: "#CF6500" },
  { name: "Orange 3", color: "#E88400" },
  { name: "Orange 4", color: "#FF9500" },
];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : null;
}

export function createDefaultPalettes(): Palette[] {
  return [
    {
      id: crypto.randomUUID(),
      name: "Built-in Palette",
      description: "Default color palette",
      items: defaultItems.map((item) => ({ ...item })),
    },
  ];
}

export function parsePalette(value: unknown, fallbackName: string): Palette | null {
  const data = record(value);
  const source = Array.isArray(value)
    ? value
    : Array.isArray(data?.palette)
      ? data.palette
      : data?.items;
  if (!Array.isArray(source)) return null;

  const items: ColorItem[] = [];
  for (const entry of source) {
    const item = record(entry);
    const color = normalizeColor(item?.color);
    if (!item || typeof item.name !== "string" || !item.name.trim() || !color) return null;
    items.push({ name: item.name.trim(), color });
  }

  return {
    id: crypto.randomUUID(),
    name: typeof data?.name === "string" && data.name.trim() ? data.name.trim() : fallbackName,
    description: typeof data?.description === "string" ? data.description : "",
    items,
  };
}

export function parseImportedPalettes(value: unknown, fallbackName: string): Palette[] {
  const data = record(value);
  if (Array.isArray(data?.palettes)) {
    return data.palettes
      .map((entry, index) => parsePalette(entry, `${fallbackName} ${index + 1}`))
      .filter((palette): palette is Palette => palette !== null);
  }
  const palette = parsePalette(value, fallbackName);
  return palette ? [palette] : [];
}

export function parseSavedPalettes(raw: string | null): Palette[] | null {
  if (raw === null) return null;
  try {
    const data = record(JSON.parse(raw));
    if (data?.version !== 1 || !Array.isArray(data.palettes)) return null;
    const palettes = data.palettes.map((entry, index) =>
      parsePalette(entry, `Palette ${index + 1}`),
    );
    return palettes.every((palette) => palette !== null) ? (palettes as Palette[]) : null;
  } catch {
    return null;
  }
}

export function serializePalettes(palettes: Palette[]): string {
  return JSON.stringify({ version: 1, palettes: palettes.map(exportPaletteData) });
}

function exportPaletteData(palette: Palette) {
  return {
    name: palette.name,
    description: palette.description,
    palette: palette.items.map((item) => ({ ...item })),
  };
}

export function exportSinglePalette(palette: Palette) {
  return {
    format: "color-palette-manager",
    version: 4,
    encoding: "UTF-8",
    ...exportPaletteData(palette),
  };
}

export function exportPaletteCollection(palettes: Palette[]) {
  return {
    format: "color-palette-manager-collection",
    version: 4,
    encoding: "UTF-8",
    exportedAt: new Date().toISOString(),
    palettes: palettes.map(exportPaletteData),
  };
}

export function uniquePaletteName(name: string, palettes: Palette[]): string {
  const existing = new Set(palettes.map((palette) => palette.name.toLocaleLowerCase()));
  if (!existing.has(name.toLocaleLowerCase())) return name;
  let suffix = 2;
  while (existing.has(`${name} (${suffix})`.toLocaleLowerCase())) suffix++;
  return `${name} (${suffix})`;
}

export function safePaletteFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "palette"
  );
}
