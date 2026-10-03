# 开发环境与运行

本文用于新开发者部署 Embedded Toolbox 开发环境。当前项目以 Windows 桌面开发为主要验证平台。

## 1. 系统要求

### Windows 必需组件

1. Windows 10 或 Windows 11。
2. Microsoft Edge WebView2 Runtime。现代 Windows 通常已经安装。
3. Visual Studio 2022 Build Tools，并选择 **Desktop development with C++** 工作负载。
4. Rust stable MSVC 工具链。
5. Vite+ 全局 CLI `vp`。
6. Git。

Tauri 2 官方前置条件说明：<https://v2.tauri.app/start/prerequisites/>

Vite+ 官方入门说明：<https://viteplus.dev/guide/>

## 2. 安装 Vite+

在 PowerShell 中执行官方安装命令：

```powershell
irm https://vite.plus/ps1 | iex
```

关闭并重新打开终端，然后验证：

```powershell
vp --version
vp --help
vp env
```

Vite+ 负责管理项目使用的 Node.js 和包管理器。日常开发统一使用 `vp`，不要改用一组 `npm`、ESLint、Prettier 和 Vitest 命令拼接出平行工具链。

## 3. 安装 Rust

推荐使用官方 Rustup：

```powershell
winget install --id Rustlang.Rustup
rustup default stable-msvc
```

验证：

```powershell
rustup --version
rustc --version
cargo --version
rustup show active-toolchain
```

正确的 Windows host 应为：

```text
x86_64-pc-windows-msvc
```

如果终端找不到 `cargo`，确认以下目录位于用户 PATH，然后重启终端：

```text
%USERPROFILE%\.cargo\bin
```

## 4. 安装 Microsoft C++ Build Tools

从 Microsoft 安装 Visual Studio 2022 Build Tools：

<https://visualstudio.microsoft.com/visual-cpp-build-tools/>

安装器中必须选择：

- Desktop development with C++
- MSVC v143 C++ build tools
- Windows 10/11 SDK

WebView2 Runtime 下载页：

<https://developer.microsoft.com/microsoft-edge/webview2/>

## 5. 获取项目并安装依赖

```powershell
git clone <repository-url> embedded-toolbox
cd embedded-toolbox
vp install
```

不要删除或手动重写 `pnpm-lock.yaml` 与 `Cargo.lock`。它们用于保持开发和构建环境可复现。

## 6. 环境自检

```powershell
node --version
vp --version
rustup --version
rustc --version
cargo --version
git --version
```

本次 V0.1 基线验证环境：

| 工具                      | 版本               |
| ------------------------- | ------------------ |
| Vite+                     | 1.0.0-rc.0         |
| Vite+ 托管 Node.js        | 24.21.0            |
| pnpm                      | 12.6.0             |
| Rust / Cargo              | 1.98.1 stable MSVC |
| Visual Studio Build Tools | 2022 17.14.41      |
| WebView2 Runtime          | 153.0.4234.48      |
| Git                       | 2.45.1.windows.1   |

不要求所有开发者使用完全相同的补丁版本；锁文件、Node engine 和 Rust MSRV 是实际约束。

## 7. 运行项目

### 完整桌面开发模式

```powershell
vp run tauri dev
```

该命令会：

1. 用 Vite+ 在 `127.0.0.1:1420` 启动前端开发服务器。
2. 用 Cargo 编译 Rust 后端。
3. 启动 Tauri 桌面窗口。
4. 监听前端和 Rust 文件变化。

开发窗口依赖这个终端持续运行；关闭终端或中断命令后，窗口可能仍在，但页面会变成空白。首次启动时依赖优化也可能让窗口短暂空白，等待终端出现 `Local: http://127.0.0.1:1420/` 和 `Running target\\debug\\embedded-toolbox.exe` 后再检查。若仍为空白，先在浏览器打开 `http://127.0.0.1:1420/`：打不开就查看终端中的 Vite 错误；能打开但桌面窗口仍为空白，可在窗口按 `Ctrl+R` 重载，并记录终端报错。启动前应确认没有另一份开发实例占用 1420 端口。

### 仅运行前端

```powershell
vp dev
```

适用于布局和普通页面开发。浏览器环境不具备真实 Tauri runtime，不能用于验收 Native command。

### 预览生产前端

```powershell
vp build
vp preview
```

## 8. 提交前检查

```powershell
vp check
vp test --run
vp build
cargo check --manifest-path src-tauri/Cargo.toml
```

测试文件是发布检查的一部分，不应使用 `--passWithNoTests` 掩盖测试文件丢失。

## 9. IDE 建议

- VS Code 或支持 Vue/Rust 的 JetBrains IDE
- Vue - Official 扩展（Volar）
- rust-analyzer
- 不要同时启用 Vetur
- 使用项目已有格式化与检查规则，不要在工作区另外添加 ESLint/Prettier 配置

## 10. 常见问题

### `cargo` 或 `vp` 找不到

重启终端，并检查用户 PATH 是否包含：

```text
%USERPROFILE%\.cargo\bin
%LOCALAPPDATA%\vite-plus\bin
```

### 端口 1420 被占用

先确认占用进程属于本项目：

```powershell
netstat -ano | Select-String ':1420'
Get-CimInstance Win32_Process -Filter 'ProcessId = <PID>' | Select-Object CommandLine
```

只终止已确认属于 Embedded Toolbox 的遗留开发进程，不要按进程名批量结束所有 Node.js 进程。

### Rust linker 或 Windows SDK 错误

打开 Visual Studio Installer，确认已安装 Desktop development with C++、MSVC 和 Windows SDK，然后重新打开终端。

### Rust 报 `E0786`，同时显示“页面文件太小”（os error 1455）

这是 Windows 提交内存不足，导致 Rust 无法映射依赖库；不能仅凭 `invalid metadata` 判断缓存已损坏。项目开发构建已关闭依赖调试信息与增量编译，以减少内存占用；项目自身保留行号信息，但依赖内的变量调试信息不可用。

先停止当前开发命令，关闭不需要的应用，再重试。若仍失败，在 Windows 的“高级系统设置 → 性能 → 设置 → 高级 → 虚拟内存”启用自动管理所有驱动器的分页文件大小，确保磁盘有足够空闲空间，并按系统提示重启。不要首先删除整个 `target` 目录；全量重编译也需要内存。

资源紧张时，可在同一个 PowerShell 终端限制编译并行度：

```powershell
$env:CARGO_BUILD_JOBS = '1'
vp run tauri dev
```

### Vite+ Windows 原生绑定错误

先升级或强制重装 Vite+，不要回退为普通 Vite：

```powershell
vp upgrade --force
```

如果当前 Vite+ release candidate 仍出现安装布局问题，应先查看对应版本 release notes 和官方 issue，再记录环境与解决方案。
