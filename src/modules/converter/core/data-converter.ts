import { applyLayout, isLayoutMeaningful, removeLayout } from "./byte-order";
import type { DataLayout, LayoutId } from "./byte-order";
import { DATA_TYPES } from "./data-types";
import type { DataTypeDefinition, DataTypeId } from "./data-types";

export type InputFormat = "decimal" | "hex";

export type ConversionErrorCode =
  | "empty"
  | "invalidDecimal"
  | "invalidHex"
  | "integerRequired"
  | "outOfRange"
  | "tooWide"
  | "unsupportedLayout";

export interface ConversionCell {
  value: string | null;
  error?: ConversionErrorCode;
}

export interface ConversionRow {
  dataType: DataTypeDefinition;
  cells: Record<LayoutId, ConversionCell>;
}

export interface NormalizedHex {
  compact: string;
  formatted: string;
  bytes: Uint8Array;
}

const INTEGER_PATTERN = /^[+-]?\d+$/;
const DECIMAL_PATTERN =
  /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$|^[+-]?(?:Infinity|NaN)$/i;
const SPECIAL_FLOAT_PATTERN = /^[+-]?(?:Infinity|NaN)$/i;
const HEX_PATTERN = /^(?:0x)?[0-9a-f\s_]+$/i;

function failure(error: ConversionErrorCode): ConversionCell {
  return { value: null, error };
}

function bigintToBytes(value: bigint, definition: DataTypeDefinition): Uint8Array {
  const bits = BigInt(definition.bits);
  const modulo = 1n << bits;
  let encoded = value;
  if (definition.signed && value < 0n) encoded = modulo + value;

  const bytes = new Uint8Array(definition.bits / 8);
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(encoded & 0xffn);
    encoded >>= 8n;
  }
  return bytes;
}

function integerRange(definition: DataTypeDefinition): readonly [bigint, bigint] {
  const bits = BigInt(definition.bits);
  if (!definition.signed) return [0n, (1n << bits) - 1n];
  const limit = 1n << (bits - 1n);
  return [-limit, limit - 1n];
}

function encodeDecimal(input: string, definition: DataTypeDefinition): ConversionCell | Uint8Array {
  const trimmed = input.trim();
  if (!trimmed) return failure("empty");

  if (definition.kind === "integer") {
    if (!INTEGER_PATTERN.test(trimmed)) {
      return failure(DECIMAL_PATTERN.test(trimmed) ? "integerRequired" : "invalidDecimal");
    }

    const value = BigInt(trimmed);
    const [minimum, maximum] = integerRange(definition);
    if (value < minimum || value > maximum) return failure("outOfRange");
    return bigintToBytes(value, definition);
  }

  if (!DECIMAL_PATTERN.test(trimmed)) return failure("invalidDecimal");
  const value = Number(trimmed);
  if (!SPECIAL_FLOAT_PATTERN.test(trimmed)) {
    if (!Number.isFinite(value)) return failure("outOfRange");
    if (definition.bits === 32 && Math.abs(value) > 3.4028234663852886e38) {
      return failure("outOfRange");
    }
  }
  const buffer = new ArrayBuffer(definition.bits / 8);
  const view = new DataView(buffer);
  if (definition.bits === 32) view.setFloat32(0, value, false);
  else view.setFloat64(0, value, false);
  return new Uint8Array(buffer);
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function decodeCanonical(bytes: Uint8Array, definition: DataTypeDefinition): string {
  if (definition.kind === "integer") {
    let value = bytesToBigint(bytes);
    if (definition.signed && (bytes[0] ?? 0) >= 0x80) {
      value -= 1n << BigInt(definition.bits);
    }
    return value.toString();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const value = definition.bits === 32 ? view.getFloat32(0, false) : view.getFloat64(0, false);
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function formatHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

export function normalizeHex(input: string): NormalizedHex | ConversionCell {
  const trimmed = input.trim();
  if (!trimmed) return failure("empty");
  if (!HEX_PATTERN.test(trimmed)) return failure("invalidHex");

  let compact = trimmed.replace(/^0x/i, "").replace(/[\s_]/g, "").toUpperCase();
  if (!compact || !/^[0-9A-F]+$/.test(compact)) return failure("invalidHex");
  if (compact.length % 2 !== 0) compact = `0${compact}`;

  const bytes = Uint8Array.from(
    compact.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [],
  );
  return { compact, formatted: formatHex(bytes), bytes };
}

function padHexBytes(bytes: Uint8Array, targetLength: number): Uint8Array {
  const padded = new Uint8Array(targetLength);
  padded.set(bytes, targetLength - bytes.length);
  return padded;
}

export type EncodeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: ConversionErrorCode };

/**
 * 把十进制数值文本编码为 ABCD 规范序字节。
 * 供协议响应生成器复用，避免与 `convertCell()` 的编码逻辑分叉。
 */
export function encodeCanonical(input: string, definition: DataTypeDefinition): EncodeResult {
  const encoded = encodeDecimal(input, definition);
  if (encoded instanceof Uint8Array) return { ok: true, bytes: encoded };
  return { ok: false, error: encoded.error ?? "invalidDecimal" };
}

export function convertCell(
  input: string,
  format: InputFormat,
  definition: DataTypeDefinition,
  layout: DataLayout,
): ConversionCell {
  const byteLength = definition.bits / 8;
  if (!isLayoutMeaningful(byteLength, layout)) return failure("unsupportedLayout");

  if (format === "decimal") {
    const encoded = encodeDecimal(input, definition);
    if (!(encoded instanceof Uint8Array)) return encoded;
    return { value: formatHex(applyLayout(encoded, layout)) };
  }

  const normalized = normalizeHex(input);
  if (!("bytes" in normalized)) return normalized;
  if (normalized.bytes.length > byteLength) return failure("tooWide");

  const physicalBytes = padHexBytes(normalized.bytes, byteLength);
  return { value: decodeCanonical(removeLayout(physicalBytes, layout), definition) };
}

export function convertAll(
  input: string,
  format: InputFormat,
  layouts: readonly DataLayout[],
): ConversionRow[] {
  return DATA_TYPES.map((dataType) => ({
    dataType,
    cells: Object.fromEntries(
      layouts.map((layout) => [layout.id, convertCell(input, format, dataType, layout)]),
    ) as Record<LayoutId, ConversionCell>,
  }));
}

export function getDataType(id: DataTypeId): DataTypeDefinition {
  const definition = DATA_TYPES.find((item) => item.id === id);
  if (!definition) throw new Error(`Unknown data type: ${id}`);
  return definition;
}
