//! Modbus 调试所需的最小连接链路：串口与 TCP。
//!
//! 设计要点（与 `docs/CONTRIBUTING.md` 的 Native 边界一致）：
//! - 本模块只负责"把字节搬进搬出"，不做 Modbus 拆帧与解析；拆帧在 TypeScript core
//!   （`src/modules/protocol/core/framing.ts`）完成，便于单测覆盖。
//! - 每个连接有独立的读线程与写句柄。阻塞读写只持有该连接自己的锁，
//!   绝不持有连接池（`ConnectionManager`）的全局锁。
//! - 关闭连接时置位关闭标志并 join 读线程，读线程依赖读超时周期性退出。
//! - 事件统一带上 `connectionId`；重连后标识变化，旧连接的迟到事件可被前端丢弃。

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serialport::{DataBits, Parity, SerialPort, SerialPortType, StopBits};
use tauri::{AppHandle, Emitter};

use crate::domain::connection::{
    ConnectionConfig, ConnectionEvent, SerialConfig, SerialPortInfo, TcpConfig,
};
use crate::domain::error::NativeError;

/// 连接事件统一在此事件名上推送，前端按 `connectionId` 过滤。
pub const CONNECTION_EVENT: &str = "modbus://connection";

/// 单次读取的缓冲上限。超出部分由后续读取继续返回。
const READ_BUFFER_SIZE: usize = 1024;

/// 串口与 TCP 的统一传输抽象，支持克隆出独立的读写句柄。
pub enum Transport {
    Serial(Box<dyn SerialPort>),
    Tcp(TcpStream),
}

impl Transport {
    /// 克隆出一个可独立读写的句柄，避免读写线程互相阻塞在同一把锁上。
    fn try_clone_transport(&self) -> Result<Transport, NativeError> {
        match self {
            Transport::Serial(port) => port
                .try_clone()
                .map(Transport::Serial)
                .map_err(|error| NativeError::serial(format!("failed to duplicate serial port: {error}"))),
            Transport::Tcp(stream) => stream
                .try_clone()
                .map(Transport::Tcp)
                .map_err(|error| NativeError::tcp(format!("failed to duplicate socket: {error}"))),
        }
    }
}

impl Read for Transport {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match self {
            Transport::Serial(port) => port.read(buffer),
            Transport::Tcp(stream) => stream.read(buffer),
        }
    }
}

impl Write for Transport {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        match self {
            Transport::Serial(port) => port.write(buffer),
            Transport::Tcp(stream) => stream.write(buffer),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Transport::Serial(port) => port.flush(),
            Transport::Tcp(stream) => stream.flush(),
        }
    }
}

/// 已建立的连接。读线程与写句柄各自独立。
struct ConnectionHandle {
    writer: Arc<Mutex<Transport>>,
    shutdown: Arc<AtomicBool>,
    reader_thread: Option<JoinHandle<()>>,
}

