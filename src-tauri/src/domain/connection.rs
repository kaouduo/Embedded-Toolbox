use serde::{Deserialize, Serialize};

/// 枚举到的串口。`port_type` 为稳定标识（`usb` / `pci` / `bluetooth` / `unknown`），
/// 由前端映射为界面文案。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub port_name: String,
    pub port_type: String,
}

fn default_data_bits() -> u8 {
    8
}

fn default_stop_bits() -> u8 {
    1
}

fn default_parity() -> String {
    "none".to_string()
}

fn default_read_timeout_ms() -> u64 {
    200
}

fn default_write_timeout_ms() -> u64 {
    1000
}

fn default_connect_timeout_ms() -> u64 {
    3000
}

/// 串口连接参数。
///
/// 串口驱动的超时是读写共用的，无法单独设置写超时，因此只有 `read_timeout_ms`：
/// 它同时决定读阻塞上限，读线程依赖该超时周期性检查关闭标志，不宜设置过大。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialConfig {
    pub port_name: String,
    pub baud_rate: u32,
    #[serde(default = "default_data_bits")]
    pub data_bits: u8,
    #[serde(default = "default_stop_bits")]
    pub stop_bits: u8,
    #[serde(default = "default_parity")]
    pub parity: String,
    #[serde(default = "default_read_timeout_ms")]
    pub read_timeout_ms: u64,
}

/// TCP 连接参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TcpConfig {
    pub host: String,
    pub port: u16,
    #[serde(default = "default_connect_timeout_ms")]
    pub connect_timeout_ms: u64,
    #[serde(default = "default_read_timeout_ms")]
    pub read_timeout_ms: u64,
    #[serde(default = "default_write_timeout_ms")]
    pub write_timeout_ms: u64,
}

/// 连接配置。前端按 `kind` 区分两种物理链路。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConnectionConfig {
    Serial(SerialConfig),
    Tcp(TcpConfig),
}

impl ConnectionConfig {
    /// 诊断日志用的摘要，避免把完整配置打进日志。
    pub fn describe(&self) -> String {
        match self {
            ConnectionConfig::Serial(config) => format!(
                "serial {} @ {} {}{}{}",
                config.port_name,
                config.baud_rate,
                config.data_bits,
                match config.parity.as_str() {
                    "odd" => "O",
                    "even" => "E",
                    _ => "N",
                },
                config.stop_bits
            ),
            ConnectionConfig::Tcp(config) => format!("tcp {}:{}", config.host, config.port),
        }
    }
}

/// 连接生命周期事件，统一在 `modbus://connection` 上推送。
///
/// 每个事件都带 `connection_id`：关闭并重连后标识会变化，前端据此丢弃旧连接的迟到事件。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ConnectionEvent {
    /// 读到一段字节。`read_at_ms` 为自进程启动起的单调毫秒数，用于判断
    /// 字节实际到达顺序与分批情况；它不等于线路上的字节时刻。
    #[serde(rename_all = "camelCase")]
    Data {
        connection_id: String,
        data: Vec<u8>,
        read_at_ms: u64,
    },
    /// 读线程或写操作失败。错误帧之外的原生错误也走这里，不会终止连接。
    #[serde(rename_all = "camelCase")]
    Error {
        connection_id: String,
        kind: String,
        message: String,
    },
    /// 读线程结束，连接不再可用。`reason` 为稳定标识（`peerClosed` / `ioError`）。
    #[serde(rename_all = "camelCase")]
    Closed {
        connection_id: String,
        reason: String,
    },
}

impl ConnectionEvent {
    pub fn data(connection_id: String, data: Vec<u8>, read_at_ms: u64) -> Self {
        ConnectionEvent::Data {
            connection_id,
            data,
            read_at_ms,
        }
    }

    pub fn error(connection_id: String, kind: impl Into<String>, message: impl Into<String>) -> Self {
        ConnectionEvent::Error {
            connection_id,
            kind: kind.into(),
            message: message.into(),
        }
    }

    pub fn closed(connection_id: String, reason: impl Into<String>) -> Self {
        ConnectionEvent::Closed {
            connection_id,
            reason: reason.into(),
        }
    }
}