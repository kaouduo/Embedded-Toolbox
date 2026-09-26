# 构建、打包与发布

## 1. 构建前要求

先完成 [开发环境部署](./DEVELOPMENT.md)，并确认以下命令可用：

```powershell
vp --version
rustc --version
cargo --version
```

在项目根目录安装锁定依赖：

```powershell
vp install
```

## 2. 完整质量检查

提交或打包前执行：

```powershell
vp check
vp test --run
vp build
cargo check --manifest-path src-tauri/Cargo.toml
```

项目已包含数据转换 codec 测试，发布检查必须执行：

```powershell
vp test --run
```

## 3. 前端构建

```powershell
vp build
```

输出目录：

```text
dist/
```

可用以下命令本地预览：

```powershell
vp preview
```

前端构建成功不代表 Native 通信成功，发布前仍需运行完整桌面应用。

## 4. 桌面开发构建

```powershell
vp run tauri dev
```

该命令会执行 `src-tauri/tauri.conf.json` 中的 `beforeDevCommand`，然后通过 Cargo 编译和启动应用。

## 5. 桌面生产打包

```powershell
vp run tauri build
```

Tauri 会先执行 `vp build`，再编译 release Rust binary 并生成配置目标对应的安装包。典型输出位置：

```text
src-tauri/target/release/
src-tauri/target/release/bundle/
```

当前 `bundle.targets` 为 `all`。Windows 环境通常会生成 NSIS 与 MSI 等受本机工具支持的目标。MSI 构建还可能要求 Windows VBSCRIPT 可选功能；详见 Tauri 官方 Windows prerequisites。

## 6. 版本号维护

正式发布前同步更新：

1. `package.json` 的 `version`。
2. `src-tauri/Cargo.toml` 的 `package.version`。
3. `src-tauri/tauri.conf.json` 的 `version`。
4. `CHANGELOG.md`。

三个工程版本必须一致。修改 Rust 依赖后提交更新后的 `Cargo.lock`；修改前端依赖后提交更新后的 `pnpm-lock.yaml`。

## 7. 发布构建清单

- [ ] 当前分支由最新 `main` 创建
- [ ] 中英文文案完整
- [ ] `vp check` 通过
- [ ] `vp test --run` 通过，或 V0.1 明确确认暂无测试
- [ ] `vp build` 通过
- [ ] `cargo check` 通过
- [ ] `vp run tauri dev` 实际启动通过
- [ ] `vp run tauri build` 打包通过
- [ ] 在干净 Windows 环境安装并启动安装包
- [ ] 版本号一致
- [ ] CHANGELOG 已更新
- [ ] 不包含密钥、证书、设备日志或本地 `.env`

## 8. 签名与分发状态

V0.1 尚未配置代码签名、自动更新和 CI 发布。不要把本地签名证书或密码提交到 Git。正式对外发布前，应在独立分支中设计签名和 CI，并使用安全的 secret storage。

## 9. 清理构建产物

前端 `dist/`、Rust `target/` 和 `node_modules/` 均不提交到 Git。需要重新构建时直接运行相应 Vite+ 或 Cargo 命令，不要把生成目录当作源码维护。
