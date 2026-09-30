import { describe, expect, it } from "vite-plus/test";

import type { DecodedValue, ParseRule } from "../parse-rules";
import {
  decodeRule,
  formatDecodedValue,
  layoutsForDataType,
  regionByteOffset,
  scaleDecoded,
  toChartNumber,
} from "../parse-rules";

type NumericType =
  | "uint16"
  | "int16"
  | "uint32"
  | "int32"
  | "uint64"
  | "int64"
  | "float32"
  | "float64";
type LayoutName = "abcd" | "dcba" | "badc" | "cdab";

function numeric(dataType: NumericType, layout: LayoutName, offset = 0): ParseRule {
  return { kind: "numeric", id: 1, offset, dataType, layout };
}

function data(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function decodedValue(result: ReturnType<typeof decodeRule>): DecodedValue {
  if (!result.ok) throw new Error(`decode failed: ${result.error.code}`);
  return result.value.decoded;
}

describe("layout availability", () => {
  it("offers only abcd/dcba for 16-bit types", () => {
    expect(layoutsForDataType("uint16").map((layout) => layout.id)).toEqual(["abcd", "dcba"]);
  });

  it("offers all four layouts for 32-bit and 64-bit types", () => {
    expect(layoutsForDataType("uint32")).toHaveLength(4);
    expect(layoutsForDataType("float64")).toHaveLength(4);
  });
});

describe("numeric decoding", () => {
  it("decodes 16-bit values in both layouts", () => {
    expect(decodedValue(decodeRule(data(0x12, 0x34), numeric("uint16", "abcd")))).toEqual({
      kind: "integer",
      value: 4660n,
    });
    expect(decodedValue(decodeRule(data(0x34, 0x12), numeric("uint16", "dcba")))).toEqual({
      kind: "integer",
      value: 4660n,
    });
  });

  it("decodes all 32-bit layouts to the same value", () => {
    const expected = { kind: "integer", value: 305419896n } as const;
    expect(
      decodedValue(decodeRule(data(0x12, 0x34, 0x56, 0x78), numeric("uint32", "abcd"))),
    ).toEqual(expected);
    expect(
      decodedValue(decodeRule(data(0x78, 0x56, 0x34, 0x12), numeric("uint32", "dcba"))),
    ).toEqual(expected);
    expect(
      decodedValue(decodeRule(data(0x34, 0x12, 0x78, 0x56), numeric("uint32", "badc"))),
    ).toEqual(expected);
    expect(
      decodedValue(decodeRule(data(0x56, 0x78, 0x12, 0x34), numeric("uint32", "cdab"))),
    ).toEqual(expected);
  });

  // 兼容性说明：64 位 CDAB 采用 Toolbox 语义（整体寄存器字序反转）。
  // 原网页版按相邻寄存器对交换，同样输入会得到不同的数值，属于已知差异。
  it("decodes 64-bit values, including the CDAB divergence", () => {
    const canonical = data(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08);
    expect(decodedValue(decodeRule(canonical, numeric("uint64", "abcd")))).toEqual({
      kind: "integer",
      value: 0x0102030405060708n,
    });
    expect(
      decodedValue(
        decodeRule(data(0x07, 0x08, 0x05, 0x06, 0x03, 0x04, 0x01, 0x02), numeric("uint64", "cdab")),
      ),
    ).toEqual({ kind: "integer", value: 0x0102030405060708n });
    expect(
      decodedValue(
        decodeRule(data(0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01), numeric("uint64", "dcba")),
      ),
    ).toEqual({ kind: "integer", value: 0x0102030405060708n });
  });

  it("keeps full precision for 64-bit integers", () => {
    const all = data(...Array.from({ length: 8 }, () => 0xff));
    expect(decodedValue(decodeRule(all, numeric("uint64", "abcd")))).toEqual({
      kind: "integer",
      value: 18446744073709551615n,
    });
    expect(decodedValue(decodeRule(all, numeric("int64", "abcd")))).toEqual({
      kind: "integer",
      value: -1n,
    });
  });

  it("decodes signed values and IEEE754 floats", () => {
    expect(decodedValue(decodeRule(data(0xff, 0xff), numeric("int16", "abcd")))).toEqual({
      kind: "integer",
      value: -1n,
    });
    expect(
      decodedValue(decodeRule(data(0x3f, 0x80, 0x00, 0x00), numeric("float32", "abcd"))),
    ).toEqual({
      kind: "float",
      value: 1,
    });
    const nan = decodedValue(decodeRule(data(0x7f, 0xc0, 0x00, 0x00), numeric("float32", "abcd")));
    expect(nan.kind).toBe("float");
    expect(Number.isNaN(nan.kind === "float" ? nan.value : 0)).toBe(true);
  });

  it("rejects incomplete data instead of padding with zeros", () => {
    expect(decodeRule(data(0x12, 0x34, 0x56), numeric("uint32", "abcd"))).toEqual({
      ok: false,
      error: { code: "insufficientData", detail: "3/4" },
    });
  });

  it("rejects negative offsets and slices beyond the data region", () => {
    expect(decodeRule(data(0x12, 0x34), numeric("uint16", "abcd", -1))).toEqual({
      ok: false,
      error: { code: "offsetOutOfRange", detail: "-1" },
    });
    expect(decodeRule(data(0x12, 0x34, 0x56, 0x78), numeric("uint32", "abcd", 2))).toEqual({
      ok: false,
      error: { code: "insufficientData", detail: "2/4" },
    });
  });

  it("rejects word-order layouts that are meaningless for 16-bit data", () => {
    expect(decodeRule(data(0x12, 0x34), numeric("uint16", "badc"))).toEqual({
      ok: false,
      error: { code: "unsupportedLayout", detail: "badc" },
    });
  });
});

describe("text decoding", () => {
  const rule = (
    offset: number,
    length: number,
    order: "ABCD" | "DCBA" | "BADC" | "CDAB",
  ): ParseRule => ({
    kind: "text",
    id: 2,
    offset,
    length,
    order,
  });

  it("keeps all four reorder modes and preserves byte length", () => {
    const source = data(0x01, 0x02, 0x03, 0x04, 0x05);
    const decode = (order: "ABCD" | "DCBA" | "BADC" | "CDAB") => {
      const result = decodeRule(source, rule(0, 5, order));
      if (!result.ok) throw new Error(result.error.code);
      return Array.from(result.value.ordered);
    };
    expect(decode("ABCD")).toEqual([1, 2, 3, 4, 5]);
    expect(decode("DCBA")).toEqual([5, 4, 3, 2, 1]);
    expect(decode("BADC")).toEqual([2, 1, 4, 3, 5]);
    expect(decode("CDAB")).toEqual([3, 4, 1, 2, 5]);
  });

  it("renders the reordered bytes as text", () => {
    const result = decodeRule(data(0x32, 0x31, 0x30), rule(0, 3, "DCBA"));
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.decoded).toEqual({ kind: "text", value: "012" });
  });

  it("rejects text rules that exceed the available bytes", () => {
    expect(decodeRule(data(0x41, 0x42), rule(0, 5, "ABCD"))).toEqual({
      ok: false,
      error: { code: "insufficientData", detail: "2/5" },
    });
    expect(decodeRule(data(0x41), rule(0, 0, "ABCD"))).toEqual({
      ok: false,
      error: { code: "insufficientData", detail: "0/0" },
    });
  });
});

