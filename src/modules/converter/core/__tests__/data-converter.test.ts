import { describe, expect, it } from "vite-plus/test";

import { DATA_LAYOUTS } from "../byte-order";
import { applyLayout, removeLayout } from "../byte-order";
import { convertCell, getDataType, normalizeHex } from "../data-converter";

const [abcd, dcba, badc, cdab] = DATA_LAYOUTS;

if (!abcd || !dcba || !badc || !cdab) {
  throw new Error("Expected all four data layouts");
}

describe("byte and word order", () => {
  const canonical = Uint8Array.from([0x12, 0x34, 0x56, 0x78]);

  it.each([
    [abcd, [0x12, 0x34, 0x56, 0x78]],
    [dcba, [0x78, 0x56, 0x34, 0x12]],
    [badc, [0x34, 0x12, 0x78, 0x56]],
    [cdab, [0x56, 0x78, 0x12, 0x34]],
  ] as const)("applies %s", (layout, expected) => {
    const arranged = applyLayout(canonical, layout);
    expect(Array.from(arranged)).toEqual(expected);
    expect(removeLayout(arranged, layout)).toEqual(canonical);
  });

  it.each(DATA_LAYOUTS)("round-trips 64-bit layout $label", (layout) => {
    const bytes = Uint8Array.from([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
    expect(removeLayout(applyLayout(bytes, layout), layout)).toEqual(bytes);
  });
});

describe("hex normalization", () => {
  it("accepts prefix and separators", () => {
    expect(normalizeHex("0x12_34 56")).toMatchObject({
      compact: "123456",
      formatted: "12 34 56",
    });
  });

  it("pads an odd number of digits", () => {
    expect(normalizeHex("ABC")).toMatchObject({ compact: "0ABC", formatted: "0A BC" });
  });

  it("rejects invalid characters", () => {
    expect(normalizeHex("12-GG")).toEqual({ value: null, error: "invalidHex" });
  });
});

describe("decimal encoding", () => {
  it("encodes unsigned values in both byte orders", () => {
    expect(convertCell("4660", "decimal", getDataType("uint16"), abcd).value).toBe("12 34");
    expect(convertCell("4660", "decimal", getDataType("uint16"), dcba).value).toBe("34 12");
  });

  it("encodes signed integers using two's complement", () => {
    expect(convertCell("-1", "decimal", getDataType("int16"), abcd).value).toBe("FF FF");
  });

  it("rejects invalid integer values and overflows", () => {
    expect(convertCell("1.5", "decimal", getDataType("int16"), abcd).error).toBe("integerRequired");
    expect(convertCell("65536", "decimal", getDataType("uint16"), abcd).error).toBe("outOfRange");
  });

  it("encodes IEEE754 float32", () => {
    expect(convertCell("1", "decimal", getDataType("float32"), abcd).value).toBe("3F 80 00 00");
  });

  it("rejects finite decimal text that overflows the selected float type", () => {
    expect(convertCell("3.5e38", "decimal", getDataType("float32"), abcd).error).toBe("outOfRange");
    expect(convertCell("1e400", "decimal", getDataType("float64"), abcd).error).toBe("outOfRange");
  });

  it("preserves 64-bit integer precision", () => {
    expect(convertCell("18446744073709551615", "decimal", getDataType("uint64"), abcd).value).toBe(
      "FF FF FF FF FF FF FF FF",
    );
  });
});

describe("hex decoding", () => {
  it("decodes signed two's complement", () => {
    expect(convertCell("FFFF", "hex", getDataType("int16"), abcd).value).toBe("-1");
  });

  it("decodes all 32-bit layouts", () => {
    expect(convertCell("12 34 56 78", "hex", getDataType("uint32"), abcd).value).toBe("305419896");
    expect(convertCell("78 56 34 12", "hex", getDataType("uint32"), dcba).value).toBe("305419896");
    expect(convertCell("34 12 78 56", "hex", getDataType("uint32"), badc).value).toBe("305419896");
    expect(convertCell("56 78 12 34", "hex", getDataType("uint32"), cdab).value).toBe("305419896");
  });

  it("decodes IEEE754 special values", () => {
    expect(convertCell("7F800000", "hex", getDataType("float32"), abcd).value).toBe("Infinity");
    expect(convertCell("80000000", "hex", getDataType("float32"), abcd).value).toBe("-0");
  });

  it("rejects input wider than the target type", () => {
    expect(convertCell("123456", "hex", getDataType("uint16"), abcd).error).toBe("tooWide");
  });

  it("marks duplicate 16-bit word-order layouts as unsupported", () => {
    expect(convertCell("1234", "hex", getDataType("uint16"), badc).error).toBe("unsupportedLayout");
  });
});
