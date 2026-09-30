<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { NButton, NInput, NModal, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";

import {
  createDefaultPalettes,
  exportPaletteCollection,
  exportSinglePalette,
  normalizeColor,
  PALETTE_STORAGE_KEY,
  parseImportedPalettes,
  parseSavedPalettes,
  safePaletteFilename,
  serializePalettes,
  uniquePaletteName,
} from "@/modules/color/core/palettes";
import type { Palette } from "@/modules/color/core/palettes";
import { exportPaletteJson } from "@/services/native/palette-export-service";

const { t } = useI18n();
const message = useMessage();

function loadPalettes(): Palette[] {
  try {
    return parseSavedPalettes(localStorage.getItem(PALETTE_STORAGE_KEY)) ?? createDefaultPalettes();
  } catch {
    return createDefaultPalettes();
  }
}

const palettes = ref<Palette[]>(loadPalettes());
const savedSnapshot = ref(serializePalettes(palettes.value));
const dirty = computed(() => serializePalettes(palettes.value) !== savedSnapshot.value);
const selectedPaletteId = ref(palettes.value[0]?.id ?? "");
const selectedColorIndex = ref(0);
const selectedColor = computed(
  () =>
    palettes.value.find((palette) => palette.id === selectedPaletteId.value)?.items[
      selectedColorIndex.value
    ],
);
const selectedHexDraft = ref(selectedColor.value?.color ?? "");
const fileInput = ref<HTMLInputElement | null>(null);
const exporting = ref(false);
const lastExportPath = ref("");
const collapsedIds = ref(new Set<string>());

const paletteDialogOpen = ref(false);
const paletteEditingId = ref<string | null>(null);
const paletteName = ref("");
const paletteDescription = ref("");

const colorDialogOpen = ref(false);
const colorPaletteId = ref("");
const colorIndex = ref<number | null>(null);
const colorName = ref("");
const colorHex = ref("#000000");
const colorRgb = ref({ r: 0, g: 0, b: 0 });
const canPickScreen = typeof window !== "undefined" && "EyeDropper" in window;
const rgbChannels = ["r", "g", "b"] as const;

function selectColor(palette: Palette, index: number) {
  selectedPaletteId.value = palette.id;
  selectedColorIndex.value = index;
  selectedHexDraft.value = palette.items[index]?.color ?? "";
}

function openPaletteDialog(palette?: Palette) {
  paletteEditingId.value = palette?.id ?? null;
  paletteName.value = palette?.name ?? "";
  paletteDescription.value = palette?.description ?? "";
  paletteDialogOpen.value = true;
}

async function applyPaletteDialog() {
  const name = paletteName.value.trim();
  if (!name) return message.warning(t("palette.nameRequired"));
  const existing = paletteEditingId.value
    ? palettes.value.find((palette) => palette.id === paletteEditingId.value)
    : null;
  const others = palettes.value.filter((palette) => palette.id !== paletteEditingId.value);
  const finalName = uniquePaletteName(name, others);
  if (existing) {
    existing.name = finalName;
    existing.description = paletteDescription.value.trim();
  } else {
    const palette: Palette = {
      id: crypto.randomUUID(),
      name: finalName,
      description: paletteDescription.value.trim(),
      items: [],
    };
    palettes.value.push(palette);
    selectedPaletteId.value = palette.id;
    selectedColorIndex.value = 0;
    selectedHexDraft.value = "";
    await nextTick();
    document.getElementById(`palette-${palette.id}`)?.scrollIntoView({ block: "start" });
  }
  paletteDialogOpen.value = false;
}

function removePalette(palette: Palette) {
  if (!window.confirm(t("palette.confirmRemovePalette", { name: palette.name }))) return;
  palettes.value = palettes.value.filter((entry) => entry.id !== palette.id);
  collapsedIds.value.delete(palette.id);
  if (selectedPaletteId.value === palette.id) {
    const next = palettes.value[0];
    selectedPaletteId.value = next?.id ?? "";
    selectedColorIndex.value = 0;
    selectedHexDraft.value = next?.items[0]?.color ?? "";
  }
}

function toggleCollapsed(id: string) {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
}

function hexToRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

function setColorHex(value: string) {
  colorHex.value = value;
  const hex = normalizeColor(value);
  if (hex) colorRgb.value = hexToRgb(hex);
}

function setColorRgb(channel: "r" | "g" | "b", value: string) {
  colorRgb.value[channel] = Math.max(0, Math.min(255, Number(value) || 0));
  colorHex.value = rgbToHex(colorRgb.value.r, colorRgb.value.g, colorRgb.value.b);
}

function openColorDialog(palette: Palette, index: number | null = null) {
  colorPaletteId.value = palette.id;
  colorIndex.value = index;
  colorName.value = index === null ? "" : (palette.items[index]?.name ?? "");
  setColorHex(index === null ? "#000000" : (palette.items[index]?.color ?? "#000000"));
  colorDialogOpen.value = true;
  if (index !== null) selectColor(palette, index);
}

function applyColorDialog() {
  const palette = palettes.value.find((entry) => entry.id === colorPaletteId.value);
  const name = colorName.value.trim();
  const hex = normalizeColor(colorHex.value);
  if (!palette) return;
  if (!name) return message.warning(t("palette.colorNameRequired"));
  if (!hex) return message.warning(t("palette.invalidHex"));
  if (colorIndex.value === null) {
    palette.items.push({ name, color: hex });
    selectColor(palette, palette.items.length - 1);
  } else {
    const item = palette.items[colorIndex.value];
    if (!item) return;
    item.name = name;
    item.color = hex;
    selectColor(palette, colorIndex.value);
  }
  colorDialogOpen.value = false;
}

function removeColor() {
  const palette = palettes.value.find((entry) => entry.id === colorPaletteId.value);
  const index = colorIndex.value;
  if (!palette || index === null) return;
  if (!window.confirm(t("palette.confirmRemoveColor", { name: palette.items[index]?.name ?? "" })))
    return;
  palette.items.splice(index, 1);
  if (selectedPaletteId.value === palette.id) {
    selectedColorIndex.value = Math.min(selectedColorIndex.value, palette.items.length - 1);
    selectedHexDraft.value = palette.items[selectedColorIndex.value]?.color ?? "";
  }
  colorDialogOpen.value = false;
}

async function pickScreenColor() {
  if (!("EyeDropper" in window)) return;
  try {
    const EyeDropperClass = (
      window as Window & { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }
    ).EyeDropper;
    const result = await new EyeDropperClass().open();
    setColorHex(result.sRGBHex.toUpperCase());
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      message.error(t("palette.pickFailed"));
  }
}

function updateSelectedHex() {
  const hex = normalizeColor(selectedHexDraft.value);
  if (!selectedColor.value) return;
  if (!hex) {
    selectedHexDraft.value = selectedColor.value.color;
    return message.warning(t("palette.invalidHex"));
  }
  selectedColor.value.color = hex;
  selectedHexDraft.value = hex;
}

async function copyColor(palette: Palette, index: number) {
  selectColor(palette, index);
  const item = palette.items[index];
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.color);
    message.success(t("palette.copied", { color: item.color }));
  } catch {
    message.error(t("palette.copyFailed"));
  }
}

