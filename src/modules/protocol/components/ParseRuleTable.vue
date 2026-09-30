<script setup lang="ts">
import { NButton, NInputNumber, NSelect } from "naive-ui";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { DATA_TYPES } from "@/modules/converter/core/data-types";
import type { DataTypeId } from "@/modules/converter/core/data-types";
import type { LayoutId } from "@/modules/converter/core/byte-order";
import { bytesToHex } from "@/modules/protocol/core/bytes";
import {
  decodeRule,
  formatDecodedValue,
  layoutsForDataType,
  regionByteOffset,
} from "@/modules/protocol/core/parse-rules";
import type { DataRegion } from "@/modules/protocol/core/parse-rules";
import type { ErrorCode } from "@/modules/protocol/core/types";

const props = defineProps<{
  /** 字节偏移模式的数据来源；提供 `regions` 时不使用。 */
  data?: Uint8Array | null;
  /**
   * 提供后进入地址模式：规则地址为绝对地址（读位类功能码为位地址，
   * 其余为寄存器地址），数据取自覆盖该地址的区域，区域之间互不影响。
   */
  regions?: DataRegion[];
}>();

const { t } = useI18n();

interface UiRule {
  id: number;
  addr: number;
  dataType: DataTypeId;
}

interface RuleCell {
  ordered: string;
  value: string;
  error: string;
}

interface RuleRow {
  rule: UiRule;
  raw: string;
  cells: { layoutId: LayoutId; label: string; cell: RuleCell }[];
}

const rules = ref<UiRule[]>([]);
let sequence = 0;

const typeOptions = DATA_TYPES.map((item) => ({ label: item.label, value: item.id }));

const addressMode = computed(() => props.regions !== undefined);

interface RuleSource {
  data: Uint8Array;
  offset: number;
}

function byteLength(dataType: DataTypeId): number {
  return (DATA_TYPES.find((item) => item.id === dataType)?.bits ?? 16) / 8;
}

/** 地址模式下没有任何区域时还没收到响应，与「区域不覆盖」区分开。 */
function missingText(): string {
  return addressMode.value && (props.regions?.length ?? 0) > 0
    ? t("modbus.parser.notCovered")
    : t("modbus.parser.waiting");
}

/** 规则可读取的数据来源；地址模式下必须被某个已接收区域完整覆盖。 */
function ruleSource(rule: UiRule): RuleSource | null {
  const size = byteLength(rule.dataType);
  if (props.regions) {
    for (const region of props.regions) {
      const offset = regionByteOffset(region, rule.addr, size);
      if (offset !== null) return { data: region.data, offset };
    }
    return null;
  }
  return props.data ? { data: props.data, offset: rule.addr } : null;
}

function rawText(rule: UiRule): string {
  const source = ruleSource(rule);
  if (!source) return missingText();
  return bytesToHex(source.data.slice(source.offset, source.offset + byteLength(rule.dataType)));
}

function decodeCell(rule: UiRule, layoutId: LayoutId): RuleCell {
  const source = ruleSource(rule);
  if (!source) {
    const missing = missingText();
    return { ordered: "—", value: "—", error: missing };
  }

  const result = decodeRule(source.data, {
    kind: "numeric",
    id: rule.id,
    offset: source.offset,
    dataType: rule.dataType,
    layout: layoutId,
  });
  if (!result.ok) {
    return {
      ordered: "—",
      value: "—",
      error: t(`modbus.errors.${result.error.code as ErrorCode}`),
    };
  }

  return {
    ordered: bytesToHex(result.value.ordered),
    value: formatDecodedValue(result.value.decoded),
    error: "",
  };
}

const rows = computed<RuleRow[]>(() =>
  rules.value.map((rule) => ({
    rule,
    raw: rawText(rule),
    cells: layoutsForDataType(rule.dataType).map((layout) => ({
      layoutId: layout.id,
      label: layout.label,
      cell: decodeCell(rule, layout.id),
    })),
  })),
);

