import type { ConnectionConfig, ConnectionEvent, SerialPortInfo } from "@/shared/types/connection";

import { invokeNative, isTauriRuntime, listenNative } from "./native-service";

/** 与 `services::connection_service::CONNECTION_EVENT` 保持一致。 */
const CONNECTION_EVENT = "modbus://connection";

/** 收到的一段原始字节，尚未拆帧。 */
export interface ReceivedChunk {
  data: Uint8Array;
  /**
   * Rust 侧读到该段字节的单调毫秒数（自进程启动）。
   *
   * 仅用于判断字节的到达顺序与分批情况：接收缓冲、预期响应长度与 CRC
   * 才是判断完整帧的依据，不能用该时间代替串口线路时序。
   */
  readAtMs: number;
}

export interface ConnectionHandlers {
  onData?(chunk: ReceivedChunk): void;
  onError?(error: { kind: string; message: string }): void;
  onClosed?(reason: string): void;
}

/** 一个已打开的连接。关闭后不可再用。 */
export interface OpenedConnection {
  readonly id: string;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

function createConnectionId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Native connection services: serial ports and TCP sockets.
 *
 * Components consume this service; they never call `invokeNative` or
 * `listenNative` directly.
 */
export const ConnectionService = {
  /** 桌面运行时才具备原生连接能力；浏览器 dev 下界面应给出提示。 */
  isAvailable(): boolean {
    return isTauriRuntime();
  },

  async listSerialPorts(): Promise<SerialPortInfo[]> {
    if (!isTauriRuntime()) return [];
    return invokeNative<SerialPortInfo[]>("list_serial_ports");
  },

  /**
   * 打开连接。
   *
   * `connectionId` 在调用命令**之前**生成并注册好事件监听，随后才让 Rust
   * 启动读线程，避免首包在监听建立前丢失。关闭重连会得到新的标识，
   * 因此旧连接的迟到事件不会被计入。
   */
  async open(
    config: ConnectionConfig,
    handlers: ConnectionHandlers = {},
  ): Promise<OpenedConnection> {
    const id = createConnectionId();

    const detach = await listenNative<ConnectionEvent>(CONNECTION_EVENT, (event) => {
      if (event.connectionId !== id) return;
      switch (event.event) {
        case "data":
          handlers.onData?.({ data: Uint8Array.from(event.data), readAtMs: event.readAtMs });
          break;
        case "error":
          handlers.onError?.({ kind: event.kind, message: event.message });
          break;
        case "closed":
          handlers.onClosed?.(event.reason);
          break;
      }
    });

    try {
      await invokeNative<void>("open_connection", { connectionId: id, config });
    } catch (error) {
      detach();
      throw error;
    }

    let closed = false;

    return {
      id,
      async write(bytes: Uint8Array): Promise<void> {
        if (closed) throw new Error(`connection ${id} is already closed`);
        await invokeNative<void>("write_connection", {
          connectionId: id,
          data: Array.from(bytes),
        });
      },
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        try {
          await invokeNative<void>("close_connection", { connectionId: id });
        } finally {
          detach();
        }
      },
    };
  },
};
