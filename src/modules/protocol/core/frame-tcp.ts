/** Modbus TCP 报文：MBAP 头部（7 字节）+ PDU。 */

import { bytesToHex, hex2, hex4, readU16be, u16be } from "./bytes";
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

/** 最短 TCP 帧：MBAP(7) + 功能码(1)。 */
export const MIN_TCP_FRAME_LENGTH = 8;
/** MBAP 头部长度（事务标识 2 + 协议标识 2 + 长度 2 + 单元标识 1）。 */
export const MBAP_HEADER_LENGTH = 7;
/** 长度字段合法范围：单元标识 + PDU，最小 2（单元标识 + 功能码），最大 254。 */
export const MIN_MBAP_LENGTH = 2;
export const MAX_MBAP_LENGTH = 254;

function wrapTcp(
  transactionId: number,
  unit: number,
  pdu: readonly number[],
  lines: FrameLine[],
): BuiltFrame {
  const payload = Array.from(pdu, (byte) => byte & 0xff);
  const length = 1 + payload.length;
  const bytes = Uint8Array.from([
    ...u16be(transactionId),
    0x00,
    0x00,
    ...u16be(length),
    unit & 0xff,
    ...payload,
  ]);

  return {
    bytes,
    text: bytesToHex(bytes),
    lines: [
      { key: "mbapHeader", value: "" },
      {
        key: "transactionId",
        value: `${bytesToHex(u16be(transactionId))} (${transactionId & 0xffff})`,
      },
      { key: "protocolId", value: `${bytesToHex([0, 0])} (0)` },
      { key: "length", value: `${bytesToHex(u16be(length))} (${length})` },
      { key: "unitId", value: `${hex2(unit)} (${unit & 0xff})` },
      ...lines,
    ],
  };
}

export function buildTcpRequest(fields: RequestFields): BuiltFrame {
  const pdu = buildRequestPdu(fields.func, fields.addr, fields.qty, fields.data);
  return wrapTcp(fields.tid, fields.unit, pdu, [
    { key: "function", value: hex2(fields.func) },
    { key: "startAddress", value: addressValue(fields.addr) },
    { key: "quantity", value: `${bytesToHex(u16be(fields.qty))} (${fields.qty & 0xffff})` },
  ]);
}

export function buildTcpResponse(
  fields: ResponseFields,
  pdu: readonly number[],
  kind: ResponseKind,
): BuiltFrame {
  return wrapTcp(fields.tid, fields.unit, pdu, responseLines(pdu, kind));
}

/** 直接用 PDU 构造 TCP 帧（自动计算 MBAP 长度）。 */
export function buildTcpFrame(
  transactionId: number,
  unit: number,
  pdu: readonly number[],
): BuiltFrame {
  return wrapTcp(transactionId, unit, pdu, [{ key: "function", value: hex2(pdu[0] ?? 0) }]);
}

/**
 * 解析 TCP 报文。
 * 协议标识非 0 或长度字段与实际不符时返回告警，但仍给出解析结果。
 */
export function parseTcpFrame(bytes: Uint8Array): ProtocolResult<FrameParseValue> {
  if (bytes.length < MIN_TCP_FRAME_LENGTH) {
    return {
      ok: false,
      error: { code: "frameTooShort", detail: `${bytes.length}/${MIN_TCP_FRAME_LENGTH}` },
    };
  }

  const transactionId = readU16be(bytes, 0);
  const protocolId = readU16be(bytes, 2);
  const length = readU16be(bytes, 4);
  const unit = bytes[6] ?? 0;
  const func = bytes[7] ?? 0;
  const data = dataRegion(func, bytes.slice(8));

  const lines: FrameLine[] = [
    { key: "mbapHeader", value: "" },
    { key: "transactionId", value: `${bytesToHex(bytes.slice(0, 2))} (${transactionId})` },
    { key: "protocolId", value: `${bytesToHex(bytes.slice(2, 4))} (${protocolId})` },
    { key: "length", value: `${bytesToHex(bytes.slice(4, 6))} (${length})` },
    { key: "unitId", value: `${hex2(unit)} (${unit})` },
    { key: "function", value: hex2(func) },
  ];
  if (isReadFunction(func)) {
    const byteCount = bytes[8] ?? 0;
    lines.push({ key: "byteCount", value: `${hex2(byteCount)} (${byteCount})` });
  }
  lines.push({ key: "dataRegion", value: bytesToHex(data) });

  let warning: FrameParseValue["warning"];
  if (protocolId !== 0) {
    warning = { code: "protocolIdMismatch", detail: hex4(protocolId) };
  } else if (length !== bytes.length - 6) {
    warning = { code: "lengthMismatch", detail: `${length}/${bytes.length - 6}` };
  }

  return {
    ok: true,
    value: {
      unit,
      func,
      data,
      lines,
      transactionId,
      protocolId,
      ...(warning ? { warning } : {}),
    },
  };
}
