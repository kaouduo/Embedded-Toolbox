/**
 * 响应报文生成器：把表单字段与数值编码为响应 PDU。
 *
 * 行为对齐网页版 `frametool.js` 的 `buildResponsePdu()`：
 * - custom：功能码 + 用户输入的 HEX 数据区域（为空时仅功能码）。
 * - 读位类（01/02）：按位打包，字节数 = ceil(qty / 8)，未提供的位补 0。
 * - 读寄存器（03/04）：逐个数值按数据类型与字节序编码，长度对齐到 qty * 2（生成器显式对齐），超出则截断。
 * - 写单个（05/06）：回显起始地址与单个数值。
 * - 写多个（0F/10）：回显起始地址与数量。
 *
 * 本模块只负责“生成”，不参与实时解析：解析路径的长度闸门见 `parse-rules.ts`，
 * 生成器按用户声明补齐/截断是为了产出完整报文，与解析时禁止补零不同。
 */

import { applyLayout, DATA_LAYOUTS, isLayoutMeaningful } from "../../converter/core/byte-order";
import type { DataLayout, LayoutId } from "../../converter/core/byte-order";
import { DATA_TYPES } from "../../converter/core/data-types";
import type { DataTypeDefinition, DataTypeId } from "../../converter/core/data-types";
import { encodeCanonical } from "../../converter/core/data-converter";
import type { ConversionErrorCode } from "../../converter/core/data-converter";
import { hasHexDigits, hexToBytes, u16be } from "./bytes";
import { isReadBits, isReadRegisters } from "./functions";
import type { ErrorCode, ProtocolResult, ResponseKind } from "./types";

export type NumberFormat = "hex" | "decimal";

/** 响应生成器表单字段；地址与数量已由视图层按当前进制解析为数值。 */
export interface ResponseSpec {
  /** 功能码是否为「自定义」；为真时忽略功能码语义，仅拼接数据区域。 */
  custom: boolean;
  func: number;
  addr: number;
  qty: number;
  /** 写单个功能码（05/06）数值字段的进制。 */
  format: NumberFormat;
  /** 数值文本，逗号/空格分隔；读位类为 0/1。 */
  values: string;
  /** 自定义功能码的数据区域 HEX。 */
  data: string;
  dataType: DataTypeId;
  layout: LayoutId;
}

export interface ResponsePdu {
  pdu: number[];
  kind: ResponseKind;
}

/** 响应生成器的字段可见性与标签，文案由视图层映射 i18n。 */
export interface ResponseFieldPlan {
  show: {
    addr: boolean;
    qty: boolean;
    type: boolean;
    order: boolean;
    values: boolean;
    data: boolean;
  };
  /** `protocol.responseLabels.<key>`。 */
  qtyLabel: "quantity" | "coilQuantity" | "registerQuantity";
  /** `protocol.responseLabels.<key>`。 */
  valuesLabel: "valueList" | "bitList" | "coilValue" | "value";
  /** 数量单位为位（线圈）。 */
  qtyBits: boolean;
}

function fail(code: ErrorCode, detail?: string): ProtocolResult<never> {
  return detail === undefined
    ? { ok: false, error: { code } }
    : { ok: false, error: { code, detail } };
}

function splitValues(raw: string): string[] {
  return raw.split(/[,，\s]+/).filter((item) => item !== "");
}

/** 把转换器的编码错误映射为协议错误码。 */
function mapConversionError(error: ConversionErrorCode): ErrorCode {
  if (error === "unsupportedLayout") return "unsupportedLayout";
  if (error === "outOfRange" || error === "tooWide") return "outOfRange";
  return "invalidValue";
}

/**
 * 按当前进制把输入解析为无符号整数，宽度 1 或 2 字节。
 * 空串视为 0；负数按二进制补码截断到目标宽度（与网页版 `parseNum` 一致）。
 */
export function parseNumberInput(
  input: string,
  format: NumberFormat,
  width: 1 | 2,
): ProtocolResult<number> {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: 0 };

  const digits = format === "hex" ? trimmed.replace(/^0x/i, "") : trimmed;
  const value = Number.parseInt(digits, format === "hex" ? 16 : 10);
  if (Number.isNaN(value)) return fail("invalidValue", trimmed);

  const mask = width === 1 ? 0xff : 0xffff;
  return { ok: true, value: (value & mask) >>> 0 };
}

