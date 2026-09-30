import { describe, expect, it } from "vite-plus/test";

import { hexToBytes } from "../bytes";
import { parseAsciiFrame, buildAsciiRequest } from "../frame-ascii";
import { buildRtuRequest, buildRtuResponse, parseRtuFrame } from "../frame-rtu";
import { buildTcpFrame, buildTcpRequest, parseTcpFrame } from "../frame-tcp";

/** 测试用：把十六进制串转为字节，失败即断言失败。 */
function bytes(hex: string): Uint8Array {
  const parsed = hexToBytes(hex);
  if (!parsed.ok) throw new Error(`bad test hex: ${hex}`);
  return parsed.value;
}

describe("RTU frames", () => {
  it("appends a little-endian CRC16", () => {
    const built = buildRtuRequest({ unit: 1, func: 3, addr: 0, qty: 2, tid: 0 });
    expect(built.text).toBe("01 03 00 00 00 02 C4 0B");
  });

  it("round-trips a request", () => {
    const built = buildRtuRequest({ unit: 1, func: 3, addr: 0, qty: 2, tid: 0 });
    const parsed = parseRtuFrame(built.bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.unit).toBe(1);
    expect(parsed.value.func).toBe(3);
    expect(parsed.value.warning).toBeUndefined();
  });

  it("parses a read response and strips the byte count", () => {
    const parsed = parseRtuFrame(bytes("01 03 0C 40 48 F5 C3 00 00 01 3A C6 FE FF FF 39 D4"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Array.from(parsed.value.data)).toEqual([
      0x40, 0x48, 0xf5, 0xc3, 0x00, 0x00, 0x01, 0x3a, 0xc6, 0xfe, 0xff, 0xff,
    ]);
    expect(parsed.value.warning).toBeUndefined();
  });

  it("flags a CRC mismatch but still returns the parsed frame", () => {
    const parsed = parseRtuFrame(bytes("01 03 0C 40 48 F5 C3 00 00 01 3A C6 FE FF FF 39 D5"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.warning?.code).toBe("crcMismatch");
  });

  it("rejects frames shorter than 5 bytes", () => {
    expect(parseRtuFrame(bytes("01 03 00 00"))).toEqual({
      ok: false,
      error: { code: "frameTooShort", detail: "4/5" },
    });
  });

  it("describes a write response by address and quantity", () => {
    const built = buildRtuResponse({ unit: 1, tid: 0 }, [0x06, 0x00, 0x10, 0x00, 0x02], "write");
    expect(built.text).toBe("01 06 00 10 00 02 09 CE");
    expect(built.lines.map((line) => line.key)).toEqual([
      "slaveAddress",
      "function",
      "startAddress",
      "quantity",
      "crc",
    ]);
  });

  it("appends byte count and data to a write-multiple request", () => {
    const built = buildRtuRequest({
      unit: 1,
      func: 0x10,
      addr: 0x0020,
      qty: 2,
      tid: 0,
      data: [0x00, 0x0a, 0x00, 0x14],
    });
    expect(built.text).toBe("01 10 00 20 00 02 04 00 0A 00 14 D1 BA");
  });
});

describe("TCP frames", () => {
  it("builds an MBAP header with the computed length", () => {
    const built = buildTcpRequest({ unit: 1, func: 3, addr: 0, qty: 2, tid: 1 });
    expect(built.text).toBe("00 01 00 00 00 06 01 03 00 00 00 02");
  });

  it("parses the MBAP header and data region", () => {
    const parsed = parseTcpFrame(bytes("00 01 00 00 00 07 01 03 04 00 01 00 02"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.transactionId).toBe(1);
    expect(parsed.value.protocolId).toBe(0);
    expect(Array.from(parsed.value.data)).toEqual([0x00, 0x01, 0x00, 0x02]);
    expect(parsed.value.warning).toBeUndefined();
  });

  it("warns on a non-zero protocol identifier", () => {
    const parsed = parseTcpFrame(bytes("00 01 00 01 00 06 01 03 00 00 00 02"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.warning?.code).toBe("protocolIdMismatch");
  });

  it("warns when the length field disagrees with the payload", () => {
    const parsed = parseTcpFrame(bytes("00 01 00 00 00 09 01 03 00 00 00 02"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.warning?.code).toBe("lengthMismatch");
  });

  it("rejects frames shorter than 8 bytes", () => {
    const parsed = parseTcpFrame(bytes("00 01 00 00 00 06 01"));
    expect(parsed.ok).toBe(false);
  });

  it("keeps MBAP length in sync with the PDU", () => {
    const built = buildTcpFrame(7, 0x11, [0x10, 0x00, 0x01, 0x00, 0x02, 0x04, 0x00, 0x01]);
    expect(built.text).toBe("00 07 00 00 00 09 11 10 00 01 00 02 04 00 01");
  });
});

describe("ASCII frames", () => {
  it("wraps the body with a colon, an LRC and CR LF metadata", () => {
    const built = buildAsciiRequest({ unit: 1, func: 3, addr: 0, qty: 2, tid: 0 });
    expect(built.text).toBe(":010300000002FA");
    expect(built.lines.at(-1)).toEqual({ key: "frameEnd", value: "CR LF (0D 0A)" });
  });

  it("parses hex bytes without the colon", () => {
    const parsed = parseAsciiFrame(bytes("01 03 00 00 00 02 FA"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.unit).toBe(1);
    expect(parsed.value.warning).toBeUndefined();
  });

  it("parses a raw ASCII byte stream that starts with a colon", () => {
    const raw = Uint8Array.from(":010300000002FA", (char) => char.charCodeAt(0));
    const parsed = parseAsciiFrame(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.func).toBe(3);
  });

  it("flags an LRC mismatch", () => {
    const parsed = parseAsciiFrame(bytes("01 03 00 00 00 02 FB"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.warning?.code).toBe("lrcMismatch");
  });

  it("rejects an odd number of hex digits in a raw frame", () => {
    const raw = Uint8Array.from(":010300000002F", (char) => char.charCodeAt(0));
    expect(parseAsciiFrame(raw)).toEqual({ ok: false, error: { code: "oddHexLength" } });
  });

  it("rejects frames shorter than 3 bytes", () => {
    const parsed = parseAsciiFrame(bytes("01 03"));
    expect(parsed.ok).toBe(false);
  });
});
