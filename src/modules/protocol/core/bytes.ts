/** 报文工具的基础字节处理，行为对齐原网页版 `common.js`。 */

import type { ProtocolResult } from "./types";

/** 文本重排模式，语义与 `common.js` 的 `reorder()` 完全一致（保持字节长度）。 */
export type TextOrder = "ABCD" | "DCBA" | "BADC" | "CDAB";

export const TEXT_ORDERS = ["ABCD", "DCBA", "BADC", "CDAB"] as const satisfies readonly TextOrder[];

/** 去掉 `0x` 前缀与非十六进制字符并转为大写，用于宽松识别用户输入。 */
export function cleanHex(input: string): string {
  return input
    .replace(/0x/gi, "")
    .replace(/[^0-9a-fA-F]/g, "")
    .toUpperCase();
}

/** 输入中是否含有可解析的十六进制字符。 */
export function hasHexDigits(input: string): boolean {
  return /[0-9a-fA-F]/.test(input);
}

/**
 * 十六进制串 -> 字节。
 * 奇数长度视为错误（`oddHexLength`），不做补零，避免把残缺报表当成完整报文。
 */
export function hexToBytes(input: string): ProtocolResult<Uint8Array> {
  const compact = cleanHex(input);
  if (compact.length === 0) return { ok: false, error: { code: "emptyInput" } };
  if (compact.length % 2 !== 0) return { ok: false, error: { code: "oddHexLength" } };

  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  }
  return { ok: true, value: bytes };
}

export function bytesToHex(bytes: Uint8Array | readonly number[], separator = " "): string {
  return Array.from(bytes, (byte) => hex2(byte)).join(separator);
}

/** 按位掩码格式化为固定宽度的大写十六进制文本。 */
export function pad(value: number, width: number, base: 10 | 16 = 10): string {
  return (value >>> 0).toString(base).toUpperCase().padStart(width, "0");
}

export function hex2(value: number): string {
  return pad(value & 0xff, 2, 16);
}

export function hex4(value: number): string {
  return pad(value & 0xffff, 4, 16);
}

/** 16 位数值 -> 大端字节对。 */
export function u16be(value: number): [number, number] {
  return [(value >> 8) & 0xff, value & 0xff];
}

export function readU16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

/**
 * 文本重排：按实际字节长度重排，不补零。
 * - ABCD：原序。
 * - DCBA：整体反转。
 * - BADC：相邻字节两两交换，奇数尾字节保持原值。
 * - CDAB：每 4 字节为一组交换前后两个寄存器（`abcd` -> `cdab`），不足 4 字节的尾部保持原值。
 *
 * 注意：该函数服务于 ASCII 文本规则，与数值解析使用的 `removeLayout()` 不同，
 * 后者按 Toolbox 的字序定义（64 位 CDAB 为整体字序反转）。
 */
export function reorderTextBytes(bytes: Uint8Array, order: TextOrder): Uint8Array {
  const out = Uint8Array.from(bytes);
  switch (order) {
    case "ABCD":
      return out;
    case "DCBA":
      out.reverse();
      return out;
    case "BADC":
      for (let index = 0; index + 1 < out.length; index += 2) {
        const first = out[index] ?? 0;
        out[index] = out[index + 1] ?? 0;
        out[index + 1] = first;
      }
      return out;
    case "CDAB":
      for (let index = 0; index + 3 < out.length; index += 4) {
        const a = out[index] ?? 0;
        const b = out[index + 1] ?? 0;
        out[index] = out[index + 2] ?? 0;
        out[index + 1] = out[index + 3] ?? 0;
        out[index + 2] = a;
        out[index + 3] = b;
      }
      return out;
  }
}

/** 可打印字符视图，非可打印字节以 `.` 占位。 */
export function bytesToText(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".",
  ).join("");
}
