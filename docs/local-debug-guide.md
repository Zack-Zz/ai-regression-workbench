# 本地开发与调试指南

## 1. 外部依赖（需提前安装）

### 必须

| 工具 | 安装方式 | 用途 |
|---|---|---|
| Node.js ≥ 22 | https://nodejs.org 或 `nvm install 22` | 运行时 |
| pnpm ≥ 10 | `npm install -g pnpm` | 包管理 |

### 按功能选装

| 工具 | 安装方式 | 用途 | 不装的影响 |
|---|---|---|---|
| kiro CLI | https://kiro.dev/docs/cli/ | CodeTask 执行（默认 engine） | CodeTask 执行会失败，其他功能正常 |
| Playwright 浏览器 | `npx playwright install chromium` | 真实回归测试执行 | 只能用 mock runner，无法跑真实测试 |
| SkyWalking OAP | 自行部署 | Trace 诊断 | trace 面板显示"provider 未配置"原因 |
| Loki | 自行部署 | 日志诊断 | log 面板显示"provider 未配置"原因 |

> trace/log/AI 均有降级处理，不安装不影响启动和基本流程，只影响对应功能。

### better-sqlite3（native 模块）

`pnpm install` 时会通过 `prebuild-install` 自动下载预编译 binary，支持 Node 20/22/24，**无需本地 C++ 编译工具**。

如果网络受限导致预编译 binary 下载失败，会 fallback 到从源码编译，此时需要：

- macOS：`xcode-select --install`
- Linux：`apt install build-essential python3`
- Windows：安装 Visual Studio Build Tools

---

## 2. 打包（构建产物）

### 完整打包流程

```bash
# 1. 安装所有依赖
pnpm install

# 2. 按依赖顺序构建所有包
pnpm -r build
```

构建顺序（pnpm 自动按 workspace 依赖拓扑排序）：
```
shared-types → storage → config → agent-harness → ai-engine
             → trace-bridge → log-bridge → review-manager → test-runner
             → cli (依赖以上所有)
             → local-ui (独立，Vite 构建)
```

### 单包构建（修改某个包后）

```bash
pnpm --filter @zarb/shared-types build   # 改了类型定义
pnpm --filter @zarb/storage build        # 改了 DB/repository
pnpm --filter @zarb/config build         # 改了配置逻辑
pnpm --filter @zarb/agent-harness build  # 改了 agent
pnpm --filter @zarb/ai-engine build      # 改了 AI engine
pnpm --filter @zarb/cli build            # 改了 API/服务
pnpm --filter @zarb/local-ui build       # 改了 UI（Vite 构建）
```

> **注意**：修改上游包后必须先 build 上游，再 build 下游。例如改了 `shared-types` 后，`cli` 的 typecheck 才能看到新类型。

### 构建产物位置

```
packages/*/dist/          ← TypeScript 编译产物（.js + .d.ts + .js.map）
apps/cli/dist/            ← CLI 编译产物，bin.js 是入口
apps/local-ui/dist/       ← Vite 打包的静态文件，CLI 启动时内嵌服务
```

---

## 3. 初始化工作台

首次运行前需要初始化数据目录和数据库：

```bash
node apps/cli/dist/bin.js init
```

生成：
```
.ai-regression-workbench/
  config.local.yaml   ← 本地配置（不进 git）
  data/
    sqlite/zarb.db    ← SQLite 数据库（自动执行 migrations）
```

---

## 4. 运行方式

### 方式一：生产模式（单进程，API + UI 合并）

```bash
# 确保 local-ui 已构建
pnpm --filter @zarb/local-ui build

# 启动（默认端口 3910）
node apps/cli/dist/bin.js

# 访问
open http://127.0.0.1:3910
```

### 方式二：开发模式（推荐，UI 热重载）

需要两个终端：

**终端 1 — API 服务**
```bash
# 构建 CLI（每次修改 src/ 后重新执行）
pnpm --filter @zarb/cli build

# 启动 API（端口 3910）
node apps/cli/dist/bin.js
```

**终端 2 — UI 开发服务器**
```bash
cd apps/local-ui
pnpm dev
# 访问 http://localhost:5173（自动代理 /api → localhost:3910）
```

---

## 5. 调试运行

> `.vscode/` 和 `.idea/` 均在 `.gitignore` 中，不进代码仓库，需要本地手动配置。

### WebStorm — 配置 Run/Debug Configuration

**步骤**：Run → Edit Configurations → 点 `+` → 选 **Node.js**

#### zarb server（调试模式）

