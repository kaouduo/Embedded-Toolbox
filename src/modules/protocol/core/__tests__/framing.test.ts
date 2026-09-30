import { describe, expect, it } from "vite-plus/test";

import {
  appendChunks,
  predictRtuFrameLength,
  splitAsciiFrames,
  splitRtuFrames,
  splitTcpFrames,
} from "../framing";
import { buildRtuFrame } from "../frame-rtu";
import { buildTcpFrame } from "../frame-tcp";
import { hexToBytes } from "../bytes";

function bytes(hex: string): Uint8Array {
  const parsed = hexToBytes(hex);
  if (!parsed.ok) throw new Error(`bad test hex: ${hex}`);
  return parsed.value;
}

const RTU_RESPONSE = bytes("01 03 0C 40 48 F5 C3 00 00 01 3A C6 FE FF FF 39 D4");

describe("TCP framing", () => {
  const first = buildTcpFrame(1, 1, [0x03, 0x00, 0x00, 0x00, 0x02]).bytes;
  const second = buildTcpFrame(2, 1, [0x03, 0x04, 0x00, 0x01, 0x00, 0x02]).bytes;

  it("splits concatenated frames using the MBAP length", () => {
    const result = splitTcpFrames(appendChunks([first, second]));
    expect(result.frames).toHaveLength(2);
    expect(result.frames[0]).toEqual(first);
    expect(result.frames[1]).toEqual(second);
    expect(result.rest).toHaveLength(0);
  });

  it("keeps a partial frame in the remainder", () => {
    const result = splitTcpFrames(appendChunks([first, second.slice(0, 4)]));
    expect(result.frames).toHaveLength(1);
    expect(result.rest).toHaveLength(4);
  });

  it("reports an out-of-range length field", () => {
    const result = splitTcpFrames(bytes("00 01 00 00 00 01 00 01"));
    expect(result.frames).toHaveLength(0);
    expect(result.error?.code).toBe("invalidLengthField");
  });
});

describe("RTU framing", () => {
  it("predicts the response length from the byte count", () => {
    expect(predictRtuFrameLength(RTU_RESPONSE)).toBe(17);
    expect(predictRtuFrameLength(bytes("01 06 00 10 00 02 6C 0A"))).toBe(8);
    expect(predictRtuFrameLength(bytes("01 83 02 C0 F1"))).toBe(5);
    expect(predictRtuFrameLength(bytes("01 45 00 00"))).toBeNull();
  });

  it("splits back-to-back responses when no request context is given", () => {
    const result = splitRtuFrames(appendChunks([RTU_RESPONSE, RTU_RESPONSE]));
    expect(result.frames).toHaveLength(2);
    expect(result.rest).toHaveLength(0);
  });

  it("limits a single pending request to one frame", () => {
    const request = buildRtuFrame(1, [0x03, 0x00, 0x00, 0x00, 0x02]).bytes;
    const result = splitRtuFrames(appendChunks([request, request]), 8);
    expect(result.frames).toHaveLength(1);
    expect(result.rest).toHaveLength(8);
  });

  it("waits for the remaining bytes of a partial frame", () => {
    const result = splitRtuFrames(RTU_RESPONSE.slice(0, 10), 17);
    expect(result.frames).toHaveLength(0);
    expect(result.rest).toHaveLength(10);
  });

  it("reports an unpredictable length instead of guessing", () => {
    const result = splitRtuFrames(bytes("01 45 00 00 00"));
    expect(result.frames).toHaveLength(0);
    expect(result.error?.detail).toBe("unpredictableLength");
  });
});

describe("ASCII framing", () => {
  const frameText = ":010300000002FA";
  const toBytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

  it("splits frames on CR LF and drops the terminator", () => {
    const result = splitAsciiFrames(toBytes(`${frameText}\r\n${frameText}\r\n`));
    expect(result.frames).toHaveLength(2);
    expect(result.rest).toHaveLength(0);
    expect(Array.from(result.frames[0] ?? [])).toEqual(Array.from(toBytes(frameText)));
  });

  it("keeps an unterminated frame in the remainder", () => {
    const result = splitAsciiFrames(toBytes(":0103\r"));
    expect(result.frames).toHaveLength(0);
    expect(result.rest).toHaveLength(6);
  });
});
