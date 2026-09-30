import { describe, expect, it } from "vite-plus/test";

import { DebugSession, expectedRtuResponseLength } from "../debug-session";
import type { PendingRequest } from "../debug-session";
import { buildAsciiFrame } from "../frame-ascii";
import { buildRtuFrame } from "../frame-rtu";
import { buildTcpFrame } from "../frame-tcp";

/** 读保持寄存器 2 个的正常响应：站号 + 功能码 + 字节数 + 4 数据 + CRC = 9 字节。 */
const RTU_OK = buildRtuFrame(1, [0x03, 0x04, 0x00, 0x01, 0x00, 0x02]).bytes;
const RTU_EXCEPTION = buildRtuFrame(1, [0x83, 0x02]).bytes;

function request(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    unit: 1,
    func: 0x03,
    addr: 0,
    qty: 2,
    tid: null,
    sentAtMs: 0,
    expectedLength: 9,
    ...overrides,
  };
}

/** ASCII 帧在线路上是文本字符，并以 CR LF 结尾。 */
function asciiWire(text: string): Uint8Array {
  return Uint8Array.from(`${text}\r\n`, (char) => char.charCodeAt(0));
}

describe("expectedRtuResponseLength", () => {
  it("predicts read-register and read-bit responses", () => {
    expect(expectedRtuResponseLength(request({ func: 0x03, qty: 2 }))).toBe(9);
    expect(expectedRtuResponseLength(request({ func: 0x04, qty: 1 }))).toBe(7);
    expect(expectedRtuResponseLength(request({ func: 0x01, qty: 10 }))).toBe(7);
  });

  it("returns 8 for write responses and null when unpredictable", () => {
    expect(expectedRtuResponseLength(request({ func: 0x06 }))).toBe(8);
    expect(expectedRtuResponseLength(request({ func: 0x10 }))).toBe(8);
    expect(expectedRtuResponseLength(request({ func: 0x64 }))).toBeNull();
    expect(expectedRtuResponseLength(request({ func: 0x03, qty: 200 }))).toBeNull();
  });
});

