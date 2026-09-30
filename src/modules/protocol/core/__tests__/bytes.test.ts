import { describe, expect, it } from "vite-plus/test";

import {
  bytesToHex,
  bytesToText,
  cleanHex,
  hex2,
  hex4,
  hexToBytes,
  reorderTextBytes,
  u16be,
} from "../bytes";

describe("hex input", () => {
  it("strips prefixes, separators and case", () => {
    expect(cleanHex("0x12_34 56-78")).toBe("12345678");
  });

  it("parses an even number of digits", () => {
    expect(hexToBytes("01 AB")).toEqual({ ok: true, value: Uint8Array.from([0x01, 0xab]) });
  });

  it("rejects odd digit counts instead of padding", () => {
    expect(hexToBytes("ABC")).toEqual({ ok: false, error: { code: "oddHexLength" } });
  });

  it("rejects empty input", () => {
    expect(hexToBytes("  ")).toEqual({ ok: false, error: { code: "emptyInput" } });
  });
});

describe("hex output", () => {
  it("formats bytes and 16-bit values", () => {
    expect(bytesToHex([0x01, 0xab])).toBe("01 AB");
    expect(bytesToHex([0x01, 0xab], "")).toBe("01AB");
    expect(hex2(0x1)).toBe("01");
    expect(hex4(0x1)).toBe("0001");
    expect(u16be(0x0102)).toEqual([0x01, 0x02]);
  });

  it("renders non-printable bytes as dots", () => {
    expect(bytesToText(Uint8Array.from([0x41, 0x00, 0x7f]))).toBe("A..");
  });
});

// 文本重排必须保持字节长度：这里用 5 字节（奇数尾字节）覆盖全部 4 种模式。
describe("text reordering keeps byte length", () => {
  const source = Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05]);

  it("keeps ABCD unchanged", () => {
    expect(Array.from(reorderTextBytes(source, "ABCD"))).toEqual([1, 2, 3, 4, 5]);
  });

  it("reverses every byte for DCBA", () => {
    expect(Array.from(reorderTextBytes(source, "DCBA"))).toEqual([5, 4, 3, 2, 1]);
  });

  it("swaps adjacent bytes for BADC and leaves the odd tail byte", () => {
    expect(Array.from(reorderTextBytes(source, "BADC"))).toEqual([2, 1, 4, 3, 5]);
  });

  it("swaps register halves per 4-byte group for CDAB and leaves the tail", () => {
    expect(Array.from(reorderTextBytes(source, "CDAB"))).toEqual([3, 4, 1, 2, 5]);
  });

  it("does not pad truncated groups", () => {
    expect(Array.from(reorderTextBytes(Uint8Array.from([0x01, 0x02, 0x03]), "CDAB"))).toEqual([
      1, 2, 3,
    ]);
  });
});
