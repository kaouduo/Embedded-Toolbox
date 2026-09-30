/**
 * 调试会话：接收字节 -> 完整报文 -> 与在途请求关联。
 *
 * 这里是纯逻辑：时间由调用方注入（`sentAtMs` 与 `readAtMs` 用同一单调时钟即可，
 * 但不必与 Rust 的 `readAtMs` 同源——后者只用于判断字节到达顺序与分批情况）。
 * 接收缓冲、预期响应长度与 CRC 才是判断完整帧的依据。
 *
 * RTU 第一版每连接只允许一个在途请求：`splitRtuFrames` 命中一帧后即停止，
 * 超时后的迟到响应仍在接收缓冲中按同一规则切分，只是关联不到请求。
 */

import { readU16be } from "./bytes";
import { appendChunks, splitAsciiFrames, splitRtuFrames, splitTcpFrames } from "./framing";
import type { FramingResult } from "./framing";
import { MAX_RTU_FRAME_LENGTH, MIN_RTU_FRAME_LENGTH } from "./frame-rtu";
import { isExceptionFunction, isReadBits, isReadRegisters } from "./functions";
import { PROTOCOLS } from "./protocols";
import type { ProtocolId } from "./protocols";
import type { FrameParseValue, ProtocolResult } from "./types";

/** 已发出、等待响应的请求。用于拆帧长度预测与响应匹配。 */
export interface PendingRequest {
  unit: number;
  func: number;
  addr: number;
  qty: number;
  /** TCP 事务标识符；RTU / ASCII 为 null。 */
  tid: number | null;
  /** 发送时刻（单调毫秒，仅用于超时判断）。 */
  sentAtMs: number;
  /** 预期响应帧长（RTU 含 CRC）；无法预测时为 null。 */
  expectedLength: number | null;
}

/** 无法与在途请求关联的原因。 */
export type MismatchReason = "unexpected" | "tid" | "function" | "unit" | "data";

/** 一条已切分的完整报文及其解析/关联结果。 */
export interface ReceivedFrame {
  bytes: Uint8Array;
  readAtMs: number;
  parsed: ProtocolResult<FrameParseValue>;
  /** 命中的在途请求；未命中为 null。 */
  matched: PendingRequest | null;
  /** 未命中原因；命中时为 undefined。 */
  mismatch?: MismatchReason;
}

/**
 * 由请求推导 RTU 正常响应的帧长（含 CRC）。
 * 异常响应固定 5 字节，由切分逻辑按功能码单独判断，此处不覆盖。
 */
export function expectedRtuResponseLength(request: PendingRequest): number | null {
  const func = request.func & 0xff;
  if (isReadBits(func)) {
    const length = 5 + Math.ceil(request.qty / 8);
    return length > MAX_RTU_FRAME_LENGTH ? null : length;
  }
  if (isReadRegisters(func)) {
    const length = 5 + request.qty * 2;
    return length > MAX_RTU_FRAME_LENGTH ? null : length;
  }
  if (func === 0x05 || func === 0x06 || func === 0x0f || func === 0x10) return 8;
  return null;
}

/** 功能码一致比较：异常响应的功能码最高位为 1，需先屏蔽。 */
function sameFunction(pendingFunc: number, responseFunc: number): boolean {
  return (responseFunc & 0x7f) === (pendingFunc & 0xff);
}

/**
 * 响应数据区域与请求上下文的一致性：
 * - 读类：数据长度必须等于数量推导的字节数；
 * - 写单点（05/06）：回显地址必须等于请求地址；
 * - 写多点（0F/10）：回显地址与数量都必须等于请求值；
 * - 异常与自定义功能码无数据区域语义，不在此校验。
 */
function dataMatches(pending: PendingRequest, value: FrameParseValue): boolean {
  const func = pending.func & 0xff;
  if (isExceptionFunction(value.func)) return true;
  if (isReadBits(func)) return value.data.length === Math.ceil(pending.qty / 8);
  if (isReadRegisters(func)) return value.data.length === pending.qty * 2;
  if (func === 0x05 || func === 0x06) {
    return value.data.length >= 2 && readU16be(value.data, 0) === pending.addr;
  }
  if (func === 0x0f || func === 0x10) {
    return (
      value.data.length >= 4 &&
      readU16be(value.data, 0) === pending.addr &&
      readU16be(value.data, 2) === pending.qty
    );
  }
  return true;
}

function mismatchOf(
  protocol: ProtocolId,
  pending: PendingRequest,
  parsed: ProtocolResult<FrameParseValue>,
): MismatchReason | null {
  if (!parsed.ok) return "unexpected";
  const value = parsed.value;

  // 校验/长度告警的帧不可信：不消费在途请求，留给有效响应或超时。
  if (value.warning) return "unexpected";

  if (protocol === "tcp" && value.transactionId !== pending.tid) return "tid";
  if (!sameFunction(pending.func, value.func)) return "function";
  if (value.unit !== pending.unit) return "unit";
  if (!dataMatches(pending, value)) return "data";
  return null;
}