describe("DebugSession RTU", () => {
  it("reassembles a split response and clears the pending request", () => {
    const session = new DebugSession("rtu");
    expect(RTU_OK).toHaveLength(9);
    expect(session.registerRequest(request()).ok).toBe(true);

    expect(session.feed(RTU_OK.slice(0, 4), 10)).toHaveLength(0);
    expect(session.getBuffered()).toHaveLength(4);

    const frames = session.feed(RTU_OK.slice(4), 20);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.matched).not.toBeNull();
    expect(frames[0]?.mismatch).toBeUndefined();
    expect(frames[0]?.parsed.ok).toBe(true);
    expect(session.getPending()).toBeNull();
  });

  it("marks a frame with no pending request as unexpected", () => {
    const session = new DebugSession("rtu");
    const frames = session.feed(RTU_OK, 10);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.matched).toBeNull();
    expect(frames[0]?.mismatch).toBe("unexpected");
  });

  it("still splits an exception frame even when a longer response is expected", () => {
    const session = new DebugSession("rtu");
    session.registerRequest(request({ qty: 2, expectedLength: 9 }));

    const frames = session.feed(RTU_EXCEPTION, 10);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.matched).not.toBeNull();
    expect(session.getPending()).toBeNull();
  });

  it("reports unit and function mismatches", () => {
    const session = new DebugSession("rtu");
    session.registerRequest(request({ unit: 1, func: 0x03 }));

    const otherFunction = buildRtuFrame(1, [0x04, 0x04, 0x00, 0x01, 0x00, 0x02]).bytes;
    expect(session.feed(otherFunction, 10)[0]?.mismatch).toBe("function");
    expect(session.getPending()).not.toBeNull();

    const otherUnit = buildRtuFrame(2, [0x03, 0x04, 0x00, 0x01, 0x00, 0x02]).bytes;
    expect(session.feed(otherUnit, 20)[0]?.mismatch).toBe("unit");
    expect(session.getPending()).not.toBeNull();
  });

  it("expires the pending request only after the timeout", () => {
    const session = new DebugSession("rtu");
    session.registerRequest(request({ sentAtMs: 1000 }));
    expect(session.expire(1500, 1000)).toBeNull();
    expect(session.expire(2000, 1000)).not.toBeNull();
    expect(session.getPending()).toBeNull();
  });

  it("rejects a second in-flight request", () => {
    const session = new DebugSession("rtu");
    expect(session.registerRequest(request()).ok).toBe(true);
    expect(session.registerRequest(request()).ok).toBe(false);
  });

  it("recovers from garbage bytes by resynchronizing instead of getting stuck", () => {
    const session = new DebugSession("rtu");

    // 无在途请求时按内容预测帧长；0x07 / 0x11 功能码不可预测，逐字节丢弃后
    // 缓冲必须能对齐到后续的正常帧，而不是永远卡住。
    const frame = buildRtuFrame(0x11, [0x03, 0x04, 0x00, 0x01, 0x00, 0x02]).bytes;
    const frames = session.feed(Uint8Array.from([0x07, 0x07, ...frame]), 10);

    expect(frames).toHaveLength(2);
    expect(frames[0]?.parsed.ok).toBe(false);
    expect(Array.from(frames[0]?.bytes ?? [])).toEqual([0x07, 0x07]);
    expect(frames[0]?.matched).toBeNull();
    expect(frames[1]?.parsed.ok).toBe(true);
    expect(Array.from(frames[1]?.bytes ?? [])).toEqual(Array.from(frame));
    expect(session.getBuffered()).toHaveLength(0);
  });

  it("does not consume the pending request on a checksum warning", () => {
    const session = new DebugSession("rtu");
    session.registerRequest(request());

    // 翻转最后一字节制造 CRC 错误；帧仍按预期长度切出，但不得匹配。
    const corrupted = Uint8Array.from(RTU_OK);
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 0xff;
    const frames = session.feed(corrupted, 10);

    expect(frames).toHaveLength(1);
    expect(frames[0]?.matched).toBeNull();
    expect(frames[0]?.mismatch).toBe("unexpected");
    expect(session.getPending()).not.toBeNull();
  });

  it("rejects a read response whose data length does not match the request", () => {
    const session = new DebugSession("rtu");
    session.registerRequest(request({ qty: 2, expectedLength: null }));

    // 请求 2 个寄存器（应为 4 字节数据），响应却只有 2 字节数据。
    const short = buildRtuFrame(1, [0x03, 0x02, 0x00, 0x01]).bytes;
    const frames = session.feed(short, 10);
    expect(frames[0]?.mismatch).toBe("data");
    expect(session.getPending()).not.toBeNull();
  });

  it("rejects a write echo with a different address", () => {
    const session = new DebugSession("rtu");
    session.registerRequest(request({ func: 0x06, addr: 0x0010, expectedLength: 8 }));

    const echo = buildRtuFrame(1, [0x06, 0x00, 0x20, 0x00, 0x02]).bytes;
    const frames = session.feed(echo, 10);
    expect(frames[0]?.mismatch).toBe("data");
    expect(session.getPending()).not.toBeNull();

    const matching = buildRtuFrame(1, [0x06, 0x00, 0x10, 0x00, 0x02]).bytes;
    expect(session.feed(matching, 20)[0]?.matched).not.toBeNull();
    expect(session.getPending()).toBeNull();
  });

  it("clears buffer and pending request when the protocol changes", () => {
    const session = new DebugSession("rtu");
    session.registerRequest(request());
    session.feed(RTU_OK.slice(0, 4), 10);
    session.setProtocol("tcp");
    expect(session.getBuffered()).toHaveLength(0);
    expect(session.getPending()).toBeNull();
  });
});

describe("DebugSession TCP", () => {
  it("matches by transaction id and rejects a foreign one", () => {
    const session = new DebugSession("tcp");
    session.registerRequest(request({ tid: 1, expectedLength: null }));

    const foreign = buildTcpFrame(2, 1, [0x03, 0x04, 0x00, 0x01, 0x00, 0x02]).bytes;
    const foreignFrames = session.feed(foreign, 10);
    expect(foreignFrames[0]?.mismatch).toBe("tid");
    expect(session.getPending()).not.toBeNull();

    const matching = buildTcpFrame(1, 1, [0x03, 0x04, 0x00, 0x01, 0x00, 0x02]).bytes;
    const matchingFrames = session.feed(matching, 20);
    expect(matchingFrames[0]?.matched).not.toBeNull();
    expect(session.getPending()).toBeNull();
  });
});

describe("DebugSession ASCII", () => {
  it("splits a text frame across chunks and matches it", () => {
    const session = new DebugSession("ascii");
    session.registerRequest(request({ expectedLength: null }));

    const wire = asciiWire(buildAsciiFrame(1, [0x03, 0x04, 0x00, 0x01, 0x00, 0x02]).text);
    expect(session.feed(wire.slice(0, 5), 10)).toHaveLength(0);

    const frames = session.feed(wire.slice(5), 20);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.matched).not.toBeNull();
    expect(frames[0]?.parsed.ok).toBe(true);
    expect(session.getPending()).toBeNull();
  });
});