/// 连接注册表，由 Tauri 以托管状态持有（`app.manage`）。
pub struct ConnectionManager {
    connections: Mutex<HashMap<String, ConnectionHandle>>,
    /// 单调时钟基准：事件里的 `read_at_ms` 相对它计算。
    clock: Instant,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            clock: Instant::now(),
        }
    }

    fn lock_connections(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, ConnectionHandle>>, NativeError> {
        self.connections
            .lock()
            .map_err(|_| NativeError::internal("connection registry is poisoned"))
    }

    /// 打开连接并启动读线程。
    ///
    /// `connection_id` 由前端生成，这样前端可以在调用本命令**之前**先注册事件监听，
    /// 避免首包在监听建立前被丢弃。
    pub fn open(
        &self,
        app: &AppHandle,
        connection_id: &str,
        config: &ConnectionConfig,
    ) -> Result<(), NativeError> {
        if connection_id.is_empty() {
            return Err(NativeError::invalid_argument("connectionId must not be empty"));
        }

        {
            let connections = self.lock_connections()?;
            if connections.contains_key(connection_id) {
                return Err(NativeError::conflict(format!(
                    "connection {connection_id} is already open"
                )));
            }
        }

        let transport = match config {
            ConnectionConfig::Serial(serial) => open_serial(serial)?,
            ConnectionConfig::Tcp(tcp) => open_tcp(tcp)?,
        };
        let reader = transport.try_clone_transport()?;
        let shutdown = Arc::new(AtomicBool::new(false));

        log::info!("modbus connection {connection_id} opened: {}", config.describe());

        let reader_thread = {
            let app = app.clone();
            let connection_id = connection_id.to_string();
            let shutdown = Arc::clone(&shutdown);
            let clock = self.clock;
            thread::spawn(move || read_loop(reader, shutdown, app, connection_id, clock))
        };

        let mut connections = self.lock_connections()?;
        connections.insert(
            connection_id.to_string(),
            ConnectionHandle {
                writer: Arc::new(Mutex::new(transport)),
                shutdown,
                reader_thread: Some(reader_thread),
            },
        );
        Ok(())
    }

    /// 写出一段字节。仅在该连接的写句柄上加锁，不阻塞其他连接。
    pub fn write(&self, connection_id: &str, data: &[u8]) -> Result<(), NativeError> {
        let writer = {
            let connections = self.lock_connections()?;
            connections
                .get(connection_id)
                .map(|handle| Arc::clone(&handle.writer))
                .ok_or_else(|| NativeError::not_found(format!("connection {connection_id} is not open")))?
        };

        let mut transport = writer
            .lock()
            .map_err(|_| NativeError::internal("connection writer is poisoned"))?;
        transport
            .write_all(data)
            .map_err(|error| NativeError::io(format!("write failed on {connection_id}: {error}")))?;
        transport
            .flush()
            .map_err(|error| NativeError::io(format!("flush failed on {connection_id}: {error}")))?;
        Ok(())
    }

    /// 关闭连接：停止读线程并释放句柄。重复关闭同一标识视为成功。
    pub fn close(&self, connection_id: &str) -> Result<(), NativeError> {
        let handle = { self.lock_connections()?.remove(connection_id) };
        let Some(mut handle) = handle else {
            return Ok(());
        };

        handle.shutdown.store(true, Ordering::Relaxed);
        if let Some(reader_thread) = handle.reader_thread.take() {
            reader_thread
                .join()
                .map_err(|_| NativeError::internal("reader thread panicked"))?;
        }
        log::info!("modbus connection {connection_id} closed");
        Ok(())
    }
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// 读线程主体。退出条件：关闭标志置位、对端关闭（`Ok(0)`）或读错误。
fn read_loop(
    mut reader: Transport,
    shutdown: Arc<AtomicBool>,
    app: AppHandle,
    connection_id: String,
    clock: Instant,
) {
    let mut buffer = vec![0u8; READ_BUFFER_SIZE];

    loop {
        if shutdown.load(Ordering::Relaxed) {
            return;
        }

        match reader.read(&mut buffer) {
            // 串口在超时后会返回错误而非 0；`Ok(0)` 只出现在 TCP 对端正常关闭。
            Ok(0) => {
                emit(&app, ConnectionEvent::closed(connection_id, "peerClosed"));
                return;
            }
            Ok(read) => {
                let data = buffer[..read].to_vec();
                let read_at_ms = clock.elapsed().as_millis() as u64;
                emit(&app, ConnectionEvent::data(connection_id.clone(), data, read_at_ms));
            }
            Err(error) => match error.kind() {
                io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted => {
                    // 读超时是正常轮询：回到循环顶部检查关闭标志。
                    continue;
                }
                _ => {
                    emit(
                        &app,
                        ConnectionEvent::error(connection_id.clone(), "io", error.to_string()),
                    );
                    emit(&app, ConnectionEvent::closed(connection_id, "ioError"));
                    return;
                }
            },
        }
    }
}

fn emit(app: &AppHandle, event: ConnectionEvent) {
    if let Err(error) = app.emit(CONNECTION_EVENT, event) {
        log::warn!("failed to emit modbus connection event: {error}");
    }
}

fn open_serial(config: &SerialConfig) -> Result<Transport, NativeError> {
    let data_bits = match config.data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        8 => DataBits::Eight,
        other => {
            return Err(NativeError::invalid_argument(format!(
                "unsupported data bits: {other}"
            )))
        }
    };
    let stop_bits = match config.stop_bits {
        1 => StopBits::One,
        2 => StopBits::Two,
        other => {
            return Err(NativeError::invalid_argument(format!(
                "unsupported stop bits: {other}"
            )))
        }
    };
    let parity = match config.parity.as_str() {
        "none" => Parity::None,
        "odd" => Parity::Odd,
        "even" => Parity::Even,
        other => {
            return Err(NativeError::invalid_argument(format!(
                "unsupported parity: {other}"
            )))
        }
    };

    // 串口驱动的超时读写共用：读线程靠它周期性返回以便检查关闭标志。
    let port = serialport::new(&config.port_name, config.baud_rate)
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .parity(parity)
        .timeout(Duration::from_millis(config.read_timeout_ms))
        .open()
        .map_err(|error| {
            NativeError::serial(format!("failed to open {}: {error}", config.port_name))
        })?;

    Ok(Transport::Serial(port))
}

fn open_tcp(config: &TcpConfig) -> Result<Transport, NativeError> {
    let addresses = (config.host.as_str(), config.port)
        .to_socket_addrs()
        .map_err(|error| NativeError::tcp(format!("cannot resolve {}: {error}", config.host)))?;

    let connect_timeout = Duration::from_millis(config.connect_timeout_ms);
    let mut last_error: Option<io::Error> = None;
    let mut stream: Option<TcpStream> = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, connect_timeout) {
            Ok(connected) => {
                stream = Some(connected);
                break;
            }
            Err(error) => last_error = Some(error),
        }
    }

    let stream = match stream {
        Some(stream) => stream,
        None => {
            let detail = last_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "no address resolved".to_string());
            return Err(NativeError::tcp(format!(
                "failed to connect {}:{}: {detail}",
                config.host, config.port
            )));
        }
    };

    stream
        .set_read_timeout(Some(Duration::from_millis(config.read_timeout_ms)))
        .map_err(|error| NativeError::tcp(format!("failed to set read timeout: {error}")))?;
    stream
        .set_write_timeout(Some(Duration::from_millis(config.write_timeout_ms)))
        .map_err(|error| NativeError::tcp(format!("failed to set write timeout: {error}")))?;
    stream
        .set_nodelay(true)
        .map_err(|error| NativeError::tcp(format!("failed to disable Nagle: {error}")))?;

    Ok(Transport::Tcp(stream))
}

/// 枚举当前可用串口。
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, NativeError> {
    let ports = serialport::available_ports()
        .map_err(|error| NativeError::serial(format!("failed to enumerate serial ports: {error}")))?;

    Ok(ports
        .into_iter()
        .map(|port| SerialPortInfo {
            port_name: port.port_name,
            port_type: describe_port_type(&port.port_type).to_string(),
        })
        .collect())
}

fn describe_port_type(port_type: &SerialPortType) -> &'static str {
    match port_type {
        SerialPortType::UsbPort(_) => "usb",
        SerialPortType::PciPort => "pci",
        SerialPortType::BluetoothPort => "bluetooth",
        SerialPortType::Unknown => "unknown",
    }
}