async function exportJson(payload: unknown, filename: string) {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const result = await exportPaletteJson(payload, filename);
    if (result.status === "saved") {
      lastExportPath.value = result.path;
      message.success(t("palette.exportSaved"));
    } else if (result.status === "downloaded") {
      message.info(t("palette.exportDownloaded"));
    }
  } catch {
    message.error(t("palette.exportFailed"));
  } finally {
    exporting.value = false;
  }
}

function exportOne(palette: Palette) {
  return exportJson(exportSinglePalette(palette), `${safePaletteFilename(palette.name)}.json`);
}

function exportAll() {
  return exportJson(exportPaletteCollection(palettes.value), "color-palette-collection.json");
}

async function importFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  let count = 0;
  let skipped = 0;
  let lastImportedId = "";
  for (const file of files) {
    try {
      const parsed: unknown = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      const imported = parseImportedPalettes(
        parsed,
        file.name.replace(/\.json$/i, "") || "Imported Palette",
      );
      if (imported.length === 0) skipped++;
      for (const palette of imported) {
        palette.name = uniquePaletteName(palette.name, palettes.value);
        palettes.value.push(palette);
        selectedPaletteId.value = palette.id;
        selectedColorIndex.value = 0;
        selectedHexDraft.value = palette.items[0]?.color ?? "";
        lastImportedId = palette.id;
        count++;
      }
    } catch {
      skipped++;
    }
  }
  input.value = "";
  if (lastImportedId) {
    await nextTick();
    document.getElementById(`palette-${lastImportedId}`)?.scrollIntoView({ block: "start" });
  }
  if (count) message.success(t("palette.imported", { count }));
  if (skipped) message.warning(t("palette.skippedFiles", { count: skipped }));
}