function addRule(): void {
  rules.value.push({ id: ++sequence, addr: 0, dataType: "uint16" });
}

function removeRule(id: number): void {
  rules.value = rules.value.filter((rule) => rule.id !== id);
}

function clear(): void {
  rules.value = [];
}

defineExpose({ clear });
</script>

<template>
  <div class="rules">
    <div class="rules-actions">
      <n-button size="small" type="primary" @click="addRule">
        {{ t("modbus.parser.addRule") }}
      </n-button>
    </div>

    <div v-if="rows.length" class="rules-shell">
      <table class="rules-table">
        <thead>
          <tr>
            <th class="offset-column">
              {{
                addressMode ? t("modbus.parser.columns.address") : t("modbus.parser.columns.offset")
              }}
            </th>
            <th class="type-column">{{ t("modbus.parser.columns.dataType") }}</th>
            <th class="bytes-column">{{ t("modbus.parser.columns.raw") }}</th>
            <th class="order-column">{{ t("modbus.parser.columns.order") }}</th>
            <th class="bytes-column">{{ t("modbus.parser.columns.ordered") }}</th>
            <th class="value-column">{{ t("modbus.parser.columns.value") }}</th>
            <th class="action-column">{{ t("modbus.parser.columns.actions") }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in rows" :key="row.rule.id">
            <tr v-for="(item, index) in row.cells" :key="item.layoutId">
              <td v-if="index === 0" :rowspan="row.cells.length">
                <n-input-number
                  v-model:value="row.rule.addr"
                  size="tiny"
                  :min="0"
                  :show-button="false"
                  class="offset-input"
                />
              </td>
              <td v-if="index === 0" :rowspan="row.cells.length">
                <n-select
                  v-model:value="row.rule.dataType"
                  size="tiny"
                  :options="typeOptions"
                  class="type-select"
                />
              </td>
              <td v-if="index === 0" :rowspan="row.cells.length" class="mono raw-cell">
                {{ row.raw }}
              </td>
              <td class="order-cell">{{ item.label }}</td>
              <td class="mono" :title="item.cell.error">{{ item.cell.ordered }}</td>
              <td class="mono" :title="item.cell.error">{{ item.cell.value }}</td>
              <td v-if="index === 0" :rowspan="row.cells.length">
                <n-button size="tiny" quaternary type="error" @click="removeRule(row.rule.id)">
                  {{ t("modbus.parser.remove") }}
                </n-button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-else class="empty-hint">{{ t("modbus.parser.empty") }}</p>
  </div>
</template>

<style scoped>
.rules-actions {
  margin-bottom: 8px;
}

.rules-shell {
  overflow-x: auto;
  border: 1px solid var(--et-border-color);
  background: var(--et-bg-surface);
}

.rules-table {
  width: 100%;
  min-width: 780px;
  border-collapse: collapse;
}

.rules-table th,
.rules-table td {
  padding: 6px 8px;
  border-right: 1px solid var(--et-border-color);
  border-bottom: 1px solid var(--et-border-color);
  text-align: left;
  vertical-align: middle;
  font-size: 12px;
}

.rules-table th:last-child,
.rules-table td:last-child {
  border-right: 0;
}

.rules-table tbody tr:last-child td {
  border-bottom: 0;
}

.rules-table thead th {
  background: var(--et-bg-base);
  font-weight: 600;
}

.offset-column,
.type-column {
  width: 108px;
}

.bytes-column {
  width: 160px;
}

.order-column {
  width: 84px;
}

.action-column {
  width: 76px;
}

.offset-input,
.type-select {
  width: 100%;
}

.mono {
  font-family: Consolas, "Cascadia Mono", monospace;
}

.raw-cell {
  color: var(--et-text-secondary);
  word-break: break-all;
}

.order-cell {
  color: var(--et-text-secondary);
}

.empty-hint {
  margin: 0;
  padding: 10px;
  border: 1px dashed var(--et-border-color);
  font-size: 12px;
  color: var(--et-text-muted);
}
</style>
