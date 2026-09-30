/**
 * 接收字节流 -> 完整报文的拆帧。
 *
 * 这里是纯函数：只根据缓冲区内容与已知长度做切分，不涉及时间。
 * 真实的串口时序（RTU 帧间隔）依赖驱动与调度，必须在 Rust 侧结合
 * 接收缓冲、预期响应长度、CRC 与接收超时处理，不能等同于前端收到事件的时间。
 */

import { ASCII_CR, ASCII_LF, ASCII_START, MIN_ASCII_FRAME_LENGTH } from "./frame-ascii";
import { MAX_MBAP_LENGTH, MIN_MBAP_LENGTH } from "./frame-tcp";
import { MAX_RTU_FRAME_LENGTH, MIN_RTU_FRAME_LENGTH } from "./frame-rtu";
import { readU16be } from "./bytes";
import type { ProtocolError } from "./types";

export interface FramingResult {
  /** 已完整切分出的帧（不含分隔符）。 */
  frames: Uint8Array[];
  /** 尚未构成完整帧的剩余字节，需与后续数据拼接。 */
  rest: Uint8Array;
  /** 无法继续切分时的原因；已切出的帧仍然有效。 */
  error?: ProtocolError;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** 把已切分的帧重新拼成字节流，便于与 `rest` 一起维护接收缓冲。 */
export function appendChunks(chunks: readonly Uint8Array[]): Uint8Array {
  return concatBytes(chunks);
}

/** 按 MBAP 长度字段切分 TCP 流，可处理粘包与拆包。 */
export function splitTcpFrames(buffer: Uint8Array): FramingResult {
  const frames: Uint8Array[] = [];
  let offset = 0;

  while (buffer.length - offset >= 6) {
    const length = readU16be(buffer, offset + 4);
    if (length < MIN_MBAP_LENGTH || length > MAX_MBAP_LENGTH) {
      return {
        frames,
        rest: buffer.slice(offset),
        error: { code: "invalidLengthField", detail: String(length) },
      };
    }
    const total = 6 + length;
    if (buffer.length - offset < total) break;
    frames.push(buffer.slice(offset, offset + total));
    offset += total;
  }

  return { frames, rest: buffer.slice(offset) };
}

/**
 * 预测 RTU 帧长度。
 *
 * 读类功能码在请求与响应中长度语义不同：请求固定 8 字节，响应的字节数在
 * 第三个字节。本工具作为主站只接收响应，因此按响应长度预测；当存在待响应
 * 请求时，应优先使用请求上下文给出的 `expectedLength`。
 */
export function predictRtuFrameLength(bytes: Uint8Array): number | null {
  if (bytes.length < 2) return null;
  const func = bytes[1] ?? 0;
  if ((func & 0x80) !== 0) return MIN_RTU_FRAME_LENGTH;

  switch (func) {
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x04: {
      const byteCount = bytes[2];
      if (byteCount === undefined) return null;
      const length = 3 + byteCount + 2;
      return length > MAX_RTU_FRAME_LENGTH ? null : length;
    }
    case 0x05:
    case 0x06:
    case 0x0f:
    case 0x10:
      return 8;
    default:
      return null;
  }
}

/**
 * 切分 RTU 流。
 *
 * `expectedLength` 存在时（RTU 第一版每连接只允许一个在途请求）只切一帧，
 * 剩余字节保留在 `rest`，由上层按超时或剩余应答处理。
 */
export function splitRtuFrames(buffer: Uint8Array, expectedLength?: number): FramingResult {
  const frames: Uint8Array[] = [];
  let offset = 0;

  while (buffer.length - offset >= MIN_RTU_FRAME_LENGTH) {
    const length = expectedLength ?? predictRtuFrameLength(buffer.slice(offset));
    if (length === null || length < MIN_RTU_FRAME_LENGTH || length > MAX_RTU_FRAME_LENGTH) {
      return {
        frames,
        rest: buffer.slice(offset),
        error: { code: "frameTooShort", detail: "unpredictableLength" },
      };
    }
    if (buffer.length - offset < length) break;

    frames.push(buffer.slice(offset, offset + length));
    offset += length;
    if (expectedLength !== undefined) break;
  }

  return { frames, rest: buffer.slice(offset) };
}

function findCrlf(buffer: Uint8Array, from: number): number {
  for (let index = from; index + 1 < buffer.length; index += 1) {
    if (buffer[index] === ASCII_CR && buffer[index + 1] === ASCII_LF) return index;
  }
  return -1;
}

/** 按 `:` 起始、CR LF 结束切分 ASCII 流；返回的帧包含起始冒号。 */
export function splitAsciiFrames(buffer: Uint8Array): FramingResult {
  const frames: Uint8Array[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(ASCII_START, cursor);
    if (start < 0) return { frames, rest: new Uint8Array(0) };

    const end = findCrlf(buffer, start);
    if (end < 0) return { frames, rest: buffer.slice(start) };

    const frame = buffer.slice(start, end);
    if (frame.length >= MIN_ASCII_FRAME_LENGTH) frames.push(frame);
    cursor = end + 2;
  }

  return { frames, rest: new Uint8Array(0) };
}
