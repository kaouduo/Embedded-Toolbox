/** Modbus RTU 报文：从站地址 + PDU + CRC16（低字节在前）。 */

import { bytesToHex, hex2, hex4, readU16be, u16be } from "./bytes";
import { crc16Bytes } from "./checksum";
import { buildRequestPdu, dataRegion, isReadFunction } from "./functions";
import type {
  BuiltFrame,
  FrameLine,
  FrameParseValue,
  ProtocolResult,
  RequestFields,
  ResponseFields,
  ResponseKind,
} from "./types";

/** 最短 RTU 帧：地址 + 功能码 + 异常码 + CRC。 */
export const MIN_RTU_FRAME_LENGTH = 5;
/** RTU 帧最大 256 字节（含 CRC）。 */
export const MAX_RTU_FRAME_LENGTH = 256;

function wrapRtu(unit: number, pdu: readonly number[], lines: FrameLine[]): BuiltFrame {
  const body = [unit & 0xff, ...Array.from(pdu, (byte) => byte & 0xff)];
  const crc = crc16Bytes(body);
  const bytes = Uint8Array.from([...body, ...crc]);
  return {
    bytes,
    text: bytesToHex(bytes),
    lines: [
      { key: "slaveAddress", value: `${hex2(unit)} (${unit & 0xff})` },
      ...lines,
      { key: "crc", value: bytesToHex(crc) },
    ],
  };
}

/** 请求命令生成器：站号 + 功能码 + 起始地址 + 数量（写多点追加数据区域）。 */
export function buildRtuRequest(fields: RequestFields): BuiltFrame {
  const pdu = buildRequestPdu(fields.func, fields.addr, fields.qty, fields.data);
  return wrapRtu(fields.unit, pdu, [
    { key: "function", value: hex2(fields.func) },
    { key: "startAddress", value: addressValue(fields.addr) },
    { key: "quantity", value: quantityValue(fields.qty) },
  ]);
}

/** 响应报文生成器：根据响应类型推导说明行。 */
export function buildRtuResponse(
  fields: ResponseFields,
  pdu: readonly number[],
  kind: ResponseKind,
): BuiltFrame {
  return wrapRtu(fields.unit, pdu, responseLines(pdu, kind));
}

/** 直接用 PDU 构造 RTU 帧（自动追加 CRC）。 */
export function buildRtuFrame(unit: number, pdu: readonly number[]): BuiltFrame {
  return wrapRtu(unit, pdu, [{ key: "function", value: hex2(pdu[0] ?? 0) }]);
}

export const addressValue = (address: number): string =>
  `${bytesToHex(u16be(address))} (${hex4(address)})`;

const quantityValue = (quantity: number): string =>
  `${bytesToHex(u16be(quantity))} (${quantity & 0xffff})`;

/**
 * 响应生成器的说明行：读类展示字节数与数据区域，写类回显地址与数量。
 * RTU / TCP / ASCII 三个协议共用同一结构。
 */
export function responseLines(pdu: readonly number[], kind: ResponseKind): FrameLine[] {
  const func = pdu[0] ?? 0;
  const payload = Array.from(pdu.slice(1), (byte) => byte & 0xff);

  if (kind === "custom") {
    return [
      { key: "function", value: hex2(func) },
      { key: "dataRegion", value: bytesToHex(payload) },
    ];
  }

  if (kind === "read") {
    const byteCount = payload[0] ?? 0;
    return [
      { key: "function", value: hex2(func) },
      { key: "byteCount", value: `${hex2(byteCount)} (${byteCount})` },
      { key: "dataRegion", value: bytesToHex(payload.slice(1)) },
    ];
  }

  const payloadBytes = Uint8Array.from(payload);
  return [
    { key: "function", value: hex2(func) },
    { key: "startAddress", value: addressValue(readU16be(payloadBytes, 0)) },
    { key: "quantity", value: quantityValue(readU16be(payloadBytes, 2)) },
  ];
}

/**
 * 解析 RTU 报文：至少 5 字节，最后两字节为 CRC。
 * CRC 不匹配时仍返回解析结果，但附带 `crcMismatch` 告警。
 */
export function parseRtuFrame(bytes: Uint8Array): ProtocolResult<FrameParseValue> {
  if (bytes.length < MIN_RTU_FRAME_LENGTH) {
    return {
      ok: false,
      error: {
        code: "frameTooShort",
        detail: `${bytes.length}/${MIN_RTU_FRAME_LENGTH}`,
      },
    };
  }

  const unit = bytes[0] ?? 0;
  const func = bytes[1] ?? 0;
  const body = bytes.slice(0, bytes.length - 2);
  const actualCrc = bytes.slice(bytes.length - 2);
  const expectedCrc = crc16Bytes(body);
  const data = dataRegion(func, bytes.slice(2, bytes.length - 2));

  const lines: FrameLine[] = [
    { key: "slaveAddress", value: `${hex2(unit)} (${unit})` },
    { key: "function", value: hex2(func) },
  ];

  if (isReadFunction(func)) {
    const byteCount = bytes[2] ?? 0;
    lines.push({ key: "byteCount", value: `${hex2(byteCount)} (${byteCount})` });
  }
  lines.push({ key: "dataRegion", value: bytesToHex(data) });
  lines.push({
    key: "crc",
    value: `${bytesToHex(actualCrc)} (${bytesToHex(expectedCrc)})`,
  });

  const checksumOk = actualCrc[0] === expectedCrc[0] && actualCrc[1] === expectedCrc[1];
  return {
    ok: true,
    value: {
      unit,
      func,
      data,
      lines,
      ...(checksumOk ? {} : { warning: { code: "crcMismatch" as const } }),
    },
  };
}
