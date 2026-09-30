<script setup lang="ts">
import { NButton, NInput, NRadioButton, NRadioGroup, NSelect, useMessage } from "naive-ui";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { DATA_TYPES } from "@/modules/converter/core/data-types";
import type { DataTypeId } from "@/modules/converter/core/data-types";
import type { LayoutId } from "@/modules/converter/core/byte-order";
import { hasHexDigits, hex2, hexToBytes, pad } from "@/modules/protocol/core/bytes";
import { FUNCTIONS } from "@/modules/protocol/core/functions";
import {
  buildResponsePdu,
  parseNumberInput,
  responseFieldPlan,
} from "@/modules/protocol/core/frame-builder";
import type { NumberFormat, ResponseSpec } from "@/modules/protocol/core/frame-builder";
import { layoutsForDataType } from "@/modules/protocol/core/parse-rules";
import type { ProtocolAdapter } from "@/modules/protocol/core/protocols";
import type {
  ErrorCode,
  FrameLine,
  FrameParseValue,
  ProtocolResult,
} from "@/modules/protocol/core/types";
import ParseRuleTable from "@/modules/protocol/components/ParseRuleTable.vue";

const props = defineProps<{ protocol: ProtocolAdapter }>();

const { t } = useI18n();
const message = useMessage();

/** 生成结果：文本 + 说明行 + 可选错误。 */
interface Generated {
  text: string;
  lines: FrameLine[];
  error: string | null;
}

const emptyGenerated: Generated = { text: "", lines: [], error: null };

function firstError(results: ProtocolResult<number>[]): ErrorCode | null {
  for (const result of results) {
    if (!result.ok) return result.error.code;
  }
  return null;
}

const readNumber = (result: ProtocolResult<number>): number => (result.ok ? result.value : 0);

/* ---------- 进制切换 ---------- */

function convertField(value: string, from: NumberFormat, to: NumberFormat, width: 1 | 2): string {
  if (from === to) return value;
  const parsed = parseNumberInput(value, from, width);
  if (!parsed.ok) return value;
  return to === "hex" ? pad(parsed.value, width * 2, 16) : String(parsed.value);
}

/* ---------- ① 请求生成器 ---------- */

const requestFormat = ref<NumberFormat>("hex");
const requestUnit = ref("01");
const requestFunction = ref<number | "custom">(0x03);
const requestCustomFunction = ref("05");
const requestAddress = ref("0000");
const requestQuantity = ref("0001");
const requestTransactionId = ref("0001");

function switchRequestFormat(next: NumberFormat): void {
  const from = requestFormat.value;
  requestUnit.value = convertField(requestUnit.value, from, next, 1);
  requestAddress.value = convertField(requestAddress.value, from, next, 2);
  requestQuantity.value = convertField(requestQuantity.value, from, next, 2);
  requestTransactionId.value = convertField(requestTransactionId.value, from, next, 2);
  requestFormat.value = next;
}

const requestFunctionCode = computed(() =>
  requestFunction.value === "custom"
    ? readNumber(parseNumberInput(requestCustomFunction.value, "hex", 1))
    : requestFunction.value,
);

const requestResult = computed<Generated>(() => {
  const results = [
    parseNumberInput(requestUnit.value, requestFormat.value, 1),
    parseNumberInput(requestAddress.value, requestFormat.value, 2),
    parseNumberInput(requestQuantity.value, requestFormat.value, 2),
    parseNumberInput(requestTransactionId.value, requestFormat.value, 2),
  ];
  const code = firstError(results);
  if (code) return { ...emptyGenerated, error: t(`modbus.errors.${code}`) };

  const built = props.protocol.buildRequest({
    unit: readNumber(results[0] as ProtocolResult<number>),
    func: requestFunctionCode.value,
    addr: readNumber(results[1] as ProtocolResult<number>),
    qty: readNumber(results[2] as ProtocolResult<number>),
    tid: readNumber(results[3] as ProtocolResult<number>),
  });
  return { text: built.text, lines: built.lines, error: null };
});

