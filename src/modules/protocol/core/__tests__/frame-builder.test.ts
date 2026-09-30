import { describe, expect, it } from "vite-plus/test";

import {
  buildResponsePdu,
  encodeValuesInLayout,
  parseNumberInput,
  responseFieldPlan,
} from "../frame-builder";

describe("parseNumberInput", () => {
  it("treats an empty input as zero", () => {
    expect(parseNumberInput("", "hex", 2)).toEqual({ ok: true, value: 0 });
  });

  it("parses hex and decimal widths", () => {
    expect(parseNumberInput("0010", "hex", 2)).toEqual({ ok: true, value: 16 });
    expect(parseNumberInput("255", "decimal", 1)).toEqual({ ok: true, value: 255 });
    expect(parseNumberInput("0x20", "hex", 2)).toEqual({ ok: true, value: 32 });
  });

  it("wraps negatives to two's complement within the width", () => {
    expect(parseNumberInput("-1", "decimal", 2)).toEqual({ ok: true, value: 0xffff });
    expect(parseNumberInput("-1", "decimal", 1)).toEqual({ ok: true, value: 0xff });
  });

  it("rejects non-numeric input", () => {
    expect(parseNumberInput("zz", "hex", 2)).toEqual({
      ok: false,
      error: { code: "invalidValue", detail: "zz" },
    });
  });
});

describe("encodeValuesInLayout", () => {
  it("encodes uint16 big-endian words", () => {
    expect(encodeValuesInLayout("1, 2", "uint16", "abcd")).toEqual({
      ok: true,
      value: [0x00, 0x01, 0x00, 0x02],
    });
  });

  it("encodes uint16 little-endian words", () => {
    expect(encodeValuesInLayout("1", "uint16", "dcba")).toEqual({
      ok: true,
      value: [0x01, 0x00],
    });
  });

  it("encodes float32 and reorders bytes", () => {
    expect(encodeValuesInLayout("1.5", "float32", "abcd")).toEqual({
      ok: true,
      value: [0x3f, 0xc0, 0x00, 0x00],
    });
    expect(encodeValuesInLayout("1.5", "float32", "badc")).toEqual({
      ok: true,
      value: [0xc0, 0x3f, 0x00, 0x00],
    });
  });

  it("rejects unsupported layouts for 16-bit types", () => {
    expect(encodeValuesInLayout("1", "uint16", "badc")).toEqual({
      ok: false,
      error: { code: "unsupportedLayout", detail: "badc" },
    });
  });

  it("reports out-of-range and invalid values", () => {
    expect(encodeValuesInLayout("70000", "uint16", "abcd")).toEqual({
      ok: false,
      error: { code: "outOfRange", detail: "70000" },
    });
    expect(encodeValuesInLayout("abc", "uint16", "abcd")).toEqual({
      ok: false,
      error: { code: "invalidValue", detail: "abc" },
    });
  });
});

describe("responseFieldPlan", () => {
  it("shows only the data region for custom functions", () => {
    const plan = responseFieldPlan(0x99, true);
    expect(plan.show).toEqual({
      addr: false,
      qty: false,
      type: false,
      order: false,
      values: false,
      data: true,
    });
  });

  it("shows quantity and bit values for read-bits", () => {
    const plan = responseFieldPlan(0x01, false);
    expect(plan.show.qty).toBe(true);
    expect(plan.show.values).toBe(true);
    expect(plan.show.addr).toBe(false);
    expect(plan.qtyLabel).toBe("coilQuantity");
    expect(plan.valuesLabel).toBe("bitList");
    expect(plan.qtyBits).toBe(true);
  });

  it("shows type and order for read-registers", () => {
    const plan = responseFieldPlan(0x03, false);
    expect(plan.show.type).toBe(true);
    expect(plan.show.order).toBe(true);
    expect(plan.qtyLabel).toBe("registerQuantity");
    expect(plan.qtyBits).toBe(false);
  });

  it("labels the single-coil value field", () => {
    expect(responseFieldPlan(0x05, false).valuesLabel).toBe("coilValue");
    expect(responseFieldPlan(0x06, false).valuesLabel).toBe("value");
  });

  it("uses address and quantity for write-multiple-coils", () => {
    const plan = responseFieldPlan(0x0f, false);
    expect(plan.show.addr).toBe(true);
    expect(plan.show.qty).toBe(true);
    expect(plan.qtyLabel).toBe("coilQuantity");
    expect(plan.qtyBits).toBe(true);
  });
});

describe("buildResponsePdu", () => {
  const base = {
    custom: false,
    func: 0x03,
    addr: 0,
    qty: 2,
    format: "hex" as const,
    values: "",
    data: "",
    dataType: "uint16" as const,
    layout: "abcd" as const,
  };

  it("builds a read-registers response with a byte count", () => {
    const built = buildResponsePdu({ ...base, values: "1, 2" });
    expect(built).toEqual({
      ok: true,
      value: { pdu: [0x03, 0x04, 0x00, 0x01, 0x00, 0x02], kind: "read" },
    });
  });

  it("pads missing registers and truncates extra ones to the declared quantity", () => {
    expect(buildResponsePdu({ ...base, qty: 3, values: "1" })).toEqual({
      ok: true,
      value: { pdu: [0x03, 0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00], kind: "read" },
    });
    expect(buildResponsePdu({ ...base, qty: 1, values: "1, 2" })).toEqual({
      ok: true,
      value: { pdu: [0x03, 0x02, 0x00, 0x01], kind: "read" },
    });
  });

  it("packs read-bits into the smallest byte count", () => {
    const built = buildResponsePdu({ ...base, func: 0x01, qty: 10, values: "1,0,1" });
    expect(built).toEqual({
      ok: true,
      value: { pdu: [0x01, 0x02, 0x05, 0x00], kind: "read" },
    });
  });

  it("echoes address and value for write-single", () => {
    const built = buildResponsePdu({
      ...base,
      func: 0x06,
      addr: 0x10,
      values: "0002",
    });
    expect(built).toEqual({
      ok: true,
      value: { pdu: [0x06, 0x00, 0x10, 0x00, 0x02], kind: "write" },
    });
  });

  it("echoes address and quantity for write-multiple", () => {
    const built = buildResponsePdu({ ...base, func: 0x10, addr: 0x20, qty: 0x03 });
    expect(built).toEqual({
      ok: true,
      value: { pdu: [0x10, 0x00, 0x20, 0x00, 0x03], kind: "write" },
    });
  });

  it("builds a custom response from the hex data region", () => {
    expect(buildResponsePdu({ ...base, custom: true, func: 0x41, data: "0A 0B" })).toEqual({
      ok: true,
      value: { pdu: [0x41, 0x0a, 0x0b], kind: "custom" },
    });
  });

  it("allows an empty custom data region", () => {
    expect(buildResponsePdu({ ...base, custom: true, func: 0x41, data: "" })).toEqual({
      ok: true,
      value: { pdu: [0x41], kind: "custom" },
    });
  });

  it("propagates encoding errors", () => {
    const built = buildResponsePdu({ ...base, values: "70000" });
    expect(built).toEqual({ ok: false, error: { code: "outOfRange", detail: "70000" } });
  });
});
