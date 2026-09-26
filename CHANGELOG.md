# Changelog

本项目的重要变更记录在此文件中。

## [Unreleased]

### Added

- 数据转换工具：支持十进制/十六进制输入、8 种整数与浮点类型、4 种字节/字序排列、实时结果和复制。
- 可供后续 Modbus 报文解析复用的 TypeScript 数据 codec 与单元测试。

### Fixed

- 修复深色主题仍继承黑色文本的问题，并统一应用布局、自定义组件与 Naive UI 的浅色/深色色彩语义。

## [0.1.0] - 2026-09-26

### Added

- Vue 3、TypeScript、Vite+ 和 Tauri 2 基础工程。
- Feature / Module Based 前端目录结构。
- 桌面应用布局、Sidebar、Toolbar 和工具路由。
- Naive UI Light / Dark 主题及持久化。
- English / 简体中文切换、系统语言检测及持久化。
- Home 工具入口和 V0.1 Coming Soon 页面。
- 封装后的 NativeService 和 AppService。
- Rust domain、service、command 基础分层。
- `get_app_info` Vue → Tauri → Rust 通信示例。
- 开发、架构、构建发布和 Git 协作维护文档。

### Notes

- Modbus、Serial、TCP/UDP、CRC、CAN、图像、色卡和设备管理目前仅为页面入口或占位内容。
- 代码签名、自动更新、CI 发布和真实硬件通信尚未实现。