/* ---------- ② 响应生成器 ---------- */

const responseFormat = ref<NumberFormat>("hex");
const responseUnit = ref("01");
const responseFunction = ref<number | "custom">(0x03);
const responseCustomFunction = ref("05");
const responseAddress = ref("0000");
const responseQuantity = ref("0001");
const responseValues = ref("0");
const responseData = ref("00 00");
const responseTransactionId = ref("0001");
const responseDataType = ref<DataTypeId>("uint16");
const responseLayout = ref<LayoutId>("abcd");

function switchResponseFormat(next: NumberFormat): void {
  const from = responseFormat.value;
  responseUnit.value = convertField(responseUnit.value, from, next, 1);
  responseAddress.value = convertField(responseAddress.value, from, next, 2);
  responseQuantity.value = convertField(responseQuantity.value, from, next, 2);
  responseTransactionId.value = convertField(responseTransactionId.value, from, next, 2);
  responseFormat.value = next;
}

const responseFunctionCode = computed(() =>
  responseFunction.value === "custom"
    ? readNumber(parseNumberInput(responseCustomFunction.value, "hex", 1))
    : responseFunction.value,
);

const isCustomFunction = computed(() => responseFunction.value === "custom");

const responsePlan = computed(() =>
  responseFieldPlan(responseFunctionCode.value, isCustomFunction.value),
);

const layoutOptions = computed(() =>
  layoutsForDataType(responseDataType.value).map((layout) => ({
    label: layout.label,
    value: layout.id,
  })),
);

watch(responseDataType, () => {
  if (!layoutOptions.value.some((option) => option.value === responseLayout.value)) {
    responseLayout.value = "abcd";
  }
});

const responseResult = computed<Generated>(() => {
  const results = [
    parseNumberInput(responseUnit.value, responseFormat.value, 1),
    parseNumberInput(responseAddress.value, responseFormat.value, 2),
    parseNumberInput(responseQuantity.value, responseFormat.value, 2),
    parseNumberInput(responseTransactionId.value, responseFormat.value, 2),
  ];
  const code = firstError(results);
  if (code) return { ...emptyGenerated, error: t(`modbus.errors.${code}`) };

  const spec: ResponseSpec = {
    custom: isCustomFunction.value,
    func: responseFunctionCode.value,
    addr: readNumber(results[1] as ProtocolResult<number>),
    qty: readNumber(results[2] as ProtocolResult<number>),
    format: responseFormat.value,
    values: responseValues.value,
    data: responseData.value,
    dataType: responseDataType.value,
    layout: responseLayout.value,
  };

  const pdu = buildResponsePdu(spec);
  if (!pdu.ok) return { ...emptyGenerated, error: t(`modbus.errors.${pdu.error.code}`) };

  const built = props.protocol.buildResponse(
    {
      unit: readNumber(results[0] as ProtocolResult<number>),
      tid: readNumber(results[3] as ProtocolResult<number>),
    },
    pdu.value.pdu,
    pdu.value.kind,
  );
  return { text: built.text, lines: built.lines, error: null };
});

/* ---------- ③ 报文解析器 ---------- */

const parseInput = ref(props.protocol.sample);
const parseResult = ref<ProtocolResult<FrameParseValue> | null>(null);
const parseHint = ref("");

const ruleTable = ref<InstanceType<typeof ParseRuleTable> | null>(null);

const dataRegion = computed(() => (parseResult.value?.ok ? parseResult.value.value.data : null));

function runParse(): void {
  if (!hasHexDigits(parseInput.value)) {
    parseResult.value = null;
    parseHint.value = t("modbus.parser.noInput");
    return;
  }
  parseHint.value = "";
  const bytes = hexToBytes(parseInput.value);
  if (!bytes.ok) {
    parseResult.value = { ok: false, error: bytes.error };
    return;
  }
  parseResult.value = props.protocol.parse(bytes.value);
}