describe("value formatting, plotting and scaling", () => {
  it("exports integers exactly and floats with optional decimals", () => {
    expect(formatDecodedValue({ kind: "integer", value: 18446744073709551615n })).toBe(
      "18446744073709551615",
    );
    expect(formatDecodedValue({ kind: "float", value: 1.5 })).toBe("1.5");
    expect(formatDecodedValue({ kind: "float", value: 1.5 }, 2)).toBe("1.50");
    expect(formatDecodedValue({ kind: "float", value: Number.POSITIVE_INFINITY })).toBe("Infinity");
    expect(formatDecodedValue({ kind: "text", value: "v1.2" })).toBe("v1.2");
  });

  it("only converts to number at the plotting boundary", () => {
    expect(toChartNumber({ kind: "integer", value: 4660n })).toBe(4660);
    expect(toChartNumber({ kind: "integer", value: 18446744073709551615n })).toBeNull();
    expect(toChartNumber({ kind: "float", value: Number.NaN })).toBeNull();
    expect(toChartNumber({ kind: "text", value: "v1.2" })).toBeNull();
  });

  it("scales integers exactly when the factors are integers", () => {
    expect(scaleDecoded({ kind: "integer", value: 1234n }, { factor: "10", offset: "5" })).toEqual({
      ok: true,
      value: { kind: "integer", value: 12345n },
    });
  });

  it("refuses to scale huge integers with a fractional factor", () => {
    expect(
      scaleDecoded(
        { kind: "integer", value: 18446744073709551615n },
        { factor: "0.1", offset: "" },
      ),
    ).toEqual({ ok: false, error: { code: "scaleOverflow", detail: "integerScaleRequiresFloat" } });
  });

  it("scales floats", () => {
    expect(scaleDecoded({ kind: "float", value: 100 }, { factor: "0.1", offset: "-40" })).toEqual({
      ok: true,
      value: { kind: "float", value: -30 },
    });
  });
});

describe("region addressing", () => {
  it("maps register addresses at two bytes each", () => {
    const region = { baseAddr: 0x0010, func: 0x04, data: data(0x00, 0x0a, 0x00, 0x14) };
    expect(regionByteOffset(region, 0x0010, 2)).toBe(0);
    expect(regionByteOffset(region, 0x0011, 2)).toBe(2);
  });

  it("returns null below the region start", () => {
    const region = { baseAddr: 0x0010, func: 0x03, data: data(0x00, 0x0a) };
    expect(regionByteOffset(region, 0x000f, 2)).toBeNull();
  });

  it("returns null instead of reading past the region", () => {
    const region = { baseAddr: 0x0010, func: 0x03, data: data(0x00, 0x0a) };
    expect(regionByteOffset(region, 0x0011, 2)).toBeNull();
    expect(regionByteOffset(region, 0x0010, 4)).toBeNull();
  });

  it("addresses bit regions by bit and requires alignment", () => {
    const region = { baseAddr: 0x0020, func: 0x01, data: data(0x0f, 0xf0) };
    expect(regionByteOffset(region, 0x0020, 1)).toBe(0);
    expect(regionByteOffset(region, 0x0028, 1)).toBe(1);
    expect(regionByteOffset(region, 0x0024, 1)).toBeNull();
  });

  it("keeps each region addressable from its own base", () => {
    const first = { baseAddr: 0, func: 0x04, data: data(0x00, 0x1d) };
    const second = { baseAddr: 1, func: 0x04, data: data(0x00, 0x2a) };
    expect(regionByteOffset(first, 0, 2)).toBe(0);
    expect(regionByteOffset(second, 1, 2)).toBe(0);
    expect(regionByteOffset(first, 1, 2)).toBeNull();
  });
});