function savePalettes() {
  const snapshot = serializePalettes(palettes.value);
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, snapshot);
    savedSnapshot.value = snapshot;
    message.success(t("palette.saved"));
  } catch {
    message.error(t("palette.saveFailed"));
  }
}

function restoreDefaults() {
  if (!window.confirm(t("palette.confirmRestore"))) return;
  try {
    localStorage.removeItem(PALETTE_STORAGE_KEY);
  } catch {
    message.error(t("palette.saveFailed"));
    return;
  }
  palettes.value = createDefaultPalettes();
  savedSnapshot.value = serializePalettes(palettes.value);
  collapsedIds.value = new Set();
  selectedPaletteId.value = palettes.value[0]?.id ?? "";
  selectedColorIndex.value = 0;
  selectedHexDraft.value = palettes.value[0]?.items[0]?.color ?? "";
  message.success(t("palette.restored"));
}
</script>

<template>
  <div class="palette-view">
    <header class="page-header">
      <div>
        <h1>{{ t("tools.colorPalette") }}</h1>
        <p>{{ t("palette.description") }}</p>
      </div>
      <span v-if="dirty" class="dirty-indicator">{{ t("palette.unsaved") }}</span>
    </header>

    <div class="toolbar">
      <n-button size="small" type="primary" @click="openPaletteDialog()">{{
        t("palette.newPalette")
      }}</n-button>
      <n-button size="small" @click="fileInput?.click()">{{ t("palette.import") }}</n-button>
      <n-button size="small" :disabled="palettes.length === 0 || exporting" @click="exportAll">{{
        t("palette.exportAll")
      }}</n-button>
      <n-button size="small" @click="restoreDefaults">{{ t("palette.restore") }}</n-button>
      <n-button size="small" :disabled="!dirty" @click="savePalettes">{{
        t("palette.save")
      }}</n-button>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".json,application/json"
        multiple
        @change="importFiles"
      />
    </div>
    <p v-if="lastExportPath" class="export-location">
      {{ t("palette.lastExportPath") }} <code>{{ lastExportPath }}</code>
    </p>

    <div v-if="palettes.length === 0" class="empty-state">{{ t("palette.empty") }}</div>
    <div v-else class="palette-stack">
      <section
        v-for="palette in palettes"
        :id="`palette-${palette.id}`"
        :key="palette.id"
        class="palette-section"
      >
        <header class="palette-heading">
          <button
            class="palette-title"
            type="button"
            :aria-expanded="!collapsedIds.has(palette.id)"
            @click="toggleCollapsed(palette.id)"
          >
            <span class="chevron">{{ collapsedIds.has(palette.id) ? "▸" : "▾" }}</span>
            <span class="palette-name">{{ palette.name }}</span>
            <span class="palette-count">{{
              t("palette.colorCount", { count: palette.items.length })
            }}</span>
          </button>
          <div class="palette-actions">
            <n-button size="tiny" @click="openPaletteDialog(palette)">{{
              t("palette.editPalette")
            }}</n-button>
            <n-button size="tiny" @click="openColorDialog(palette)">{{
              t("palette.addColor")
            }}</n-button>
            <n-button size="tiny" :disabled="exporting" @click="exportOne(palette)">{{
              t("palette.exportOne")
            }}</n-button>
            <n-button size="tiny" type="error" quaternary @click="removePalette(palette)">{{
              t("palette.remove")
            }}</n-button>
          </div>
        </header>
        <div v-if="!collapsedIds.has(palette.id)" class="palette-body">
          <p v-if="palette.description" class="palette-description">{{ palette.description }}</p>
          <div v-if="palette.items.length" class="color-grid">
            <article
              v-for="(item, index) in palette.items"
              :key="index"
              class="color-card"
              :class="{
                selected: selectedPaletteId === palette.id && selectedColorIndex === index,
              }"
            >
              <button
                class="swatch"
                type="button"
                :style="{ backgroundColor: item.color }"
                :aria-label="t('palette.editColorNamed', { name: item.name })"
                @click="openColorDialog(palette, index)"
              />
              <button
                class="color-label"
                type="button"
                :title="t('palette.copyColor')"
                @click="copyColor(palette, index)"
              >
                <strong>{{ item.name }}</strong
                ><code>{{ item.color }}</code>
              </button>
            </article>
          </div>
          <p v-else class="empty-colors">{{ t("palette.noColors") }}</p>
        </div>
      </section>
    </div>

    <div class="selected-bar">
      <label for="selected-hex">{{ t("palette.selectedColor") }}</label>
      <input
        id="selected-hex"
        v-model="selectedHexDraft"
        class="hex-input"
        type="text"
        maxlength="7"
        :disabled="!selectedColor"
        @change="updateSelectedHex"
        @keydown.enter="updateSelectedHex"
      />
    </div>

    <n-modal
      v-model:show="paletteDialogOpen"
      preset="card"
      :title="t(paletteEditingId ? 'palette.editPalette' : 'palette.newPalette')"
      style="width: min(450px, calc(100vw - 32px))"
    >
      <div class="editor-fields">
        <label
          >{{ t("palette.paletteName")
          }}<n-input
            v-model:value="paletteName"
            maxlength="100"
            @keydown.enter="applyPaletteDialog"
        /></label>
        <label
          >{{ t("palette.paletteDescription")
          }}<n-input v-model:value="paletteDescription" type="textarea" :rows="2" maxlength="500"
        /></label>
      </div>
      <div class="dialog-actions">
        <n-button @click="paletteDialogOpen = false">{{ t("palette.cancel") }}</n-button>
        <n-button type="primary" @click="applyPaletteDialog">{{ t("palette.apply") }}</n-button>
      </div>
    </n-modal>

    <n-modal
      v-model:show="colorDialogOpen"
      preset="card"
      :title="t(colorIndex === null ? 'palette.addColor' : 'palette.editColor')"
      style="width: min(450px, calc(100vw - 32px))"
    >
      <div class="editor-fields">
        <label
          >{{ t("palette.colorName") }}<n-input v-model:value="colorName" maxlength="100"
        /></label>
        <div class="color-editor-row">
          <input
            type="color"
            class="native-color"
            :value="normalizeColor(colorHex) ?? '#000000'"
            :aria-label="t('palette.chooseColor')"
            @input="setColorHex(($event.target as HTMLInputElement).value)"
          />
          <label
            >{{ t("palette.hex")
            }}<n-input
              :value="colorHex"
              maxlength="7"
              @update:value="setColorHex"
              @keydown.enter="applyColorDialog"
          /></label>
          <n-button v-if="canPickScreen" size="small" @click="pickScreenColor">{{
            t("palette.eyedropper")
          }}</n-button>
        </div>
        <div class="rgb-fields">
          <label v-for="channel in rgbChannels" :key="channel"
            >{{ channel.toUpperCase() }}
            <input
              type="number"
              min="0"
              max="255"
              :value="colorRgb[channel]"
              @change="setColorRgb(channel, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
      </div>
      <div class="dialog-actions">
        <n-button
          v-if="colorIndex !== null"
          type="error"
          quaternary
          class="remove-color"
          @click="removeColor"
          >{{ t("palette.removeColor") }}</n-button
        >
        <n-button @click="colorDialogOpen = false">{{ t("palette.cancel") }}</n-button>
        <n-button type="primary" @click="applyColorDialog">{{ t("palette.apply") }}</n-button>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
