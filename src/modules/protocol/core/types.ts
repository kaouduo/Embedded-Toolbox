/**
 * Modbus 协议层共享类型，同时冻结与 `mudbus_web_tools` 的兼容语义。
 *
 * 兼容约定（不可在移植过程中悄悄改变）：
 * 1. 字节序/字序以 Toolbox converter 的定义为准：`DATA_LAYOUTS` 的
 *    abcd / dcba / badc / cdab 由 byteOrder（寄存器内字节）与 wordOrder（寄存器字序）组合而成。
 * 2. 64 位 CDAB 存在已知差异：
 *    - 网页版：每 4 字节交换两个寄存器，`01 02 03 04 05 06 07 08` -> `03 04 01 02 07 08 05 06`。
 *    - Toolbox：反转整个寄存器字序，`01 02 03 04 05 06 07 08` -> `07 08 05 06 03 04 01 02`。
 *    本移植采用 Toolbox 语义。
 * 3. DCBA 两边等价（整体反转），不属于兼容性差异，不得声称存在差异。
 * 4. ASCII 文本重排独立实现（见 bytes.reorderTextBytes），按实际字节长度处理，
 *    不经过会补零的 `splitWords()`，因此奇数尾字节不会引入填充字节。
 */

/** 结构性错误码：core 只返回错误码与细节，最终文案由视图层映射 i18n。 */
export type ErrorCode =
  | "emptyInput"
  | "oddHexLength"
  | "frameTooShort"
  | "invalidLengthField"
  | "insufficientData"
  | "offsetOutOfRange"
  | "unsupportedLayout"
  | "unknownDataType"
  | "scaleOverflow"
  | "invalidValue"
  | "outOfRange";

/** 校验类告警码：报文仍可解析，但结论不可信。 */
export type WarningCode = "crcMismatch" | "lrcMismatch" | "protocolIdMismatch" | "lengthMismatch";

export interface ProtocolError {
  code: ErrorCode;
  /** 补充信息（如期望长度、实际长度），不参与 i18n 占位符替换。 */
  detail?: string;
}

export interface ProtocolWarning {
  code: WarningCode;
  detail?: string;
}

/** core 统一返回结构化结果，不抛异常，也不返回半成品数值。 */
export type ProtocolResult<T> = { ok: true; value: T } | { ok: false; error: ProtocolError };

/** 报文说明行：`key` 由视图层映射为 i18n 文案，`value` 为已格式化的数值文本。 */
export interface FrameLine {
  key: string;
  value: string;
}

export interface BuiltFrame {
  bytes: Uint8Array;
  text: string;
  lines: FrameLine[];
}

export interface FrameParseValue {
  unit: number;
  func: number;
  data: Uint8Array;
  lines: FrameLine[];
  warning?: ProtocolWarning;
  transactionId?: number;
  protocolId?: number;
}

/** 请求生成器字段；tid 仅 TCP 使用。 */
export interface RequestFields {
  unit: number;
  func: number;
  addr: number;
  qty: number;
  tid: number;
  /** 写多点（0x0F / 0x10）的数据区域；长度必须匹配数量推导的字节数。 */
  data?: number[];
}

/** 响应生成器字段；tid 仅 TCP 使用。 */
export interface ResponseFields {
  unit: number;
  tid: number;
}

export type ResponseKind = "read" | "write" | "custom";
