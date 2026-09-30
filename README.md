# Embedded Toolbox

Embedded Toolbox 是面向嵌入式工程师的跨平台桌面工具箱。项目基于 Vue 3、TypeScript、Vite+、Tauri 2 和 Rust，目标是在一个结构清晰、可长期维护的应用中逐步提供协议调试、通信、数据转换、计算、图像、色卡和设备调试工具。

项目仍处于早期开发阶段。数据转换、Modbus 报文工具和色卡管理已经可用；其他工具会逐步实现。

## 当前能力

- 桌面应用壳层：Toolbar、Sidebar 和主内容区
- Home 入口与完整工具导航路由
- Light / Dark 主题及本地持久化
- English / 简体中文切换、系统语言检测及本地持久化
- 统一的 Vue → Service → NativeService → Tauri → Rust 调用链
- Rust `domain / services / commands` 基础分层
- `get_app_info` 原生通信示例
- 数据转换工具：8 种整数/浮点类型、十进制/十六进制和 4 种字节/字序排列
- Modbus RTU / TCP / ASCII 报文构建、解析、校验和调试
- 色卡管理：创建和编辑任意数量的色板与颜色，导入导出 JSON 色卡，并保存到本地
- Serial、TCP/UDP、计算器、图像和设备管理占位页面
- Vite+ 统一的开发、检查、测试和构建能力

## 技术栈

| 层级        | 技术              | 当前版本                             |
| ----------- | ----------------- | ------------------------------------ |
| 前端框架    | Vue               | 3.5.43                               |
| 前端语言    | TypeScript        | 6.0.3，严格类型检查                  |
| 前端工具链  | Vite+             | 1.0.0-rc.0                           |
| 路由        | Vue Router        | 5.3.1                                |
| 状态管理    | Pinia             | 4.0.3                                |
| UI          | Naive UI          | 2.45.3                               |
| 国际化      | Vue I18n          | 11.4.12                              |
| 桌面框架    | Tauri             | CLI 2.11.5 / Rust crate 2.11.6       |
| Native 后端 | Rust              | stable MSVC；开发环境验证版本 1.98.1 |
| 包管理      | Vite+ 管理的 pnpm | 12.6.0                               |

版本锁定信息以 [package.json](./package.json)、[pnpm-lock.yaml](./pnpm-lock.yaml)、[pnpm-workspace.yaml](./pnpm-workspace.yaml) 和 [Cargo.lock](./src-tauri/Cargo.lock) 为准。

## 快速开始

完成 [开发环境部署](./docs/DEVELOPMENT.md) 后，在项目根目录执行：

```powershell
vp install
vp check
vp run tauri dev
```

仅运行浏览器中的前端界面：

```powershell
vp dev
```

浏览器模式无法调用 Rust command；`AppService` 会返回仅用于前端开发的应用信息。验证真实 Native 链路必须使用 `vp run tauri dev`。

## 常用命令

| 命令                                               | 用途                             |
| -------------------------------------------------- | -------------------------------- |
| `vp install`                                       | 根据锁文件安装依赖               |
| `vp dev`                                           | 启动前端开发服务器               |
| `vp check`                                         | 检查格式、lint 和类型            |
| `vp check --fix`                                   | 自动修复可修复的格式和 lint 问题 |
| `vp test`                                          | 运行前端测试                     |
| `vp build`                                         | 构建前端生产资源到 `dist/`       |
| `vp preview`                                       | 预览前端生产构建                 |
| `vp run tauri dev`                                 | 启动完整 Tauri 桌面开发环境      |
| `vp run tauri build`                               | 构建并打包桌面应用               |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 单独检查 Rust 后端               |

## 架构摘要

纯计算能力应保留在 TypeScript module core 中：

```text
Vue View → Module Core (TypeScript)
```

需要操作系统或硬件能力的功能使用统一 Native 通道：

```text
Vue View
  → Frontend AppService
  → NativeService
  → Tauri invoke
  → Rust Command
  → Rust Service
  → OS / Hardware Adapter（需要时再增加）
```

Vue 页面禁止直接导入 `@tauri-apps/api` 或调用 `invoke()`。完整规则见 [架构与扩展指南](./docs/ARCHITECTURE.md)。

## 文档索引

- [开发环境与运行](./docs/DEVELOPMENT.md)
- [架构与扩展指南](./docs/ARCHITECTURE.md)
- [色卡管理与 JSON 格式](./docs/COLOR_PALETTES.md)
- [构建、打包与发布](./docs/BUILD_AND_RELEASE.md)
- [协作与 Git 工作流](./docs/CONTRIBUTING.md)
- [版本变更记录](./CHANGELOG.md)

## 开发规则

首次 V0.1 基线提交完成后，禁止直接在 `main` 上进行功能修改。每次修改必须从最新 `main` 创建独立分支，验证通过后再合并回 `main`。详细命令和分支命名约定见 [CONTRIBUTING.md](./docs/CONTRIBUTING.md)。

## 后续方向

继续完善通信、计算、图像和设备工具。新增功能继续遵守模块边界与双语文案规则。