export class DebugSession {
  private protocol: ProtocolId;
  private rest: Uint8Array = new Uint8Array(0);
  private pending: PendingRequest | null = null;

  constructor(protocol: ProtocolId) {
    this.protocol = protocol;
  }

  getProtocol(): ProtocolId {
    return this.protocol;
  }

  /** 尚未构成完整帧的剩余字节，用于界面显示接收缓冲。 */
  getBuffered(): Uint8Array {
    return this.rest;
  }

  getPending(): PendingRequest | null {
    return this.pending;
  }

  /** 切换协议：接收缓冲按协议切分，切换时清空缓冲与在途请求。 */
  setProtocol(protocol: ProtocolId): void {
    if (protocol === this.protocol) return;
    this.protocol = protocol;
    this.clear();
  }

  clear(): void {
    this.rest = new Uint8Array(0);
    this.pending = null;
  }

  /** 登记在途请求。已有在途请求时返回 `invalidValue`，不覆盖。 */
  registerRequest(request: PendingRequest): ProtocolResult<void> {
    if (this.pending) {
      return { ok: false, error: { code: "invalidValue", detail: "requestInFlight" } };
    }
    this.pending = request;
    return { ok: true, value: undefined };
  }

  /** 取消在途请求（超时或用户中止），返回被取消的请求。 */
  cancelRequest(): PendingRequest | null {
    const pending = this.pending;
    this.pending = null;
    return pending;
  }

  /** 达到超时时间则返回并清除在途请求；未到期返回 null。 */
  expire(nowMs: number, timeoutMs: number): PendingRequest | null {
    const pending = this.pending;
    if (!pending) return null;
    if (nowMs - pending.sentAtMs < timeoutMs) return null;
    this.pending = null;
    return pending;
  }

  /**
   * 追加一段接收字节，返回其中切分出的完整报文。
   *
   * 分帧失败（如噪声导致的非法长度字段）时逐字节丢弃缓冲头部重新同步，
   * 否则坏帧会永远卡在缓冲头部，之后的正常流量也无法再切出。
   * 被丢弃的字节合并为一条解析失败的记录返回，按发生位置保持时序。
   */
  feed(chunk: Uint8Array, readAtMs: number): ReceivedFrame[] {
    let buffer = appendChunks([this.rest, chunk]);
    const frames: ReceivedFrame[] = [];
    let dropped: number[] = [];

    const flushDropped = (): void => {
      if (dropped.length === 0) return;
      frames.push({
        bytes: Uint8Array.from(dropped),
        readAtMs,
        parsed: { ok: false, error: { code: "frameTooShort", detail: "unpredictableLength" } },
        matched: null,
        mismatch: "unexpected",
      });
      dropped = [];
    };

    for (;;) {
      const result = this.split(buffer);
      if (result.frames.length > 0) flushDropped();
      frames.push(...result.frames.map((bytes) => this.describe(bytes, readAtMs)));
      this.rest = result.rest;
      if (!result.error || result.rest.length === 0) break;
      dropped.push(result.rest[0]!);
      buffer = result.rest.slice(1);
      this.rest = buffer;
    }
    flushDropped();
    return frames;
  }

  private split(buffer: Uint8Array): FramingResult {
    if (this.protocol === "tcp") return splitTcpFrames(buffer);
    if (this.protocol === "ascii") return splitAsciiFrames(buffer);
    return splitRtuFrames(buffer, this.rtuExpectedLength(buffer));
  }

  /**
   * 在途请求存在时按请求上下文给出预期帧长。
   * 异常响应固定 5 字节，先按功能码判断，避免被正常响应长度卡住而永远等不到帧。
   */
  private rtuExpectedLength(buffer: Uint8Array): number | undefined {
    const pending = this.pending;
    if (!pending) return undefined;
    if (buffer.length < 2) return undefined;
    if ((buffer[1]! & 0x80) !== 0) return MIN_RTU_FRAME_LENGTH;
    return pending.expectedLength ?? undefined;
  }

  private describe(bytes: Uint8Array, readAtMs: number): ReceivedFrame {
    const parsed = PROTOCOLS[this.protocol].parse(bytes);
    const pending = this.pending;
    if (!pending) {
      return { bytes, readAtMs, parsed, matched: null, mismatch: "unexpected" };
    }

    const mismatch = mismatchOf(this.protocol, pending, parsed);
    if (mismatch) {
      return { bytes, readAtMs, parsed, matched: null, mismatch };
    }

    this.pending = null;
    return { bytes, readAtMs, parsed, matched: pending };
  }
}
