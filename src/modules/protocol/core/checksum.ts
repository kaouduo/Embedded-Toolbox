/** Modbus 校验算法：RTU 的 CRC16 与 ASCII 的 LRC。 */

/** Modbus CRC16（多项式 0xA001），返回 16 位数值。 */
export function crc16Modbus(bytes: Uint8Array | readonly number[]): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xffff;
}

/** Modbus RTU 线路顺序的 CRC 字节：低字节在前。 */
export function crc16Bytes(bytes: Uint8Array | readonly number[]): [number, number] {
  const crc = crc16Modbus(bytes);
  return [crc & 0xff, (crc >> 8) & 0xff];
}

/** Modbus ASCII LRC：累加和取二进制补码。 */
export function lrc(bytes: Uint8Array | readonly number[]): number {
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) & 0xff;
  return (0x100 - sum) & 0xff;
}
