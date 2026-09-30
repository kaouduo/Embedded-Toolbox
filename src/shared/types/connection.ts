/**
 * Mirrors `domain::connection` on the Rust side.
 *
 * The Modbus debug page receives raw byte chunks here; frame assembly
 * (MBAP length / RTU expected length / ASCII CR LF) happens in
 * `src/modules/protocol/core/framing.ts`.
 */

/** 枚举到的串口。`portType` 为稳定标识，文案由视图层映射 i18n。 */
export interface SerialPortInfo {
  portName: string;
  /** 当前取值：`usb` / `pci` / `bluetooth` / `unknown`。 */
  portType: string;
}

export type SerialParity = "none" | "odd" | "even";

export interface SerialConfig {
  kind: "serial";
  portName: string;
  baudRate: number;
  /** 5 / 6 / 7 / 8 */
  dataBits: number;
  /** 1 / 2 */
  stopBits: number;
  parity: SerialParity;
  /**
   * 串口读阻塞上限，同时决定读线程检查关闭标志的周期。
   * 串口驱动的超时读写共用，无法单独设置写超时。
   */
  readTimeoutMs: number;
}

export interface TcpConfig {
  kind: "tcp";
  host: string;
  port: number;
  connectTimeoutMs: number;
  readTimeoutMs: number;
  writeTimeoutMs: number;
}

export type ConnectionConfig = SerialConfig | TcpConfig;

/**
 * Rust 推送的连接事件，统一在 `modbus://connection` 上。
 * 每个事件都带 `connectionId`，关闭重连后标识变化，旧连接的迟到事件应被丢弃。
 */
export type ConnectionEvent =
  | {
      event: "data";
      connectionId: string;
      data: number[];
      /** 自进程启动起的单调毫秒数；表示字节被读到的时刻，不是线路字节时刻。 */
      readAtMs: number;
    }
  | { event: "error"; connectionId: string; kind: string; message: string }
  /** `reason` 为稳定标识，当前取值：`peerClosed`（对端关闭）/ `ioError`（读失败）。 */
  | { event: "closed"; connectionId: string; reason: string };
