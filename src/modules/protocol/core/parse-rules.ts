/**
 * 解析规则：把数据区域按规则解码为精确值。
 *
 * 与转换器 `convertCell()` 的差异（不可退回薄封装）：
 * 1. 先做长度闸门：数值规则要求可用字节数恰好等于 `bits / 8`，
 *    不足时返回结构化错误 `insufficientData`，绝不补零。
 * 2. 整数结果返回 `bigint`，浮点返回 `number`，避免大整数精度丢失。
 * 3. 缩放/导出环节不做无条件 `Number()`：整数缩放能精确时用 BigInt 计算，
 *    超出安全整数范围又必须用浮点因子时返回 `scaleOverflow`，而不是静默丢精度。
 * 4. ASCII 文本重排按实际字节长度处理（4 种模式），不经过会补零的 `splitWords()`。
 */

import { DATA_LAYOUTS, isLayoutMeaningful, removeLayout } from "../../converter/core/byte-order";
import type { LayoutId } from "../../converter/core/byte-order";
import { DATA_TYPES } from "../../converter/core/data-types";
import type { DataTypeDefinition, DataTypeId } from "../../converter/core/data-types";
import { reorderTextBytes } from "./bytes";
import type { TextOrder } from "./bytes";
import { isReadBits } from "./functions";
import type { ErrorCode, ProtocolResult } from "./types";

export type RuleTypeId = DataTypeId | "ascii";

export interface NumericParseRule {
  kind: "numeric";
  id: number;
  offset: number;
  dataType: DataTypeId;
  layout: LayoutId;
}

export interface TextParseRule {
  kind: "text";
  id: number;
  offset: number;
  /** 文本字节数，由用户显式给出，不补零。 */
  length: number;
  order: TextOrder;
}

export type ParseRule = NumericParseRule | TextParseRule;

export type DecodedValue =
  | { kind: "integer"; value: bigint }
  | { kind: "float"; value: number }
  | { kind: "text"; value: string };

export interface RuleDecode {
  /** 数据区域中的原始字节。 */
  raw: Uint8Array;
  /** 按规则重排后的字节（数值为 ABCD 规范序）。 */
  ordered: Uint8Array;
  decoded: DecodedValue;
}

export interface NumericScale {
  /** 十进制字符串，例如 "0.1"；空串表示 1。 */
  factor: string;
  /** 十进制字符串，例如 "-40"；空串表示 0。 */
  offset: string;
}

const INTEGER_TEXT = /^[+-]?\d+$/;
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_DECIMALS = 20;

function fail(code: ErrorCode, detail?: string): ProtocolResult<never> {
  return { ok: false, error: detail === undefined ? { code } : { code, detail } };
}

/** 该数据类型下可用的字节序；16 位只有 abcd/dcba 有意义。 */
export function layoutsForDataType(dataType: DataTypeId) {
  const definition = DATA_TYPES.find((item) => item.id === dataType);
  if (!definition) return [];
  const byteLength = definition.bits / 8;
  return DATA_LAYOUTS.filter((layout) => isLayoutMeaningful(byteLength, layout));
}

/**
 * 一次已匹配读响应的数据区域及其请求上下文。
 * 保留每个请求各自的区域，是为了让按地址寻址的解析表在收到其它地址的响应后
 * 仍能显示原先寄存器的数值。
 */
export interface DataRegion {
  /** 请求起始地址：读位类功能码（01/02）为位地址，其余为寄存器地址。 */
  baseAddr: number;
  /** 请求功能码。 */
  func: number;
  /** 响应数据区域（读类响应已剥离首字节的字节数）。 */
  data: Uint8Array;
}

/**
 * 规则地址在该区域数据中的字节偏移。
 * 读位类功能码按位编址且要求位对齐，其余按寄存器编址（每寄存器 2 字节）。
 * 区域没有完整覆盖该地址时返回 null，绝不跨区域或补零读取。
 */
export function regionByteOffset(
  region: DataRegion,
  addr: number,
  byteLength: number,
): number | null {
  const delta = addr - region.baseAddr;
  if (delta < 0) return null;

  const offset = isReadBits(region.func) ? (delta % 8 === 0 ? delta / 8 : -1) : delta * 2;
  if (offset < 0 || offset + byteLength > region.data.length) return null;
  return offset;
}

