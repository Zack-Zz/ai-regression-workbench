# 本地工具打包与分发设计

## 1. 目标

将 `ai-regression-workbench` 交付为可安装、可初始化、可启动的本地工具，而不是一组零散脚本。

CLI 命令名建议统一为：

- `zarb`

命名说明：

- `zarb = Zack AI Regression Bench`

推荐用户体验：

- 安装完成后执行 `zarb`
- 首次运行自动完成初始化引导
- 初始化完成后直接启动本地工作台

外部参考文档：

- [OpenAI Codex CLI 官方文档](https://developers.openai.com/codex/cli)
- [Kiro CLI 官方文档](https://kiro.dev/docs/cli/)

第一阶段推荐形态：

- `本地 Web UI + Local App Process（CLI 仅启动入口）`

不建议第一阶段直接做桌面壳。

## 2. 推荐交付形态

### 2.1 第一阶段

以“HTML Web UI + Node.js 本地服务”形式交付，CLI 仅作为启动壳：

```bash
zarb
zarb init
zarb doctor
zarb ui
```

组成包括：

- CLI 启动入口
- 本地 orchestrator
- 本地 API / UI 服务
- 本地 SQLite
- 本地文件存储

建议默认行为：

```text
zarb
  -> 检查配置
  -> 如未初始化，执行 guided init
  -> 启动本地服务
  -> 打开 Web UI 工作台
```

### 2.2 第二阶段

可以演进为桌面应用壳：

- Electron
- Tauri

要求：

- 不重写核心业务逻辑
- 只在外层封装窗口、安装、升级体验

## 3. 安装方式

推荐方式：

- `npm install -g ai-regression-workbench`
- `pnpm add -g ai-regression-workbench`

也可以支持：

- 项目内 `devDependency`
- `npx ai-regression-workbench ...`

安装后主入口：

```bash
zarb
```

## 4. 初始化流程

首次执行 `zarb init` 时建议完成：

1. 创建本地目录
2. 初始化 `config.local.yaml`
3. 初始化 SQLite 文件
4. 执行数据库迁移并校验 schema 版本
5. 检查 Playwright 浏览器
6. 检查 git
7. 检查 code agent CLI 可用性
8. 记录默认 `target project path`

建议同时支持“隐式初始化”：

- 用户首次执行 `zarb`
- 若检测到未初始化，则自动进入初始化引导

## 5. 本地目录建议

可以支持两种模式：

### 5.1 项目内模式

```text
<repo>/
  .ai-regression-workbench/
    config.local.yaml
    data/
      sqlite/
      runs/
      artifacts/
      diagnostics/
      analysis/
      code-tasks/
      commits/
      generated-tests/
```

适合：

- 与当前项目强绑定
- 便于随仓库调试
- 工具和目标工程在同一仓库内

### 5.2 用户目录模式

```text
~/.ai-regression-workbench/
  config.local.yaml
  data/
    sqlite/
    runs/
    artifacts/
    diagnostics/
    analysis/
    code-tasks/
    commits/
    generated-tests/
```

适合：

- 全局工具使用
- 多仓库共享工具配置

## 5.3 目标项目目录配置

工具目录与目标项目目录可以是不同路径。

建议在配置中显式保存：

```yaml
workspace:
  targetProjectPath: /absolute/path/to/target/project
  gitRootStrategy: auto
  allowOutsideToolWorkspace: true
```

说明：

- `targetProjectPath` 是 Playwright 执行、code agent 搜索、修改、verify 的基础目录
- 工具自身的 SQLite、artifacts、analysis 仍保存在工具目录的 `data/` 子目录
- 如果目标项目目录变化，当前通过 Web UI 设置页更新配置（CLI 预留后续扩展）

## 5.4 共享测试集目录配置

团队共享测试集目录可以独立于目标项目目录存在。

建议配置：

```yaml
testAssets:
  sharedRoot: /absolute/or/relative/path
  sharedRootMode: auto
  requireGitForSharedRoot: false
```

建议行为：

- 未配置或路径不存在时，视为没有团队共享测试集
- 目录存在时，系统自动尝试加载
- 目录结构无效时，展示告警但不默认阻断整个工具

## 6. doctor 命令

建议提供：

```bash
zarb doctor
```

检查项：

- Node.js 版本
- Playwright 浏览器
- git
- SQLite 可写性
- SQLite `WAL` 模式是否启用
- 是否存在待执行迁移
- trace provider 配置
- log provider 配置
- Codex CLI
- Kiro CLI
- target project path 是否存在
- target project path 是否为有效 git 工程
- AI 敏感配置是否通过环境变量提供

建议进一步区分：

- Codex CLI 是否支持非交互执行
- Kiro CLI 是否支持启动交互式修复会话

## 7. UI 启动方式

建议提供：

```bash
zarb ui
```

行为：

- 启动本地 UI 服务
- 默认绑定 `127.0.0.1`
- 打印访问地址，例如 `http://127.0.0.1:3910`

但对于普通用户，建议优先使用：

```bash
zarb
```

由默认入口完成：

- 初始化检查
- 迁移检查
- app server 启动
- UI 打开

当前阶段业务操作和查看统一放在 Web UI，不再提供 CLI 业务命令入口。

## 8. 升级策略

第一阶段建议采用包管理器升级：

```bash
npm install -g ai-regression-workbench@latest
```

后续可增加：

- `zarb version`
- `zarb upgrade`

升级约束：

- 启动时必须先执行待迁移脚本再启动 app server
- 迁移失败时禁止进入业务页面
- 迁移状态应记录到 `system_events`

## 9. 为什么不先做桌面壳

因为当前系统还依赖：

- Playwright runtime
- 本地浏览器
- 本地 git
- code agent CLI
- trace/log provider 配置

第一阶段先稳定 `Web UI 主操作面 + CLI 最小启动壳` 更合理。

## 9.1 敏感配置约束

敏感配置例如 AI provider API Key，建议：

- 优先从环境变量读取
- `config.local.yaml` 中仅存环境变量名或占位符
- `doctor` 对明文敏感配置给出 warning

## 10. 一键启动体验

第一阶段建议明确目标体验：

### 10.1 安装

```bash
npm install -g ai-regression-workbench
```

### 10.2 启动

```bash
zarb
```

### 10.3 首次运行

若未初始化，自动进入 guided init：

- 设置目标项目目录
- 可选设置共享测试集目录
- 检查依赖
- 初始化本地目录和 SQLite

完成后自动启动工作台。

### 10.4 后续运行

```bash
zarb
```

直接启动本地工作台。

## 10.5 `report.port` 变更策略

第一阶段不做运行时热重绑。

行为建议：

- 保存配置时返回 `nextRunOnlyKeys=['report.port']`
- UI 提示“重启本地服务后生效”
- 下一次执行 `zarb` 时按新端口启动
