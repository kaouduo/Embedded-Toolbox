# 架构与扩展指南

## 1. 架构目标

Embedded Toolbox 是长期演进的工程工具，不是一次性 Demo。架构需要支持逐步加入协议、通信、转换、计算、图像、色卡与设备调试能力，同时避免在 V0.1 提前引入插件系统、复杂依赖注入或企业级 DDD。

核心原则：

- Feature / Module Based 前端组织。
- 纯计算逻辑优先使用 TypeScript。
- Native 能力统一经过服务层和 Tauri command。
- Vue 组件不直接调用 Tauri。
- Rust command 保持薄，核心逻辑进入 service。
- 只在确有硬件或 OS 抽象需求时增加 adapter。

## 2. 目录职责

```text
src/
├─ app/
│  ├─ i18n/             # 国际化实例与中英文资源
│  ├─ layout/           # 应用壳层、Toolbar、Sidebar
│  ├─ router/           # 路由表与导航模型
│  └─ store/            # 应用级 Pinia 状态（主题、语言）
├─ modules/             # 按功能域组织的页面和业务逻辑
├─ services/
│  └─ native/           # AppService 与唯一 Tauri invoke gateway
├─ shared/              # 跨模块复用的组件和类型
├─ styles/              # 全局样式与主题变量
├─ App.vue
└─ main.ts

src-tauri/src/
├─ commands/            # 薄 Tauri command 与 DTO 边界
├─ domain/              # Native 领域数据结构
├─ services/            # Rust 用例和业务逻辑
├─ lib.rs               # Tauri Builder 与 command 注册
└─ main.rs              # 桌面进程入口
```

不要为了“目录完整”预建空的 `serial`、`can`、`flash` 或 `adapter` 模块。首次加入真实功能时再创建。

## 3. 两类功能边界

### 纯计算功能

适用于 CRC、HEX/DEC/BIN、IEEE754、Endian、RGB565、时间戳等不需要 OS 或硬件资源的能力：

```text
Vue View → Module Core (TypeScript)
```

建议模块结构：

```text
modules/converter/
├─ views/
├─ core/        # 纯函数，可直接单元测试
└─ types/       # 该模块专用类型，需要时创建
```

禁止为了使用 Rust 而把纯计算逻辑包装成 Tauri command。

### Native 功能

适用于 Serial、TCP/UDP、USB HID、文件系统、CMSIS-DAP、probe-rs、RTT 和固件烧录：

```text
Vue View
  → AppService
  → NativeService
  → Tauri invoke
  → Rust Command
  → Rust Service
  → Adapter / OS / Hardware
```

当前示例链路：

```text
HomeView.vue
  → AppService.getAppInfo()
  → invokeNative<AppInfo>("get_app_info")
  → commands::app_info::get_app_info()
  → services::app_info_service::current_app_info()
```

## 4. 前端规则

### View

- 使用 `<script setup lang="ts">`。
- 负责组合状态、服务和显示，不堆积复杂计算。
- 不导入 `@tauri-apps/api`。
- 不直接调用 `invoke()`。

### Module Core

- 使用无 UI 依赖的 TypeScript 纯函数。
- 明确输入、输出和错误边界。
- 优先添加单元测试。
- 不依赖 Pinia、Vue Router 或 Naive UI。

### Service

- `AppService` 描述前端用例，例如获取应用信息、打开设备或发起通信。
- `NativeService` 统一封装 invoke、runtime 检测和错误归一化。
- 组件只依赖面向用例的 service，不依赖 Tauri command 名称细节。

### Shared

只有两个及以上模块确实复用的内容才进入 `shared`。不要把所有辅助函数都放入全局 `utils`。

## 5. Rust 规则

### Command

Command 仅负责：

- 接收参数。
- 调用 service。
- 将结果或错误转换为前端 DTO。

Command 不应包含串口配置、协议组帧、CRC、收发循环和解析等完整业务流程。

### Service

- 承载 Native 用例和可测试业务逻辑。
- 使用 `Result<T, E>` 表达可能失败的操作。
- 避免 `unwrap()` 和无上下文 `expect()`。

### Adapter

只有接入真实 OS、驱动或硬件库时才创建。例如未来的 `SerialPortAdapter` 或 `ProbeRsAdapter`。V0.1 不需要 adapter 目录。

## 6. 错误处理

前端 `invokeNative<T>()` 负责把未知 Tauri rejection 归一化为 JavaScript `Error`。未来 Native command 出现可预期错误时，Rust 返回稳定、可序列化的错误 DTO，例如：

```ts
interface NativeError {
  kind: string;
  message: string;
}
```

保持错误结构简单；在出现真实串口、网络或设备错误分类需求前，不增加大型错误框架。

## 7. 路由与导航

- 路由定义位于 `src/app/router/index.ts`。
- Sidebar 结构位于 `src/app/router/navigation.ts`。
- 路由使用稳定的英文 name，显示文字使用 i18n key。
- 未实现页面复用 `PlaceholderPage`，但每个工具仍保留所属 module 的 view 入口。

增加工具页面时需要同时更新路由、导航和中英文资源。

## 8. 国际化

- 国际化实例位于 `src/app/i18n`。
- 当前 locale：`en`、`zh-CN`。
- 用户选择由 `useLocaleStore` 持久化。
- 新增任何面向用户的固定文字时，必须同时提供英文和简体中文文案。
- 代码标识、路由 name、command 名称和日志字段保持英文，不进行翻译。

## 9. 主题

- Naive UI theme token 管理组件主题。
- `src/styles/main.css` 中的 CSS Variables 管理应用壳层颜色和尺寸。
- 禁止在大量页面中散落硬编码背景色、边框色。
- 后续自定义主题或工程色卡应扩展 token，不替换现有边界。

## 10. 新增功能检查表

### 新增纯计算工具

1. 从 `main` 创建功能分支。
2. 在对应 module 中创建 `core` 纯函数。
3. 添加单元测试。
4. 添加或更新 view。
5. 更新路由、导航和双语文案。
6. 运行完整检查。

### 新增 Native 工具

1. 先定义前端 service 接口与 DTO。
2. 通过 `NativeService` 调用 command。
3. 创建薄 Rust command。
4. 在 Rust service 中实现用例。
5. 只有需要 OS/硬件替换边界时才创建 adapter。
6. 在 `lib.rs` 注册 command。
7. 添加前后端测试并实际启动 Tauri 验证。
