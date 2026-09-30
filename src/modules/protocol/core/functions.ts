/** Modbus 功能码元数据与 PDU 数据区域提取。 */

export interface FunctionDefinition {
  code: number;
  /** i18n key 后缀，视图层映射为 `protocol.functions.<key>`。 */
  key: string;
  /** 读类功能码（01/02/03/04）。 */
  read: boolean;
  /** 位类功能码（线圈/离散输入，数量单位为位）。 */
  bits: boolean;
}

export const FUNCTIONS = [
  { code: 0x01, key: "readCoils", read: true, bits: true },
  { code: 0x02, key: "readDiscreteInputs", read: true, bits: true },
  { code: 0x03, key: "readHoldingRegisters", read: true, bits: false },
  { code: 0x04, key: "readInputRegisters", read: true, bits: false },
  { code: 0x05, key: "writeSingleCoil", read: false, bits: true },
  { code: 0x06, key: "writeSingleRegister", read: false, bits: false },
  { code: 0x0f, key: "writeMultipleCoils", read: false, bits: true },
  { code: 0x10, key: "writeMultipleRegisters", read: false, bits: false },
] as const satisfies readonly FunctionDefinition[];

export function functionDefinition(code: number): FunctionDefinition | undefined {
  return FUNCTIONS.find((item) => item.code === code);
}

/** 功能码对应 i18n key 后缀；未知/自定义功能码返回 `undefined`。 */
export function functionKey(code: number): string | undefined {
  return functionDefinition(code)?.key;
}

export function isReadFunction(code: number): boolean {
  return functionDefinition(code)?.read ?? false;
}

export function isReadBits(code: number): boolean {
  return functionDefinition(code)?.bits === true && functionDefinition(code)?.read === true;
}

export function isReadRegisters(code: number): boolean {
  return functionDefinition(code)?.bits === false && functionDefinition(code)?.read === true;
}

/** 异常响应：功能码最高位置 1。 */
export function isExceptionFunction(code: number): boolean {
  return (code & 0x80) !== 0;
}

/** 写多点功能码（0x0F / 0x10）：请求 PDU 还须携带字节数与数据区域。 */
export function isWriteMultiple(code: number): boolean {
  return code === 0x0f || code === 0x10;
}

/** 写多点请求数据区域应有的字节数：线圈按位打包，寄存器每点两字节。 */
export function writeMultipleByteCount(func: number, qty: number): number {
  return func === 0x0f ? Math.ceil(qty / 8) : qty * 2;
}

/**
 * 读/写请求 PDU：功能码 + 起始地址 + 数量（均为大端 16 位）。
 * RTU / TCP / ASCII 共用同一 PDU 结构。
 * 写多点（0x0F / 0x10）追加字节数与 `data`；`data` 长度必须等于
 * `writeMultipleByteCount(func, qty)`，由调用方在生成前校验。
 */
export function buildRequestPdu(
  func: number,
  addr: number,
  qty: number,
  data: readonly number[] = [],
): number[] {
  const head = [func & 0xff, (addr >> 8) & 0xff, addr & 0xff, (qty >> 8) & 0xff, qty & 0xff];
  if (isWriteMultiple(func)) {
    return [...head, data.length & 0xff, ...Array.from(data, (byte) => byte & 0xff)];
  }
  return head;
}

/**
 * 从 PDU 中取数据区域。
 * 读类响应首字节为字节数，且后续长度恰好匹配时剥离该字节；否则原样返回。
 */
export function dataRegion(func: number, pduBytes: Uint8Array): Uint8Array {
  const byteCount = pduBytes[0];
  if (
    isReadFunction(func) &&
    byteCount !== undefined &&
    pduBytes.length >= 1 &&
    pduBytes.length - 1 === byteCount
  ) {
    return pduBytes.slice(1);
  }
  return pduBytes;
}
