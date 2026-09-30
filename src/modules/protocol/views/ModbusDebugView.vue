<script setup lang="ts">
import {
  NButton,
  NCheckbox,
  NInput,
  NInputNumber,
  NRadio,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NTag,
  useMessage,
} from "naive-ui";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { bytesToHex, hex2, hexToBytes } from "@/modules/protocol/core/bytes";
import { DebugSession, expectedRtuResponseLength } from "@/modules/protocol/core/debug-session";
import type { ReceivedFrame } from "@/modules/protocol/core/debug-session";
import {
  FUNCTIONS,
  isExceptionFunction,
  isReadFunction,
  isWriteMultiple,
  writeMultipleByteCount,
} from "@/modules/protocol/core/functions";
import { parseNumberInput } from "@/modules/protocol/core/frame-builder";
import type { DataRegion } from "@/modules/protocol/core/parse-rules";
import { PROTOCOLS, PROTOCOL_IDS, toWireBytes } from "@/modules/protocol/core/protocols";
import type { ProtocolId } from "@/modules/protocol/core/protocols";
import type {
  BuiltFrame,
  ErrorCode,
  ProtocolResult,
  RequestFields,
} from "@/modules/protocol/core/types";
import ParseRuleTable from "@/modules/protocol/components/ParseRuleTable.vue";
import { ConnectionService } from "@/services/native/connection-service";
import type { OpenedConnection, ReceivedChunk } from "@/services/native/connection-service";
import type { SerialParity, SerialPortInfo } from "@/shared/types/connection";

const { t } = useI18n();
const message = useMessage();

/** 各容量上限：长连接与长时间轮询都不能无限增长。 */
const MAX_LOG_ENTRIES = 500;
/** 轮询模式下每 N 次才写一条通信日志，避免刷屏。 */
const LOOP_LOG_EVERY = 20;

type LinkKind = "serial" | "tcp";
type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected";

interface LogEntry {
  id: number;
  time: string;
  direction: "tx" | "rx" | "info";
  text: string;
  detail: string;
  warning: boolean;
}

/* ---------- 连接配置 ---------- */

const protocol = ref<ProtocolId>("rtu");
const linkKind = ref<LinkKind>("serial");
const status = ref<ConnectionStatus>("idle");

const ports = ref<SerialPortInfo[]>([]);
const portName = ref("");
const baudRate = ref(9600);
const dataBits = ref(8);
const stopBits = ref(1);
const parity = ref<SerialParity>("none");
const readTimeoutMs = ref(200);

const host = ref("127.0.0.1");
const tcpPort = ref(502);
const connectTimeoutMs = ref(3000);
const writeTimeoutMs = ref(1000);

let connection: OpenedConnection | null = null;
let session: DebugSession | null = null;
let timeoutTimer: number | null = null;

const desktopAvailable = ConnectionService.isAvailable();
const isConnected = computed(() => status.value === "connected");
const busy = computed(() => status.value === "connecting");

/**
 * 协议决定传输方式：Modbus TCP 用 TCP，RTU / ASCII 用串口。
 * 自动跟随可以让用户切换协议后就看到对应的连接配置；链路开关
 * 仍可手动改（此时不会被回拉），用于 RTU over TCP 这类组合。
 */
watch(protocol, (id) => {
  linkKind.value = id === "tcp" ? "tcp" : "serial";
});

const portOptions = computed(() =>
  ports.value.map((port) => ({
    label: `${port.portName} · ${t(`modbus.debug.portTypes.${port.portType}`)}`,
    value: port.portName,
  })),
);

const parityOptions = computed(() =>
  (["none", "odd", "even"] as const).map((value) => ({
    label: t(`modbus.debug.parity.${value}`),
    value,
  })),
);

const dataBitOptions = [5, 6, 7, 8].map((value) => ({ label: String(value), value }));
const stopBitOptions = [1, 2].map((value) => ({ label: String(value), value }));

async function refreshPorts(): Promise<void> {
  if (!desktopAvailable) return;
  try {
    ports.value = await ConnectionService.listSerialPorts();
    if (!portName.value && ports.value[0]) portName.value = ports.value[0].portName;
  } catch (error: unknown) {
    message.error(errorText(error));
  }
}

/* ---------- 通信日志 ---------- */

const logs = ref<LogEntry[]>([]);
const bufferedText = ref("");
const latest = ref<ReceivedFrame | null>(null);
let logSequence = 0;

