/**
 * Modbus ASCII 报文：`:` + 十六进制 ASCII 字符 + LRC，帧尾为 CR LF。
 *
 * 文本重排独立实现（`reorderTextBytes`），保留原网页版全部 4 种模式且不补零。
 */

import { bytesToHex, hex2, hexToBytes } from "./bytes";
import { lrc } from "./checksum";
import { buildRequestPdu, dataRegion, isReadFunction } from "./functions";
import { addressValue, responseLines } from "./frame-rtu";
import type {
  BuiltFrame,
  FrameLine,
  FrameParseValue,
  ProtocolResult,
  RequestFields,
  ResponseFields,
  ResponseKind,
} from "./types";

/** 最短 ASCII 帧：站号 + 功能码 + LRC。 */
export const MIN_ASCII_FRAME_LENGTH = 3;
export const ASCII_START = 0x3a;
export const ASCII_CR = 0x0d;
export const ASCII_LF = 0x0a;

function asciiChars(bytes: Uint8Array | readonly number[]): string {
  return bytesToHex(bytes, "");
}

function wrapAscii(unit: number, pdu: readonly number[], lines: FrameLine[]): BuiltFrame {
  const body = [unit & 0xff, ...Array.from(pdu, (byte) => byte & 0xff)];
  const lrcByte = lrc(body);
  const bytes = Uint8Array.from([...body, lrcByte]);
  return {
    bytes,
    text: `:${asciiChars(bytes)}`,
    lines: [
      { key: "slaveAddress", value: `${hex2(unit)} (${unit & 0xff})` },
      ...lines,
      { key: "lrc", value: hex2(lrcByte) },
      { key: "asciiFrame", value: `:${asciiChars(bytes)}` },
      { key: "frameEnd", value: "CR LF (0D 0A)" },
    ],
  };
}

export function buildAsciiRequest(fields: RequestFields): BuiltFrame {
  const pdu = buildRequestPdu(fields.func, fields.addr, fields.qty, fields.data);
  return wrapAscii(fields.unit, pdu, [
    { key: "function", value: hex2(fields.func) },
    { key: "startAddress", value: addressValue(fields.addr) },
    { key: "quantity", value: `${bytesToHex(pdu.slice(3, 5))} (${fields.qty & 0xffff})` },
  ]);
}

export function buildAsciiResponse(
  fields: ResponseFields,
  pdu: readonly number[],
  kind: ResponseKind,
): BuiltFrame {
  return wrapAscii(fields.unit, pdu, responseLines(pdu, kind));
}

/** 直接用 PDU 构造 ASCII 帧（自动追加 LRC）。 */
export function buildAsciiFrame(unit: number, pdu: readonly number[]): BuiltFrame {
  return wrapAscii(unit, pdu, [{ key: "function", value: hex2(pdu[0] ?? 0) }]);
}

/**
 * 解析 ASCII 报文。
 * 输入可以是十六进制串转成的字节，也可以是以 `:` 开头的原始 ASCII 字节流。
 * LRC 不匹配时返回 `lrcMismatch` 告警。
 */
export function parseAsciiFrame(input: Uint8Array): ProtocolResult<FrameParseValue> {
  let bytes = input;
  let frameText = "";

  // 原始 ASCII 字节流：以 ':' 开头，先还原为十六进制文本。
  if (bytes[0] === ASCII_START) {
    frameText = Array.from(bytes, (code) => String.fromCharCode(code)).join("");
    const decoded = hexToBytes(frameText);
    if (!decoded.ok) return { ok: false, error: decoded.error };
    bytes = decoded.value;
  }

  if (bytes.length < MIN_ASCII_FRAME_LENGTH) {
    return {
      ok: false,
      error: { code: "frameTooShort", detail: `${bytes.length}/${MIN_ASCII_FRAME_LENGTH}` },
    };
  }

  const unit = bytes[0] ?? 0;
  const func = bytes[1] ?? 0;
  const body = bytes.slice(0, bytes.length - 1);
  const lrcByte = bytes[bytes.length - 1] ?? 0;
  const expectedLrc = lrc(body);
  const data = dataRegion(func, bytes.slice(2, bytes.length - 1));

  if (!frameText) frameText = `:${asciiChars(bytes)}`;

  const lines: FrameLine[] = [
    { key: "asciiFrame", value: frameText.replace(/[\r\n]/g, "\\r\\n") },
    { key: "slaveAddress", value: `${hex2(unit)} (${unit})` },
    { key: "function", value: hex2(func) },
  ];
  if (isReadFunction(func)) {
    const byteCount = bytes[2] ?? 0;
    lines.push({ key: "byteCount", value: `${hex2(byteCount)} (${byteCount})` });
  }
  lines.push({ key: "dataRegion", value: bytesToHex(data) });
  lines.push({ key: "lrc", value: `${hex2(lrcByte)} (${hex2(expectedLrc)})` });

  return {
    ok: true,
    value: {
      unit,
      func,
      data,
      lines,
      ...(lrcByte === expectedLrc ? {} : { warning: { code: "lrcMismatch" as const } }),
    },
  };
}
