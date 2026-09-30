/**
 * 协议适配器：RTU / TCP / ASCII 三个报文工具页共用同一套界面，差异集中在此。
 *
 * 与网页版 `protocol-*.js` 的适配器一一对应：请求/响应封装、报文解析、校验计算。
 * 界面文案不在此处，由视图层按 `id` 与 `checksum` 映射 i18n。
 */

import { bytesToHex, hex2 } from "./bytes";
import { crc16Bytes, lrc } from "./checksum";
import { appendChunks } from "./framing";
import {
  ASCII_CR,
  ASCII_LF,
  buildAsciiRequest,
  buildAsciiResponse,
  parseAsciiFrame,
} from "./frame-ascii";
import { buildRtuRequest, buildRtuResponse, parseRtuFrame } from "./frame-rtu";
import { buildTcpRequest, buildTcpResponse, parseTcpFrame } from "./frame-tcp";
import type {
  BuiltFrame,
  FrameParseValue,
  ProtocolResult,
  RequestFields,
  ResponseFields,
  ResponseKind,
} from "./types";

export type ProtocolId = "rtu" | "tcp" | "ascii";
export type ChecksumKind = "crc16" | "lrc";

export interface ProtocolAdapter {
  id: ProtocolId;
  /** 是否携带事务标识符（仅 TCP）。 */
  hasTransactionId: boolean;
  /** 校验算法；TCP 无校验，为 `null`。 */
  checksum: ChecksumKind | null;
  /** 报文解析器的示例帧。 */
  sample: string;
  buildRequest(fields: RequestFields): BuiltFrame;
  buildResponse(fields: ResponseFields, pdu: readonly number[], kind: ResponseKind): BuiltFrame;
  parse(bytes: Uint8Array): ProtocolResult<FrameParseValue>;
  /** 校验计算器输出：RTU 为 CRC 两字节，ASCII 为单个 LRC，TCP 为空串。 */
  checksumText(bytes: Uint8Array): string;
}

export const PROTOCOL_IDS = ["rtu", "tcp", "ascii"] as const satisfies readonly ProtocolId[];

export const PROTOCOLS: Record<ProtocolId, ProtocolAdapter> = {
  rtu: {
    id: "rtu",
    hasTransactionId: false,
    checksum: "crc16",
    sample: "01 03 0C 40 48 F5 C3 00 00 01 3A C6 FE FF FF 39 D4",
    buildRequest: buildRtuRequest,
    buildResponse: buildRtuResponse,
    parse: parseRtuFrame,
    checksumText: (bytes) => bytesToHex(crc16Bytes(bytes)),
  },
  tcp: {
    id: "tcp",
    hasTransactionId: true,
    checksum: null,
    sample: "00 01 00 00 00 07 01 03 04 00 01 00 02",
    buildRequest: buildTcpRequest,
    buildResponse: buildTcpResponse,
    parse: parseTcpFrame,
    checksumText: () => "",
  },
  ascii: {
    id: "ascii",
    hasTransactionId: false,
    checksum: "lrc",
    sample: ":010300000002FA",
    buildRequest: buildAsciiRequest,
    buildResponse: buildAsciiResponse,
    parse: parseAsciiFrame,
    checksumText: (bytes) => hex2(lrc(bytes)),
  },
};

/**
 * 生成结果 -> 实际发送的字节。
 * ASCII 报文在线路上是文本字符并以 CR LF 结尾；RTU / TCP 直接发送二进制帧。
 */
export function toWireBytes(protocol: ProtocolId, built: BuiltFrame): Uint8Array {
  if (protocol !== "ascii") return built.bytes;
  const text = Uint8Array.from(built.text, (char) => char.charCodeAt(0) & 0xff);
  return appendChunks([text, Uint8Array.from([ASCII_CR, ASCII_LF])]);
}