.palette-view {
  width: 100%;
  max-width: 1280px;
  padding-bottom: 24px;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.page-header h1 {
  margin: 0 0 5px;
  font-size: 19px;
  font-weight: 600;
}
.page-header p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--et-text-secondary);
}
.dirty-indicator {
  white-space: nowrap;
  color: var(--et-accent);
  font-size: 12px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px;
  margin-bottom: 14px;
  border: 1px solid var(--et-border-color);
  border-radius: 5px;
  background: var(--et-bg-surface);
}
.file-input {
  display: none;
}
.export-location {
  margin: -5px 0 14px;
  color: var(--et-text-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.export-location code {
  font-family: Consolas, monospace;
}
.palette-stack {
  display: grid;
  gap: 14px;
}
.palette-section {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--et-border-color);
  border-radius: 6px;
  background: var(--et-bg-surface);
}
.palette-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  background: var(--et-bg-elevated);
  border-bottom: 1px solid var(--et-border-color);
}
.palette-title {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  padding: 4px 0;
  color: var(--et-text-primary);
  background: none;
  border: 0;
  text-align: left;
  cursor: pointer;
}
.chevron {
  color: var(--et-text-secondary);
  font-size: 16px;
}
.palette-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.palette-count {
  flex-shrink: 0;
  color: var(--et-text-muted);
  font-size: 11px;
}
.palette-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.palette-body {
  padding: 12px;
}
.palette-description {
  margin: 0 0 10px;
  color: var(--et-text-secondary);
  font-size: 12px;
}
.color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 10px;
}
.color-card {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  min-width: 0;
  height: 68px;
  overflow: hidden;
  border: 1px solid var(--et-border-color);
  border-radius: 5px;
}
.color-card.selected {
  outline: 2px solid var(--et-accent);
  outline-offset: 1px;
}
.swatch {
  border: 0;
  border-right: 1px solid var(--et-border-color);
  cursor: pointer;
}
.color-label {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  padding: 7px 9px;
  border: 0;
  background: var(--et-bg-surface);
  color: var(--et-text-primary);
  text-align: left;
  cursor: copy;
}
.color-label:hover {
  background: var(--et-bg-hover);
}
.color-label strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.color-label code {
  color: var(--et-text-secondary);
  font-size: 11px;
}
.empty-state,
.empty-colors {
  margin: 0;
  padding: 24px;
  border: 1px dashed var(--et-border-color);
  border-radius: 5px;
  color: var(--et-text-muted);
  text-align: center;
}
.selected-bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  margin-top: 14px;
  border: 1px solid var(--et-border-color);
  border-radius: 5px;
  background: var(--et-bg-surface);
}
.selected-bar label {
  white-space: nowrap;
}
.hex-input,
.rgb-fields input {
  height: 32px;
  padding: 4px 8px;
  border: 1px solid var(--et-border-color);
  border-radius: 3px;
  background: var(--et-bg-elevated);
  color: var(--et-text-primary);
  font: inherit;
}
.hex-input {
  width: 130px;
  font-family: Consolas, monospace;
}
.editor-fields {
  display: grid;
  gap: 14px;
}
.editor-fields label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--et-text-secondary);
}
.color-editor-row {
  display: flex;
  align-items: end;
  gap: 10px;
}
.color-editor-row label {
  flex: 1;
}
.native-color {
  width: 48px;
  height: 34px;
  padding: 2px;
  border: 1px solid var(--et-border-color);
  border-radius: 3px;
  background: var(--et-bg-surface);
  cursor: pointer;
}
.rgb-fields {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.rgb-fields input {
  width: 100%;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.remove-color {
  margin-right: auto;
}
@media (max-width: 640px) {
  .palette-title {
    flex-basis: 100%;
  }
  .color-editor-row {
    flex-wrap: wrap;
  }
}
</style>