function layoutFor(id: LayoutId): DataLayout | undefined {
  return DATA_LAYOUTS.find((item) => item.id === id);
}

/** 逐个数值按数据类型与字节序编码为物理字节序列。 */
export function encodeValuesInLayout(
  raw: string,
  dataType: DataTypeId,
  layout: LayoutId,
): ProtocolResult<number[]> {
  const definition: DataTypeDefinition | undefined = DATA_TYPES.find(
    (item) => item.id === dataType,
  );
  if (!definition) return fail("unknownDataType", dataType);

  const dataLayout = layoutFor(layout);
  if (!dataLayout) return fail("unsupportedLayout", layout);
  if (!isLayoutMeaningful(definition.bits / 8, dataLayout))
    return fail("unsupportedLayout", layout);

  const out: number[] = [];
  for (const item of splitValues(raw)) {
    const encoded = encodeCanonical(item, definition);
    if (!encoded.ok) return fail(mapConversionError(encoded.error), item);
    out.push(...applyLayout(encoded.bytes, dataLayout));
  }
  return { ok: true, value: out };
}

/** 响应生成器字段可见性与标签；与网页版 `applyRespFieldVisibility()` 一致。 */
export function responseFieldPlan(func: number, custom: boolean): ResponseFieldPlan {
  const code = func & 0xff;
  const show = { addr: false, qty: false, type: false, order: false, values: false, data: false };
  let qtyLabel: ResponseFieldPlan["qtyLabel"] = "quantity";
  let valuesLabel: ResponseFieldPlan["valuesLabel"] = "valueList";
  let qtyBits = false;

  if (custom) {
    show.data = true;
  } else if (isReadBits(code)) {
    show.qty = true;
    show.values = true;
    qtyLabel = "coilQuantity";
    valuesLabel = "bitList";
    qtyBits = true;
  } else if (isReadRegisters(code)) {
    show.qty = true;
    show.type = true;
    show.order = true;
    show.values = true;
    qtyLabel = "registerQuantity";
  } else if (code === 0x05 || code === 0x06) {
    show.addr = true;
    show.values = true;
    valuesLabel = code === 0x05 ? "coilValue" : "value";
  } else if (code === 0x0f) {
    show.addr = true;
    show.qty = true;
    qtyLabel = "coilQuantity";
    qtyBits = true;
  } else {
    show.addr = true;
    show.qty = true;
    qtyLabel = "registerQuantity";
  }

  return { show, qtyLabel, valuesLabel, qtyBits };
}

/** 构建响应 PDU；失败时返回结构化错误，不抛异常。 */
export function buildResponsePdu(spec: ResponseSpec): ProtocolResult<ResponsePdu> {
  const func = spec.func & 0xff;

  if (spec.custom) {
    if (!hasHexDigits(spec.data)) return { ok: true, value: { pdu: [func], kind: "custom" } };
    const region = hexToBytes(spec.data);
    if (!region.ok) return region;
    return { ok: true, value: { pdu: [func, ...region.value], kind: "custom" } };
  }

  if (isReadBits(func)) {
    const byteCount = Math.ceil(spec.qty / 8);
    const data = Array.from({ length: byteCount }, () => 0);
    splitValues(spec.values).forEach((item, index) => {
      if (index >= spec.qty) return;
      if (item === "1" || /^true$/i.test(item)) {
        const cursor = index >> 3;
        data[cursor] = (data[cursor] ?? 0) | (1 << (index & 7));
      }
    });
    return { ok: true, value: { pdu: [func, byteCount, ...data], kind: "read" } };
  }

  if (isReadRegisters(func)) {
    const dataLength = spec.qty * 2;
    const encoded = encodeValuesInLayout(spec.values, spec.dataType, spec.layout);
    if (!encoded.ok) return encoded;

    const data = encoded.value.slice(0, dataLength);
    while (data.length < dataLength) data.push(0);
    return { ok: true, value: { pdu: [func, dataLength & 0xff, ...data], kind: "read" } };
  }

  if (func === 0x05 || func === 0x06) {
    const value = parseNumberInput(spec.values, spec.format, 2);
    if (!value.ok) return value;
    return {
      ok: true,
      value: { pdu: [func, ...u16be(spec.addr), ...u16be(value.value)], kind: "write" },
    };
  }

  return {
    ok: true,
    value: { pdu: [func, ...u16be(spec.addr), ...u16be(spec.qty)], kind: "write" },
  };
}
