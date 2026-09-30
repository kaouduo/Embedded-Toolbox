use serde::Serialize;

/// 原生层统一错误。
///
/// 字段与前端 `NativeError`（`src/services/native/native-service.ts`）一致，
/// `kind` 为稳定的机器可读分类，`message` 面向界面展示。
#[derive(Debug, Clone, Serialize)]
pub struct NativeError {
    pub kind: String,
    pub message: String,
}

impl NativeError {
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }

    /// 串口枚举、打开或读写失败。
    pub fn serial(message: impl Into<String>) -> Self {
        Self::new("serial", message)
    }

    /// TCP 连接、解析或读写失败。
    pub fn tcp(message: impl Into<String>) -> Self {
        Self::new("tcp", message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new("io", message)
    }

    /// 指定的连接不存在（或已关闭）。
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("notFound", message)
    }

    /// 连接标识已被占用。
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message)
    }

    /// 调用方传入的参数不合法。
    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new("invalidArgument", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
}

impl std::fmt::Display for NativeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "[{}] {}", self.kind, self.message)
    }
}

impl std::error::Error for NativeError {}

impl From<std::io::Error> for NativeError {
    fn from(error: std::io::Error) -> Self {
        NativeError::io(error.to_string())
    }
}

impl From<serialport::Error> for NativeError {
    fn from(error: serialport::Error) -> Self {
        NativeError::serial(error.to_string())
    }
}