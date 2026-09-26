<script setup lang="ts">
import { NButton, NTooltip, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";

import { DATA_LAYOUTS } from "@/modules/converter/core/byte-order";
import type {
  ConversionErrorCode,
  ConversionRow,
  InputFormat,
} from "@/modules/converter/core/data-converter";

defineProps<{
  rows: ConversionRow[];
  inputFormat: InputFormat;
}>();

const { t } = useI18n();
const message = useMessage();

const layoutDescriptionKeys = {
  abcd: "converter.layouts.abcd",
  dcba: "converter.layouts.dcba",
  badc: "converter.layouts.badc",
  cdab: "converter.layouts.cdab",
} as const;

function errorText(error?: ConversionErrorCode): string {
  if (!error) return "";
  return t(`converter.errors.${error}`);
}

async function copyValue(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    message.success(t("converter.copied"));
  } catch {
    message.error(t("converter.copyFailed"));
  }
}
</script>

<template>
  <div class="table-shell">
    <table class="conversion-table">
      <thead>
        <tr>
          <th class="type-column">{{ t("converter.dataType") }}</th>
          <th v-for="layout in DATA_LAYOUTS" :key="layout.id">
            <n-tooltip placement="top">
              <template #trigger>
                <span class="layout-heading">{{ layout.label }}</span>
              </template>
              {{ t(layoutDescriptionKeys[layout.id]) }}
            </n-tooltip>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.dataType.id">
          <th scope="row">
            <span class="type-name">{{ row.dataType.label }}</span>
            <span class="type-detail">{{ row.dataType.bits }}-bit</span>
          </th>
          <td v-for="layout in DATA_LAYOUTS" :key="layout.id">
            <div v-if="row.cells[layout.id].value" class="result-cell">
              <span class="result-value">{{ row.cells[layout.id].value }}</span>
              <n-button
                text
                size="tiny"
                class="copy-button"
                :aria-label="t('converter.copy')"
                @click="copyValue(row.cells[layout.id].value ?? '')"
              >
                {{ t("converter.copy") }}
              </n-button>
            </div>
            <n-tooltip v-else-if="row.cells[layout.id].error" placement="top">
              <template #trigger>
                <span class="invalid-result">—</span>
              </template>
              {{ errorText(row.cells[layout.id].error) }}
            </n-tooltip>
            <span v-else class="invalid-result">—</span>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="table-footer">
      {{
        inputFormat === "decimal" ? t("converter.decimalOutputHint") : t("converter.hexOutputHint")
      }}
    </div>
  </div>
</template>

<style scoped>
.table-shell {
  overflow-x: auto;
  border: 1px solid var(--et-border-color);
  background: var(--et-bg-surface);
}

.conversion-table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
  table-layout: fixed;
}

.conversion-table th,
.conversion-table td {
  height: 44px;
  padding: 7px 10px;
  border-right: 1px solid var(--et-border-color);
  border-bottom: 1px solid var(--et-border-color);
  text-align: left;
  vertical-align: middle;
}

.conversion-table th:last-child,
.conversion-table td:last-child {
  border-right: 0;
}

.conversion-table tbody tr:last-child th,
.conversion-table tbody tr:last-child td {
  border-bottom: 0;
}

.conversion-table thead th {
  height: 38px;
  background: var(--et-bg-base);
  font-size: 12px;
  font-weight: 600;
}

.type-column {
  width: 132px;
}

.layout-heading {
  cursor: help;
  border-bottom: 1px dotted currentColor;
}

.type-name,
.type-detail {
  display: block;
}

.type-name {
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 12px;
}

.type-detail {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 400;
  color: var(--et-text-muted);
}

.result-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.result-value {
  min-width: 0;
  overflow: hidden;
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-button {
  flex-shrink: 0;
  color: var(--et-accent);
}

.copy-button:hover {
  opacity: 1;
}

.invalid-result {
  color: var(--et-text-disabled);
  cursor: help;
}

.table-footer {
  padding: 7px 10px;
  border-top: 1px solid var(--et-border-color);
  font-size: 11px;
  color: var(--et-text-secondary);
}
</style>