function clearParser(): void {
  parseInput.value = "";
  parseResult.value = null;
  parseHint.value = "";
  ruleTable.value?.clear();
}

function useSample(): void {
  parseInput.value = props.protocol.sample;
  runParse();
}

const parseLines = computed<FrameLine[]>(() =>
  parseResult.value?.ok ? parseResult.value.value.lines : [],
);

const parseOutcome = computed<string | null>(() => {
  const result = parseResult.value;
  const checksum = props.protocol.checksum;
  if (!result?.ok || !checksum) return null;
  const pass = result.value.warning === undefined;
  const stem = checksum === "crc16" ? (pass ? "crcPass" : "crcFail") : pass ? "lrcPass" : "lrcFail";
  return t(`modbus.outcomes.${stem}`);
});

/* ---------- ④ 校验计算器 ---------- */

const checksumInput = ref("01 03 00 00 00 02");

const checksumOutput = computed(() => {
  if (!props.protocol.checksum) return "";
  if (!hasHexDigits(checksumInput.value)) return "";
  const bytes = hexToBytes(checksumInput.value);
  if (!bytes.ok) return t(`modbus.errors.${bytes.error.code}`);
  return props.protocol.checksumText(bytes.value);
});

/* ---------- 选项与工具 ---------- */

const functionOptions = computed(() => [
  ...FUNCTIONS.map((item) => ({
    label: `${hex2(item.code)} · ${t(`modbus.functions.${item.key}`)}`,
    value: item.code as number | "custom",
  })),
  { label: t("modbus.functionCustom"), value: "custom" as number | "custom" },
]);

const dataTypeOptions = computed(() =>
  DATA_TYPES.map((item) => ({ label: item.label, value: item.id })),
);

function lineLabel(key: string): string {
  return t(`modbus.frameLines.${key}`);
}

function errorText(code: ErrorCode): string {
  return t(`modbus.errors.${code}`);
}

async function copyValue(value: string): Promise<void> {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    message.success(t("modbus.copied"));
  } catch {
    message.error(t("modbus.copyFailed"));
  }
}

onMounted(runParse);
</script>

