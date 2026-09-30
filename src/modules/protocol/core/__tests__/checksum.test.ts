import { describe, expect, it } from "vite-plus/test";

import { crc16Bytes, crc16Modbus, lrc } from "../checksum";

// 已知向量取自原网页版内置示例，避免"自算自证"。
const READ_REQUEST = [0x01, 0x03, 0x00, 0x00, 0x00, 0x02];
const READ_RESPONSE_BODY = [
  0x01, 0x03, 0x0c, 0x40, 0x48, 0xf5, 0xc3, 0x00, 0x00, 0x01, 0x3a, 0xc6, 0xfe, 0xff, 0xff,
];

describe("Modbus checksums", () => {
  it("computes CRCs in little-endian wire order", () => {
    expect(crc16Bytes(READ_REQUEST)).toEqual([0xc4, 0x0b]);
    expect(crc16Bytes(READ_RESPONSE_BODY)).toEqual([0x39, 0xd4]);
  });

  it("exposes the numeric CRC value", () => {
    expect(crc16Modbus(READ_REQUEST)).toBe(0x0bc4);
    expect(crc16Modbus(READ_RESPONSE_BODY)).toBe(0xd439);
  });

  it("computes LRC as the two's complement of the byte sum", () => {
    expect(lrc(READ_REQUEST)).toBe(0xfa);
  });

  it("returns zero LRC for an empty payload", () => {
    expect(lrc([])).toBe(0x00);
  });
});