| 字段 | 值 |
|---|---|
| Name | `zarb server` |
| Node interpreter | 系统 Node（≥22） |
| Node parameters | `--inspect` |
| JavaScript file | `apps/cli/dist/bin.js` |
| Working directory | 项目根目录 |
| Environment variables | `OPENAI_API_KEY=sk-xxx;DEEPSEEK_API_KEY=sk-xxx`（可选，也可写在 config.local.yaml） |

配置好后点**虫子图标**启动，可在 `apps/cli/src/` 任意 `.ts` 源文件打断点（sourceMap 已在 `tsconfig.base.json` 全局开启）。

#### vitest（全量测试）

| 字段 | 值 |
|---|---|
| Name | `vitest (all)` |
| JavaScript file | `node_modules/.bin/vitest` |
| Application parameters | `run` |
| Working directory | 项目根目录 |

#### vitest（监听模式，开发时推荐）

同上，**Application parameters** 留空即可（vitest 默认 watch 模式）。

**单个测试文件调试**：在测试文件编辑器左侧行号旁点击绿色箭头 → "Debug '文件名'"，WebStorm 会自动用 vitest 运行并附加调试器。

---

### VSCode — 配置 launch.json

在项目根目录创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "zarb server",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/apps/cli/dist/bin.js",
      "cwd": "${workspaceFolder}",
      "sourceMaps": true,
      "outFiles": ["${workspaceFolder}/apps/cli/dist/**/*.js"],
      "env": {
        "OPENAI_API_KEY": "${env:OPENAI_API_KEY}",
        "DEEPSEEK_API_KEY": "${env:DEEPSEEK_API_KEY}"
      }
    },
    {
      "name": "vitest (current file)",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/vitest",
      "args": ["run", "${relativeFile}"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    },
    {
      "name": "vitest (all)",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/vitest",
      "args": ["run"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    }
  ]
}
```

---

### 命令行调试（不依赖 IDE）

```bash
# 启动并等待 debugger 连接（适合 Chrome DevTools 或任意支持 CDP 的调试器）
node --inspect-brk apps/cli/dist/bin.js

# 启动后立即运行，随时可连接
node --inspect apps/cli/dist/bin.js
```

连接方式：
- Chrome：打开 `chrome://inspect` → "Open dedicated DevTools for Node"
- WebStorm：Run → Attach to Node.js/Chrome → 端口 9229

---

## 6. 验证环境

```bash
# 检查所有依赖和配置是否正常
node apps/cli/dist/bin.js doctor
```

输出示例：
```
  ✓ storage.sqlitePath: /path/to/zarb.db
  ✓ workspace.targetProjectPath: /path/to/project
  ✓ ai.apiKey: API key configured directly
  ⚠ trace.config: endpoint not configured
  ✓ kiro: available at /usr/local/bin/kiro
```

---

## 7. 常用调试命令

```bash
# 查看数据库内容
sqlite3 .ai-regression-workbench/data/sqlite/zarb.db ".tables"
sqlite3 .ai-regression-workbench/data/sqlite/zarb.db \
  "SELECT id, status, run_mode, created_at FROM runs ORDER BY created_at DESC LIMIT 5;"

# 测试 API 是否正常
curl http://127.0.0.1:3910/settings | jq .
curl http://127.0.0.1:3910/runs | jq .

# 手动创建一次 Run
curl -X POST http://127.0.0.1:3910/runs \
  -H "Content-Type: application/json" \
  -d '{"runMode":"regression"}'

# 全量 typecheck
pnpm -r typecheck

# 全量测试
pnpm test

# 监听测试（开发时）
pnpm test:watch
```

---

## 8. 常见问题

**Q：typecheck 报旧类型错误，明明已经改了 shared-types**
```bash
pnpm --filter @zarb/shared-types build
# 然后重新 typecheck
```

**Q：`better-sqlite3` 安装失败**

正常情况下 `pnpm install` 会自动下载预编译 binary，无需额外操作。

如果在网络受限环境下下载失败并 fallback 到源码编译：
```bash
# macOS
xcode-select --install
pnpm install
```

**Q：UI 访问 5173 但 API 请求 404**
- 确认 `node apps/cli/dist/bin.js` 已在 3910 端口启动
- 检查 `vite.config.ts` 的 proxy 目标端口是否匹配

**Q：`zarb init` 后 doctor 报 `workspace.targetProjectPath` 不存在**
- 编辑 `.ai-regression-workbench/config.local.yaml`，填入你的 Playwright 项目路径

**Q：CodeTask 执行失败，报 kiro not found**
- 安装 kiro CLI：https://kiro.dev/docs/cli/
- 或在 `config.local.yaml` 中改为 `codeAgent.engine: codex` 并安装 codex CLI