/** 数值解码：字节已是 ABCD 规范序。 */
function decodeCanonical(bytes: Uint8Array, definition: DataTypeDefinition): DecodedValue {
  if (definition.kind === "integer") {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    if (definition.signed && (bytes[0] ?? 0) >= 0x80) {
      value -= 1n << BigInt(definition.bits);
    }
    return { kind: "integer", value };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = definition.bits === 32 ? view.getFloat32(0, false) : view.getFloat64(0, false);
  return { kind: "float", value };
}

/** 逐字节映射为字符，保证 0x00–0xFF 与字符一一对应（与 TextDecoder 的 latin1 不同）。 */
function decodeTextBytes(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

export function decodeRule(data: Uint8Array, rule: ParseRule): ProtocolResult<RuleDecode> {
  if (rule.offset < 0) return fail("offsetOutOfRange", String(rule.offset));

  if (rule.kind === "text") {
    if (rule.length <= 0) return fail("insufficientData", `0/${rule.length}`);
    if (rule.offset + rule.length > data.length) {
      return fail("insufficientData", `${data.length - rule.offset}/${rule.length}`);
    }
    const raw = data.slice(rule.offset, rule.offset + rule.length);
    const ordered = reorderTextBytes(raw, rule.order);
    return {
      ok: true,
      value: { raw, ordered, decoded: { kind: "text", value: decodeTextBytes(ordered) } },
    };
  }

  const definition = DATA_TYPES.find((item) => item.id === rule.dataType);
  if (!definition) return fail("unknownDataType", rule.dataType);

  const layout = DATA_LAYOUTS.find((item) => item.id === rule.layout);
  if (!layout) return fail("unsupportedLayout", rule.layout);

  const byteLength = definition.bits / 8;
  if (!isLayoutMeaningful(byteLength, layout)) return fail("unsupportedLayout", rule.layout);
  if (rule.offset + byteLength > data.length) {
    return fail("insufficientData", `${data.length - rule.offset}/${byteLength}`);
  }

  const raw = data.slice(rule.offset, rule.offset + byteLength);
  const ordered = removeLayout(raw, layout);
  return { ok: true, value: { raw, ordered, decoded: decodeCanonical(ordered, definition) } };
}

/** 精确导出文本：整数不转 number，浮点按需固定小数位。 */
export function formatDecodedValue(decoded: DecodedValue, decimals?: number): string {
  if (decoded.kind === "integer") return decoded.value.toString();
  if (decoded.kind === "text") return decoded.value;

  const { value } = decoded;
  if (Number.isNaN(value)) return "NaN";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  if (Object.is(value, -0)) return "-0";
  if (decimals !== undefined && Number.isFinite(decimals)) {
    return value.toFixed(Math.max(0, Math.min(MAX_DECIMALS, Math.trunc(decimals))));
  }
  return String(value);
}

/**
 * 仅用于绘图边界：超出安全整数范围的大整数返回 null（不绘制），
 * 绝不在导出或解析环节做这种转换。
 */
export function toChartNumber(decoded: DecodedValue): number | null {
  if (decoded.kind === "text") return null;
  if (decoded.kind === "float") return Number.isFinite(decoded.value) ? decoded.value : null;
  if (decoded.value > SAFE_MAX || decoded.value < SAFE_MIN) return null;
  return Number(decoded.value);
}

/** 显式缩放规则，见文件头说明。 */
export function scaleDecoded(
  decoded: DecodedValue,
  scale: NumericScale,
): ProtocolResult<DecodedValue> {
  if (decoded.kind === "text") return { ok: true, value: decoded };

  const factorText = scale.factor.trim() === "" ? "1" : scale.factor.trim();
  const offsetText = scale.offset.trim() === "" ? "0" : scale.offset.trim();

  if (decoded.kind === "integer") {
    if (INTEGER_TEXT.test(factorText) && INTEGER_TEXT.test(offsetText)) {
      const value = decoded.value * BigInt(factorText) + BigInt(offsetText);
      return { ok: true, value: { kind: "integer", value } };
    }
    if (decoded.value > SAFE_MAX || decoded.value < SAFE_MIN) {
      return fail("scaleOverflow", "integerScaleRequiresFloat");
    }
    const scaled = Number(decoded.value) * Number(factorText) + Number(offsetText);
    return { ok: true, value: { kind: "float", value: scaled } };
  }

  const scaled = decoded.value * Number(factorText) + Number(offsetText);
  return { ok: true, value: { kind: "float", value: scaled } };
}