function appendLog(entry: Omit<LogEntry, "id" | "time">): void {
  logs.value.push({
    id: ++logSequence,
    time: new Date().toLocaleTimeString(undefined, { hour12: false }),
    ...entry,
  });
  if (logs.value.length > MAX_LOG_ENTRIES) {
    logs.value.splice(0, logs.value.length - MAX_LOG_ENTRIES);
  }
}

function clearLog(): void {
  logs.value = [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSummary(frame: ReceivedFrame): string {
  if (!frame.parsed.ok) return t(`modbus.errors.${frame.parsed.error.code as ErrorCode}`);
  const value = frame.parsed.value;
  return `${t("modbus.frameLines.function")} ${hex2(value.func)} · ${bytesToHex(value.data)}`;
}

/** TX 日志详情只列关键字段：左侧已有完整 HEX，不再重复整帧。 */
const TX_SUMMARY_KEYS = new Set(["transactionId", "function", "startAddress", "quantity"]);

function requestSummary(built: BuiltFrame): string {
  return built.lines
    .filter((line) => TX_SUMMARY_KEYS.has(line.key))
    .map((line) => `${lineLabel(line.key)} ${line.value}`)
    .join(" · ");
}

function frameHasChecksumWarning(frame: ReceivedFrame): boolean {
  if (!frame.parsed.ok) return false;
  const code = frame.parsed.value.warning?.code;
  return code === "crcMismatch" || code === "lrcMismatch";
}

/** 循环模式下的日志节流：每 `LOOP_LOG_EVERY` 条才记一次。 */
const loopTxCount = ref(0);
const loopRxCount = ref(0);

/**
 * 错误帧（解析失败 / 校验告警 / 异常响应 / 未匹配）只进日志，不更新解析数据；
 * 只有匹配成功且校验无误的读响应才写入对应帧的区域。
 */
function handleFrame(frame: ReceivedFrame): void {
  const warning = frameHasChecksumWarning(frame);
  if (warning) stats.crc += 1;

  const loopMode = pollEnabled.value;
  if (loopMode) {
    loopRxCount.value += 1;
    if (loopRxCount.value % LOOP_LOG_EVERY === 0) {
      appendLog({
        direction: "rx",
        text: bytesToHex(frame.bytes),
        detail: parseSummary(frame),
        warning,
      });
    }
  } else {
    appendLog({
      direction: "rx",
      text: bytesToHex(frame.bytes),
      detail: parseSummary(frame),
      warning,
    });
  }

  if (frame.matched) clearRequestTimer();

  if (frame.parsed.ok && !warning) latest.value = frame;
  if (frame.matched && frame.parsed.ok) {
    const value = frame.parsed.value;
    if (isExceptionFunction(value.func)) {
      // 异常响应是被从站明确拒绝的有效应答：单独计数，不算成功，也不产生数据区域。
      stats.exception += 1;
    } else if (!warning) {
      stats.ok += 1;
      recordRegion(pendingFrameId, frame.matched.addr, frame.matched.func, value.data);
    }
  }
  if (frame.matched) {
    pendingFrameId = null;
    settleRequest();
  }
}

/** 记录某帧本次响应的数据区域；其它帧的区域保持不变。 */
function recordRegion(
  frameId: number | null,
  baseAddr: number,
  func: number,
  data: Uint8Array,
): void {
  if (frameId === null || !isReadFunction(func)) return;
  regions.value = { ...regions.value, [frameId]: { baseAddr, func, data } };
}

function handleData(chunk: ReceivedChunk): void {
  if (!session) return;
  const frames = session.feed(chunk.data, chunk.readAtMs);
  bufferedText.value = bytesToHex(session.getBuffered());
  for (const frame of frames) handleFrame(frame);
}

/* ---------- 统计 ---------- */

const stats = reactive({ sent: 0, ok: 0, exception: 0, timeout: 0, skipped: 0, crc: 0 });

function resetStats(): void {
  stats.sent = 0;
  stats.ok = 0;
  stats.exception = 0;
  stats.timeout = 0;
  stats.skipped = 0;
  stats.crc = 0;
}

/* ---------- 连接开关 ---------- */

function clearRequestTimer(): void {
  if (timeoutTimer !== null) {
    window.clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
}

async function connect(): Promise<void> {
  if (!desktopAvailable || busy.value) return;

  if (linkKind.value === "serial" && !portName.value) {
    message.warning(t("modbus.debug.portRequired"));
    return;
  }

  status.value = "connecting";
  session = new DebugSession(protocol.value);
  logs.value = [];
  bufferedText.value = "";
  latest.value = null;
  regions.value = {};
  pendingFrameId = null;
  resetStats();

  const config =
    linkKind.value === "serial"
      ? {
          kind: "serial" as const,
          portName: portName.value,
          baudRate: baudRate.value,
          dataBits: dataBits.value,
          stopBits: stopBits.value,
          parity: parity.value,
          readTimeoutMs: readTimeoutMs.value,
        }
      : {
          kind: "tcp" as const,
          host: host.value,
          port: tcpPort.value,
          connectTimeoutMs: connectTimeoutMs.value,
          readTimeoutMs: readTimeoutMs.value,
          writeTimeoutMs: writeTimeoutMs.value,
        };

  try {
    const opened = await ConnectionService.open(config, {
      onData: handleData,
      onError: (error) => {
        appendLog({
          direction: "info",
          text: t("modbus.debug.nativeError", { message: error.message }),
          detail: "",
          warning: true,
        });
      },
      onClosed: (reason) => {
        appendLog({
          direction: "info",
          text: t("modbus.debug.closed", { reason: t(`modbus.debug.closeReasons.${reason}`) }),
          detail: "",
          warning: false,
        });
        void disconnect(false);
      },
    });
    // 等待建立期间连接可能已被关闭（对端立即断开、用户取消、onClosed 先行触发）：
    // 状态不再是 connecting 时立即释放新连接，避免状态错乱与句柄泄漏。
    if (status.value !== "connecting") {
      await opened.close().catch(() => undefined);
      return;
    }
    connection = opened;
    status.value = "connected";
    appendLog({
      direction: "info",
      text: t("modbus.debug.opened", { protocol: t(`modbus.tabs.${protocol.value}`) }),
      detail: "",
      warning: false,
    });
  } catch (error: unknown) {
    status.value = "disconnected";
    session = null;
    message.error(t("modbus.debug.openFailed", { message: errorText(error) }));
  }
}

async function disconnect(byUser = true): Promise<void> {
  stopPolling();
  clearRequestTimer();
  const current = connection;
  connection = null;
  session = null;
  pendingFrameId = null;
  bufferedText.value = "";
  if (current) {
    try {
      await current.close();
    } catch (error: unknown) {
      if (byUser) message.error(errorText(error));
    }
  }
  status.value = "disconnected";
}

/* ---------- 轮询帧列表 ---------- */

interface PollFrame {
  id: number;
  /** 顺序轮询时是否参与。 */
  enabled: boolean;
  unit: string;
  funcSelect: number | "custom";
  customFunc: string;
  addr: string;
  qty: string;
  transactionId: string;
  /** 写多点（0x0F / 0x10）的数据区域，HEX 输入。 */
  writeData: string;
}

const frames = reactive<PollFrame[]>([]);
const timeoutMs = ref(1000);
let frameSequence = 0;

const functionOptions = computed(() => [
  ...FUNCTIONS.map((item) => ({
    label: `${hex2(item.code)} · ${t(`modbus.functions.${item.key}`)}`,
    value: item.code as number | "custom",
  })),
  { label: t("modbus.functionCustom"), value: "custom" as number | "custom" },
]);

function addFrame(): void {
  const frame: PollFrame = {
    id: ++frameSequence,
    enabled: true,
    unit: "01",
    funcSelect: 0x04,
    customFunc: "03",
    addr: "0000",
    qty: "0001",
    transactionId: "0001",
    writeData: "",
  };
  frames.push(frame);
  if (selectedFrameId.value === null) selectedFrameId.value = frame.id;
}

function removeFrame(id: number): void {
  const index = frames.findIndex((frame) => frame.id === id);
  if (index < 0) return;
  frames.splice(index, 1);
  delete regions.value[id];
  if (selectedFrameId.value === id) selectedFrameId.value = frames[0]?.id ?? null;
}

/** 行内功能码；自定义输入非法时按 0 处理，仅用于判断是否显示写数据列。 */
function frameFunc(frame: PollFrame): number {
  if (frame.funcSelect !== "custom") return frame.funcSelect;
  const parsed = parseNumberInput(frame.customFunc, "hex", 1);
  return parsed.ok ? parsed.value : 0;
}

function frameShowsWriteData(frame: PollFrame): boolean {
  return isWriteMultiple(frameFunc(frame));
}

const writeDataPlaceholder = computed(() => t("modbus.debug.writeDataPlaceholder"));

/** 把一行帧解析为请求字段；任一字段非法都返回结构化错误。 */
function frameFields(frame: PollFrame): ProtocolResult<RequestFields> {
  const unit = parseNumberInput(frame.unit, "hex", 1);
  if (!unit.ok) return unit;
  const addr = parseNumberInput(frame.addr, "hex", 2);
  if (!addr.ok) return addr;
  const qty = parseNumberInput(frame.qty, "hex", 2);
  if (!qty.ok) return qty;
  const tid = parseNumberInput(frame.transactionId, "hex", 2);
  if (!tid.ok) return tid;
  const func =
    frame.funcSelect === "custom"
      ? parseNumberInput(frame.customFunc, "hex", 1)
      : { ok: true as const, value: frame.funcSelect };
  if (!func.ok) return func;

  // 写多点时必须给出与数量匹配的数据区域
  let data: number[] | undefined;
  if (isWriteMultiple(func.value)) {
    const parsedData = hexToBytes(frame.writeData);
    if (!parsedData.ok) return parsedData;
    if (parsedData.value.length !== writeMultipleByteCount(func.value, qty.value)) {
      return { ok: false, error: { code: "invalidValue", detail: "writeData" } };
    }
    data = Array.from(parsedData.value);
  }

  return {
    ok: true,
    value: {
      unit: unit.value,
      func: func.value,
      addr: addr.value,
      qty: qty.value,
      tid: tid.value,
      data,
    },
  };
}

function frameText(frame: PollFrame): string {
  const fields = frameFields(frame);
  return fields.ok ? PROTOCOLS[protocol.value].buildRequest(fields.value).text : "";
}

function frameError(frame: PollFrame): string {
  const fields = frameFields(frame);
  return fields.ok ? "" : t(`modbus.errors.${fields.error.code as ErrorCode}`);
}

/**
 * 发送一行帧。
 *
 * 轮询与手工发送共用此函数：`loop` 为真时不弹提示、日志节流。
 * 同一时刻只允许一个在途请求，进行中的请求会被跳过并计数。
 */
async function sendFrame(frame: PollFrame, loop: boolean): Promise<boolean> {
  const current = connection;
  if (!current || !session) {
    if (!loop) message.warning(t("modbus.debug.notConnected"));
    return false;
  }

  const fields = frameFields(frame);
  if (!fields.ok) {
    if (!loop) message.error(t(`modbus.errors.${fields.error.code as ErrorCode}`));
    return false;
  }

  const pending = {
    unit: fields.value.unit,
    func: fields.value.func,
    addr: fields.value.addr,
    qty: fields.value.qty,
    tid: PROTOCOLS[protocol.value].hasTransactionId ? fields.value.tid : null,
    sentAtMs: performance.now(),
    expectedLength: null as number | null,
  };
  if (protocol.value === "rtu") pending.expectedLength = expectedRtuResponseLength(pending);

  if (!session.registerRequest(pending).ok) {
    stats.skipped += 1;
    if (!loop) message.warning(t("modbus.debug.requestInFlight"));
    return false;
  }
  // 写之前就记下所属行：极快的响应可能在 await 期间到达。
  pendingFrameId = frame.id;

  // 用本次构造的报文做摘要：await 期间输入可能被修改，界面上的文本会失真。
  const built = PROTOCOLS[protocol.value].buildRequest(fields.value);
  const wire = toWireBytes(protocol.value, built);
  const summary = requestSummary(built);

  try {
    await current.write(wire);
  } catch (error: unknown) {
    session.cancelRequest();
    pendingFrameId = null;
    message.error(t("modbus.debug.writeFailed", { message: errorText(error) }));
    if (loop) stopPolling();
    return false;
  }

  stats.sent += 1;
  if (loop) {
    loopTxCount.value += 1;
    if (loopTxCount.value % LOOP_LOG_EVERY === 0) {
      appendLog({ direction: "tx", text: bytesToHex(wire), detail: summary, warning: false });
    }
  } else {
    appendLog({ direction: "tx", text: bytesToHex(wire), detail: summary, warning: false });
  }

  clearRequestTimer();
  timeoutTimer = window.setTimeout(() => {
    timeoutTimer = null;
    if (session?.expire(performance.now(), timeoutMs.value)) {
      stats.timeout += 1;
      pendingFrameId = null;
      appendLog({
        direction: "info",
        text: t("modbus.debug.timeout", { ms: String(timeoutMs.value) }),
        detail: "",
        warning: true,
      });
      settleRequest();
    }
  }, timeoutMs.value);
  return true;
}

/* ---------- 轮询 ---------- */

const pollEnabled = ref(false);
const pollIntervalMs = ref(1000);
const pollMode = ref<"single" | "sequential">("single");
/** 单独模式下轮询哪一行。 */
const selectedFrameId = ref<number | null>(null);
let pollTimer: number | null = null;
let pollCursor = 0;
/** 在途请求所属的帧行，用于把响应数据归属到对应区域。 */
let pendingFrameId: number | null = null;

/** 本次轮询要发送的帧：单独模式只发选中行，顺序模式按行序发全部启用行。 */
function pollTargets(): PollFrame[] {
  if (pollMode.value === "single") {
    const target = frames.find((frame) => frame.id === selectedFrameId.value);
    return target ? [target] : [];
  }
  return frames.filter((frame) => frame.enabled);
}

function startPolling(): void {
  if (!isConnected.value || pollEnabled.value) return;
  if (pollTargets().length === 0) {
    message.warning(t("modbus.debug.noPollFrames"));
    return;
  }
  pollEnabled.value = true;
  pollCursor = 0;
  void pollStep();
}

function stopPolling(): void {
  pollEnabled.value = false;
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/**
 * 顺序推进：一次只发一条，等匹配响应或超时后再发下一条，
 * 以维持「每连接一个在途请求」的约束。
 */
async function pollStep(): Promise<void> {
  if (!pollEnabled.value) return;
  const targets = pollTargets();
  if (targets.length === 0) {
    stopPolling();
    return;
  }
  if (pollCursor >= targets.length) pollCursor = 0;

  const sent = await sendFrame(targets[pollCursor]!, true);
  // 字段非法等原因没发出去、又没有在途请求时直接推进，避免轮询卡死。
  if (!sent && pollEnabled.value && !session?.getPending()) scheduleNextStep();
}

function scheduleNextStep(): void {
  if (!pollEnabled.value) return;
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(() => {
    pollTimer = null;
    pollCursor += 1;
    void pollStep();
  }, pollIntervalMs.value);
}

/** 一条请求结束（匹配响应或超时）后推进顺序轮询。 */
function settleRequest(): void {
  if (!pollEnabled.value) return;
  scheduleNextStep();
}

/* ---------- 按地址解析 ---------- */

/**
 * 每个轮询帧最近一次已匹配读响应的数据区域。
 * 按帧保留而不是只留最后一次，收到其它寄存器的响应也不会丢掉已有数值。
 */
const regions = ref<Record<number, DataRegion>>({});

const regionList = computed(() => Object.values(regions.value));

/* ---------- 其它 ---------- */

const responseLines = computed(() => {
  const frame = latest.value;
  return frame && frame.parsed.ok ? frame.parsed.value.lines : [];
});

function lineLabel(key: string): string {
  return t(`modbus.frameLines.${key}`);
}

onMounted(() => {
  void refreshPorts();
  if (frames.length === 0) addFrame();
});

onBeforeUnmount(() => {
  void disconnect(false);
});
</script>

<template>
  <div class="debug-view">
    <header class="page-header">
      <h1>{{ t("tools.modbusDebug") }}</h1>
      <p>{{ t("modbus.debug.introduction") }}</p>
    </header>

    <p v-if="!desktopAvailable" class="notice">{{ t("modbus.debug.desktopOnly") }}</p>

    <section class="card">
      <h2 class="card-title">{{ t("modbus.debug.connection") }}</h2>

      <div class="mode-row">
        <n-radio-group v-model:value="protocol" size="small" :disabled="isConnected || busy">
          <n-radio-button v-for="id in PROTOCOL_IDS" :key="id" :value="id">
            {{ t(`modbus.tabs.${id}`) }}
          </n-radio-button>
        </n-radio-group>

        <n-radio-group v-model:value="linkKind" size="small" :disabled="isConnected || busy">
          <n-radio-button value="serial">{{ t("modbus.debug.link.serial") }}</n-radio-button>
          <n-radio-button value="tcp">{{ t("modbus.debug.link.tcp") }}</n-radio-button>
        </n-radio-group>
      </div>

      <div v-if="linkKind === 'serial'" class="field-grid">
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.port") }}</label>
          <div class="port-row">
            <n-select
              v-model:value="portName"
              size="small"
              class="mono"
              :options="portOptions"
              :disabled="isConnected || busy"
              :placeholder="t('modbus.debug.noPorts')"
            />
            <n-button size="small" :disabled="isConnected || busy" @click="refreshPorts">
              {{ t("modbus.debug.refresh") }}
            </n-button>
          </div>
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.baudRate") }}</label>
          <n-input-number
            v-model:value="baudRate"
            size="small"
            :min="300"
            :show-button="false"
            :disabled="isConnected || busy"
          />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.dataBits") }}</label>
          <n-select
            v-model:value="dataBits"
            size="small"
            :options="dataBitOptions"
            :disabled="isConnected || busy"
          />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.stopBits") }}</label>
          <n-select
            v-model:value="stopBits"
            size="small"
            :options="stopBitOptions"
            :disabled="isConnected || busy"
          />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.parity.label") }}</label>
          <n-select
            v-model:value="parity"
            size="small"
            :options="parityOptions"
            :disabled="isConnected || busy"
          />
        </div>
      </div>

      <div v-else class="field-grid">
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.host") }}</label>
          <n-input v-model:value="host" size="small" class="mono" :disabled="isConnected || busy" />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.tcpPort") }}</label>
          <n-input-number
            v-model:value="tcpPort"
            size="small"
            :min="1"
            :max="65535"
            :show-button="false"
            :disabled="isConnected || busy"
          />
        </div>
      </div>

      <div class="field-grid">
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.readTimeout") }}</label>
          <n-input-number
            v-model:value="readTimeoutMs"
            size="small"
            :min="20"
            :show-button="false"
            :disabled="isConnected || busy"
          />
        </div>
        <div class="field">
          <label class="field-label">{{ t("modbus.debug.requestTimeout") }}</label>
          <n-input-number
            v-model:value="timeoutMs"
            size="small"
            :min="10"
            :show-button="false"
            :disabled="isConnected || busy"
          />
        </div>
      </div>

      <div class="button-row">
        <n-button
          v-if="!isConnected"
          size="small"
          type="primary"
          :loading="busy"
          :disabled="!desktopAvailable"
          @click="connect"
        >
          {{ t("modbus.debug.connect") }}
        </n-button>
        <n-button v-else size="small" @click="disconnect()">
          {{ t("modbus.debug.disconnect") }}
        </n-button>
        <n-tag
          size="small"
          :type="isConnected ? 'success' : busy ? 'warning' : 'default'"
          :bordered="false"
        >
          {{ t(`modbus.debug.status.${status}`) }}
        </n-tag>
      </div>
    </section>

    <section class="card">
      <div class="section-head">
        <h2 class="card-title">{{ t("modbus.debug.frames") }}</h2>
        <div class="section-actions">
          <n-button size="tiny" type="primary" @click="addFrame">
            {{ t("modbus.debug.addFrame") }}
          </n-button>
        </div>
      </div>

      <div v-if="frames.length" class="rules-shell">
        <table class="rules-table frames-table">
          <thead>
            <tr>
              <th class="pick-column">{{ t("modbus.debug.selected") }}</th>
              <th class="check-column">{{ t("modbus.debug.enabled") }}</th>
              <th>{{ t("modbus.fields.slaveAddress") }}</th>
              <th>{{ t("modbus.fields.function") }}</th>
              <th>{{ t("modbus.fields.startAddress") }}</th>
              <th>{{ t("modbus.fields.quantity") }}</th>
              <th>{{ t("modbus.fields.writeData") }}</th>
              <th v-if="PROTOCOLS[protocol].hasTransactionId">
                {{ t("modbus.fields.transactionId") }}
              </th>
              <th class="action-column">{{ t("modbus.parser.columns.actions") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="frame in frames" :key="frame.id">
              <td class="pick-column">
                <n-radio
                  :checked="selectedFrameId === frame.id"
                  size="small"
                  @change="selectedFrameId = frame.id"
                />
              </td>
              <td class="check-column">
                <n-checkbox v-model:checked="frame.enabled" size="small" />
              </td>
              <td>
                <n-input v-model:value="frame.unit" size="tiny" class="mono cell-input" />
              </td>
              <td>
                <n-select
                  v-model:value="frame.funcSelect"
                  size="tiny"
                  :options="functionOptions"
                  class="cell-input"
                />
                <n-input
                  v-if="frame.funcSelect === 'custom'"
                  v-model:value="frame.customFunc"
                  size="tiny"
                  class="mono cell-input"
                  :placeholder="t('modbus.functionCustomPlaceholder')"
                />
              </td>
              <td>
                <n-input v-model:value="frame.addr" size="tiny" class="mono cell-input" />
              </td>
              <td>
                <n-input v-model:value="frame.qty" size="tiny" class="mono cell-input" />
              </td>
              <td>
                <n-input
                  v-if="frameShowsWriteData(frame)"
                  v-model:value="frame.writeData"
                  size="tiny"
                  class="mono cell-input"
                  :placeholder="writeDataPlaceholder"
                />
                <span v-else class="mono muted-cell">—</span>
              </td>
              <td v-if="PROTOCOLS[protocol].hasTransactionId">
                <n-input v-model:value="frame.transactionId" size="tiny" class="mono cell-input" />
              </td>
              <td>
                <div class="row-actions">
                  <n-button size="tiny" :disabled="!isConnected" @click="sendFrame(frame, false)">
                    {{ t("modbus.debug.send") }}
                  </n-button>
                  <n-button size="tiny" quaternary type="error" @click="removeFrame(frame.id)">
                    {{ t("modbus.parser.remove") }}
                  </n-button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty-hint">{{ t("modbus.debug.noFrames") }}</p>

      <div class="out-row frame-preview">
        <n-input
          :value="frames.length ? frameText(frames[0]!) : ''"
          readonly
          size="small"
          class="mono out-input"
        />
      </div>
      <div v-if="frames.length && frameError(frames[0]!)" class="error-text">
        {{ frameError(frames[0]!) }}
      </div>
      <div class="hint-text">{{ t("modbus.debug.framesHint") }}</div>
    </section>

    <section class="card">
      <div class="section-head">
        <h2 class="card-title">{{ t("modbus.debug.polling") }}</h2>
        <div class="section-actions">
          <n-radio-group v-model:value="pollMode" size="small" :disabled="pollEnabled">
            <n-radio-button value="single">{{ t("modbus.debug.pollMode.single") }}</n-radio-button>
            <n-radio-button value="sequential">
              {{ t("modbus.debug.pollMode.sequential") }}
            </n-radio-button>
          </n-radio-group>
          <n-input-number
            v-model:value="pollIntervalMs"
            size="tiny"
            :min="20"
            :show-button="false"
            class="interval-input"
            :disabled="pollEnabled"
          />
          <span class="field-label">{{ t("modbus.debug.intervalUnit") }}</span>
          <n-button
            size="tiny"
            :type="pollEnabled ? 'warning' : 'primary'"
            :disabled="!isConnected"
            @click="pollEnabled ? stopPolling() : startPolling()"
          >
            {{ pollEnabled ? t("modbus.debug.stop") : t("modbus.debug.start") }}
          </n-button>
        </div>
      </div>

      <div class="stats-row">
        <span class="stat">{{ t("modbus.debug.stat.sent") }}：{{ stats.sent }}</span>
        <span class="stat">{{ t("modbus.debug.stat.ok") }}：{{ stats.ok }}</span>
        <span class="stat" :class="{ 'stat-alert': stats.exception > 0 }">
          {{ t("modbus.debug.stat.exception") }}：{{ stats.exception }}
        </span>
        <span class="stat">{{ t("modbus.debug.stat.timeout") }}：{{ stats.timeout }}</span>
        <span class="stat">{{ t("modbus.debug.stat.skipped") }}：{{ stats.skipped }}</span>
        <span class="stat" :class="{ 'stat-alert': stats.crc > 0 }">
          {{ t("modbus.debug.stat.crc") }}：{{ stats.crc }}
        </span>
      </div>
      <div class="hint-text">{{ t("modbus.debug.pollHint") }}</div>
    </section>

    <section class="card">
      <h2 class="card-title">{{ t("modbus.debug.monitor") }}</h2>

      <ParseRuleTable :regions="regionList" />
      <div class="hint-text">{{ t("modbus.debug.monitorHint") }}</div>
    </section>

    <section class="card">
      <div class="section-head">
        <h2 class="card-title">{{ t("modbus.debug.traffic") }}</h2>
        <div class="section-actions">
          <n-button size="tiny" quaternary @click="clearLog">
            {{ t("modbus.debug.clearLog") }}
          </n-button>
        </div>
      </div>

      <div class="buffer-row">
        <span class="field-label">{{ t("modbus.debug.buffered") }}</span>
        <span class="mono buffer-text">{{ bufferedText || t("modbus.debug.bufferedEmpty") }}</span>
      </div>

      <div class="log-shell">
        <p v-if="logs.length === 0" class="empty-hint">{{ t("modbus.debug.emptyLog") }}</p>
        <div v-for="entry in logs" :key="entry.id" class="log-row">
          <span class="log-time">{{ entry.time }}</span>
          <span class="log-direction" :class="`log-${entry.direction}`">
            {{ t(`modbus.debug.direction.${entry.direction}`) }}
          </span>
          <span class="mono log-text" :class="{ 'log-warning': entry.warning }">
            {{ entry.text }}
          </span>
          <span v-if="entry.detail" class="log-detail">{{ entry.detail }}</span>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">{{ t("modbus.debug.latest") }}</h2>

      <div v-if="!latest" class="empty-hint">{{ t("modbus.debug.noResponse") }}</div>
      <template v-else>
        <div class="result-block">
          <div v-for="(line, index) in responseLines" :key="index" class="result-line">
            <span v-if="line.value">{{ lineLabel(line.key) }}：{{ line.value }}</span>
            <span v-else class="result-heading">{{ lineLabel(line.key) }}</span>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.debug-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 1280px;
}

.page-header h1 {
  margin: 0 0 5px;
  font-size: 19px;
  font-weight: 600;
}

.page-header p {
  max-width: 900px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--et-text-secondary);
}

.notice {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--et-danger);
  border: 1px solid var(--et-border-color);
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

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-head .card-title {
  margin-bottom: 0;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.interval-input {
  width: 90px;
}

.mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 10px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--et-text-secondary);
}

.port-row {
  display: flex;
  gap: 8px;
}

.mono {
  font-family: Consolas, "Cascadia Mono", monospace;
}

.out-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.out-input {
  flex: 1;
}

.button-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--et-text-secondary);
}

.stat-alert {
  color: var(--et-danger);
}

.rules-shell {
  overflow-x: auto;
  border: 1px solid var(--et-border-color);
  background: var(--et-bg-surface);
}

.rules-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

.rules-table th,
.rules-table td {
  padding: 5px 8px;
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

.cell-input {
  width: 100%;
}

.frames-table {
  min-width: 900px;
}

.pick-column,
.check-column {
  width: 64px;
  text-align: center;
}

.row-actions {
  display: flex;
  gap: 6px;
}

.muted-cell {
  color: var(--et-text-muted);
}

.frame-preview {
  margin-top: 10px;
}

.buffer-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.buffer-text {
  font-size: 12px;
  color: var(--et-text-secondary);
  word-break: break-all;
}

.log-shell {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--et-border-color);
  background: var(--et-bg-base);
}

.log-row {
  display: grid;
  grid-template-columns: 84px 34px minmax(140px, 1fr) minmax(140px, 1.4fr);
  gap: 8px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--et-border-color);
  font-size: 12px;
}

.log-row:last-child {
  border-bottom: 0;
}

.log-time {
  color: var(--et-text-muted);
}

.log-direction {
  font-weight: 600;
}

.log-tx {
  color: var(--et-accent);
}

.log-rx {
  color: var(--et-text-primary);
}

.log-info {
  color: var(--et-text-muted);
}

.log-text,
.log-detail {
  word-break: break-all;
}

.log-detail {
  color: var(--et-text-secondary);
}

.log-warning {
  color: var(--et-danger);
}

.result-block {
  margin-bottom: 10px;
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

.error-text {
  margin-top: 8px;
  font-size: 12px;
  color: var(--et-danger);
}

.hint-text {
  margin-top: 8px;
  font-size: 12px;
  color: var(--et-text-muted);
}

.empty-hint {
  margin: 0;
  padding: 10px;
  border: 1px dashed var(--et-border-color);
  font-size: 12px;
  color: var(--et-text-muted);
}
</style>
