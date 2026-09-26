# 协作与 Git 工作流

本文是 Embedded Toolbox 的强制维护流程。V0.1 初始基线提交是唯一允许直接提交到默认分支的初始化操作；基线建立后，所有修改都必须通过独立分支合并到 `main`。

## 1. 分支职责

- `main`：始终保持可检查、可构建、可启动。
- 功能分支：开发新能力。
- 修复分支：修复缺陷。
- 文档分支：仅文档或维护说明。
- 重构分支：不改变功能行为的结构调整。

不要长期保留偏离 `main` 的大型分支。

## 2. 分支命名

```text
feat/<short-name>
fix/<short-name>
docs/<short-name>
refactor/<short-name>
chore/<short-name>
test/<short-name>
```

示例：

```text
feat/number-converter
fix/theme-persistence
docs/update-build-guide
```

分支名使用小写英文和连字符，不使用空格。

## 3. 开始修改

每次开始工作前：

```powershell
git switch main
git pull --ff-only
git switch -c feat/<short-name>
```

如果当前仓库尚未配置远端，可跳过 `git pull --ff-only`，但仍必须从本地最新 `main` 创建分支。

禁止在 `main` 上直接修改后再临时创建分支。开始修改前先确认：

```powershell
git branch --show-current
git status
```

## 4. 开发过程

- 保持提交范围单一。
- 不混入无关格式化或重构。
- 不提交 `node_modules/`、`dist/`、`target/`、`.env` 或设备日志。
- 新增用户界面文案时同步维护英文和简体中文。
- 新增 Native 调用时遵守 Service → NativeService → Command → Rust Service 边界。
- 依赖操作统一使用 `vp add`、`vp remove`、`vp update` 和 `vp install`。

## 5. 提交信息

建议使用 Conventional Commits：

```text
feat: add number conversion core
fix: restore persisted locale on startup
docs: document Windows build prerequisites
refactor: isolate native command error mapping
test: cover IEEE754 conversion cases
chore: update locked dependencies
```

提交前检查暂存内容：

```powershell
git status
git diff --check
git diff --cached
```

## 6. 合并前验证

```powershell
vp check
vp test --run
vp build
cargo check --manifest-path src-tauri/Cargo.toml
vp run tauri dev
```

涉及安装包、Tauri 配置或 Native 依赖时，还需执行：

```powershell
vp run tauri build
```

## 7. 合并到 main

先把功能分支同步到最新 `main` 并解决冲突：

```powershell
git switch main
git pull --ff-only
git switch <feature-branch>
git rebase main
```

重新运行检查。确认通过后合并：

```powershell
git switch main
git merge --no-ff <feature-branch>
```

合并后再次执行至少：

```powershell
vp check
vp build
cargo check --manifest-path src-tauri/Cargo.toml
```

推送并删除已完成分支：

```powershell
git push origin main
git branch -d <feature-branch>
git push origin --delete <feature-branch>
```

如果团队使用 Pull Request，PR 审核和 CI 通过后再合并，并在仓库平台保护 `main`：禁止直接 push、要求检查通过、要求分支为最新。

## 8. 紧急修复

紧急修复也必须创建 `fix/*` 分支：

```powershell
git switch main
git pull --ff-only
git switch -c fix/<issue-name>
```

不得以“紧急”为由绕过检查或直接提交到 `main`。

## 9. 保持开发环境稳定

- 提交并维护两个锁文件。
- 不随意切换包管理器。
- 不绕过 Vite+ 引入平行 lint/format/test 工具链。
- 更新 Vite+、Tauri、Vue、TypeScript 或 Rust MSRV 时单独创建 `chore/*` 分支。
- 工具链升级必须记录旧版本、新版本、兼容问题和验证结果。
- 合并前确认 README 与 `docs/` 仍与实际命令一致。