<template>
  <div class="frame-tool">
    <!-- ① 请求命令生成器 -->
    <section class="card">
      <h2 class="card-title">{{ t("modbus.sections.request") }}</h2>

      <div class="mode-row">
        <n-radio-group
          :value="requestFormat"
          size="small"
          @update:value="switchRequestFormat($event as NumberFormat)"
        >
          <n-radio-button value="hex">{{ t("modbus.mode.hex") }}</n-radio-button>
          <n-radio-button value="dec">{{ t("modbus.mode.dec") }}</n-radio-button>
        </n-radio-group>
      </div>

      <div class="field-grid">
        <div class="field">
          <label class="field-label">{{ t("modbus.fields.slaveAddress") }}</label>
          <n-input v-model:value="requestUnit" size="small" class="mono" />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.fields.function") }}</label>
          <n-select v-model:value="requestFunction" size="small" :options="functionOptions" />
          <n-input
            v-if="requestFunction === 'custom'"
            v-model:value="requestCustomFunction"
            size="small"
            class="mono custom-func"
            :placeholder="t('modbus.functionCustomPlaceholder')"
          />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.fields.startAddress") }}</label>
          <n-input v-model:value="requestAddress" size="small" class="mono" />
        </div>
        <div v-if="protocol.hasTransactionId" class="field">
          <label class="field-label">{{ t("modbus.fields.transactionId") }}</label>
          <n-input v-model:value="requestTransactionId" size="small" class="mono" />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.fields.quantity") }}</label>
          <n-input v-model:value="requestQuantity" size="small" class="mono" />
        </div>
      </div>

      <div class="out-row">
        <n-input :value="requestResult.text" readonly size="small" class="mono out-input" />
        <n-button size="small" type="primary" @click="copyValue(requestResult.text)">
          {{ t("modbus.copy") }}
        </n-button>
      </div>
      <div v-if="requestResult.error" class="error-text">
        {{ t("modbus.generateFailed") }}：{{ requestResult.error }}
      </div>
      <div v-else class="result-block">
        <div v-for="(line, index) in requestResult.lines" :key="index" class="result-line">
          <span v-if="line.value">{{ lineLabel(line.key) }}：{{ line.value }}</span>
          <span v-else class="result-heading">{{ lineLabel(line.key) }}</span>
        </div>
      </div>
    </section>

    <!-- ② 响应报文生成器 -->
    <section class="card">
      <h2 class="card-title">{{ t("modbus.sections.response") }}</h2>

      <div class="mode-row">
        <n-radio-group
          :value="responseFormat"
          size="small"
          @update:value="switchResponseFormat($event as NumberFormat)"
        >
          <n-radio-button value="hex">{{ t("modbus.mode.hex") }}</n-radio-button>
          <n-radio-button value="dec">{{ t("modbus.mode.dec") }}</n-radio-button>
        </n-radio-group>
      </div>

      <div class="field-grid">
        <div v-if="protocol.hasTransactionId" class="field">
          <label class="field-label">{{ t("modbus.fields.transactionId") }}</label>
          <n-input v-model:value="responseTransactionId" size="small" class="mono" />
        </div>
        <div class="field">
          <label class="field-label">
            {{
              protocol.hasTransactionId
                ? t("modbus.fields.unitId")
                : t("modbus.fields.slaveAddress")
            }}
          </label>
          <n-input v-model:value="responseUnit" size="small" class="mono" />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.fields.function") }}</label>
          <n-select v-model:value="responseFunction" size="small" :options="functionOptions" />
          <n-input
            v-if="isCustomFunction"
            v-model:value="responseCustomFunction"
            size="small"
            class="mono custom-func"
            :placeholder="t('modbus.functionCustomPlaceholder')"
          />
        </div>
        <div v-if="responsePlan.show.addr" class="field">
          <label class="field-label">{{ t("modbus.fields.startAddress") }}</label>
          <n-input v-model:value="responseAddress" size="small" class="mono" />
        </div>
        <div v-if="responsePlan.show.qty" class="field">
          <label class="field-label">{{
            t(`modbus.responseLabels.${responsePlan.qtyLabel}`)
          }}</label>
          <n-input v-model:value="responseQuantity" size="small" class="mono" />
        </div>
        <div v-if="responsePlan.show.type" class="field">
          <label class="field-label">{{ t("modbus.fields.dataType") }}</label>
          <n-select v-model:value="responseDataType" size="small" :options="dataTypeOptions" />
        </div>
        <div v-if="responsePlan.show.order" class="field">
          <label class="field-label">{{ t("modbus.fields.byteOrder") }}</label>
          <n-select v-model:value="responseLayout" size="small" :options="layoutOptions" />
        </div>
        <div v-if="responsePlan.show.values" class="field span-2">
          <label class="field-label">{{
            t(`modbus.responseLabels.${responsePlan.valuesLabel}`)
          }}</label>
          <n-input v-model:value="responseValues" size="small" class="mono" />
        </div>
        <div v-if="responsePlan.show.data" class="field span-2">
          <label class="field-label">{{ t("modbus.fields.dataRegion") }}</label>
          <n-input v-model:value="responseData" size="small" class="mono" />
        </div>
      </div>

      <div class="out-row">
        <n-input :value="responseResult.text" readonly size="small" class="mono out-input" />
        <n-button size="small" type="primary" @click="copyValue(responseResult.text)">
          {{ t("modbus.copy") }}
        </n-button>
      </div>
      <div v-if="responseResult.error" class="error-text">
        {{ t("modbus.generateFailed") }}：{{ responseResult.error }}
      </div>
      <div v-else class="result-block">
        <div v-for="(line, index) in responseResult.lines" :key="index" class="result-line">
          <span v-if="line.value">{{ lineLabel(line.key) }}：{{ line.value }}</span>
          <span v-else class="result-heading">{{ lineLabel(line.key) }}</span>
        </div>
      </div>
    </section>

    <!-- ③ 报文解析器 -->
    <section class="card">
      <h2 class="card-title">{{ t("modbus.sections.parser") }}</h2>

      <label class="field-label">{{ t("modbus.fields.parserInput") }}</label>
      <n-input
        v-model:value="parseInput"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 5 }"
        class="mono"
        spellcheck="false"
      />

      <div class="button-row">
        <n-button size="small" type="primary" @click="runParse">
          {{ t("modbus.parser.parse") }}
        </n-button>
        <n-button size="small" @click="clearParser">{{ t("modbus.parser.clear") }}</n-button>
        <n-button size="small" @click="useSample">{{ t("modbus.parser.demo") }}</n-button>
      </div>

      <div class="result-block">
        <p v-if="parseHint" class="hint-text">{{ parseHint }}</p>
        <template v-else-if="parseResult">
          <div v-if="parseResult.ok" class="result-lines">
            <div v-for="(line, index) in parseLines" :key="index" class="result-line">
              <span v-if="line.value">{{ lineLabel(line.key) }}：{{ line.value }}</span>
              <span v-else class="result-heading">{{ lineLabel(line.key) }}</span>
            </div>
            <div v-if="parseOutcome" class="outcome">{{ parseOutcome }}</div>
            <div v-if="parseResult.value.warning" class="warning-text">
              {{ t(`modbus.warnings.${parseResult.value.warning.code}`) }}
            </div>
          </div>
          <div v-else class="error-text">{{ errorText(parseResult.error.code) }}</div>
        </template>
      </div>

      <h3 class="sub-title">{{ t("modbus.parser.rules") }}</h3>
      <ParseRuleTable ref="ruleTable" :data="dataRegion" />
    </section>

    <!-- ④ 校验计算器 -->
    <section v-if="protocol.checksum" class="card">
      <h2 class="card-title">{{ t(`modbus.checksumTitle.${protocol.checksum}`) }}</h2>
      <label class="field-label">{{ t("modbus.fields.checksumInput") }}</label>
      <n-input v-model:value="checksumInput" size="small" class="mono" />
      <div class="out-row">
        <span class="checksum-label">{{ protocol.checksum === "crc16" ? "CRC" : "LRC" }}</span>
        <n-input :value="checksumOutput" readonly size="small" class="mono out-input" />
        <n-button size="small" type="primary" @click="copyValue(checksumOutput)">
          {{ t("modbus.copy") }}
        </n-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.frame-tool {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card {
  padding: 14px;
  background: var(--et-bg-surface);
  border: 1px solid var(--et-border-color);
}

.card-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
}

.sub-title {
  margin: 18px 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.mode-row {
  margin-bottom: 10px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field.span-2 {
  grid-column: 1 / -1;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--et-text-secondary);
}

.custom-func {
  margin-top: 6px;
}

.mono {
  font-family: Consolas, "Cascadia Mono", monospace;
}

.out-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.out-input {
  flex: 1;
}

.checksum-label {
  min-width: 42px;
  font-size: 12px;
  color: var(--et-text-secondary);
}

.button-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.result-block {
  margin-top: 10px;
  padding: 9px 10px;
  background: var(--et-bg-elevated);
  border: 1px solid var(--et-border-color);
  font-size: 12px;
  line-height: 1.7;
}

.result-line {
  font-family: Consolas, "Cascadia Mono", monospace;
  word-break: break-all;
}

.result-heading {
  font-weight: 600;
}

.outcome {
  margin-top: 4px;
  color: var(--et-accent);
}

.warning-text {
  margin-top: 4px;
  color: var(--et-danger);
}

.error-text {
  margin-top: 8px;
  font-size: 12px;
  color: var(--et-danger);
}

.hint-text {
  margin: 0;
  color: var(--et-text-muted);
}
</style>
