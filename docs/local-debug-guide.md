# 本地开发与调试指南

## 1. 环境要求

| 工具 | 最低版本 | 说明 |
|---|---|---|
| Node.js | 22.0.0 | `node --version` |
| pnpm | 10.0.0 | `pnpm --version` |
| kiro CLI | 任意 | `kiro --version`（CodeTask 执行用） |

## 2. 首次初始化

```bash
# 克隆后安装依赖
pnpm install

# 构建所有包（必须先 build，typecheck 和测试依赖编译产物）
pnpm -r build

# 初始化工作台数据目录和配置文件
node apps/cli/dist/bin.js init
```

初始化后会生成：
```
.ai-regression-workbench/
  config.local.yaml   ← 本地配置，不进 git
  data/
    sqlite/zarb.db    ← SQLite 数据库
```

## 3. 启动服务

### 方式一：生产模式（单进程，API + UI 合并）

```bash
# 先构建 UI
pnpm --filter @zarb/local-ui build

# 启动 CLI 服务（默认端口 3910）
node apps/cli/dist/bin.js

# 访问
open http://127.0.0.1:3910
```

### 方式二：开发模式（推荐，热重载）

需要两个终端：

**终端 1 — API 服务**
```bash
# 监听 CLI 源码变化并重新编译
cd apps/cli
npx tsc -p tsconfig.json --watch &

# 启动 API 服务（端口 3910）
node dist/bin.js
```

> 每次修改 `apps/cli/src/` 后，tsc watch 会重新编译，手动重启 `node dist/bin.js` 即可。

**终端 2 — UI 开发服务器**
```bash
cd apps/local-ui
pnpm dev
# 访问 http://localhost:5173
# UI 请求自动代理到 http://localhost:3910
```

UI 代理配置在 `apps/local-ui/vite.config.ts`：
```ts
proxy: {
  '/api': { target: 'http://localhost:3910', rewrite: (p) => p.replace(/^\/api/, '') }
}
```

## 4. 修改包后的重新构建

项目是 monorepo，下游包依赖上游包的编译产物（`dist/`）。修改某个包后需要重新 build：

```bash
# 修改了 packages/shared-types
pnpm --filter @zarb/shared-types build

# 修改了 packages/storage
pnpm --filter @zarb/storage build

# 修改了 packages/agent-harness
pnpm --filter @zarb/agent-harness build

# 修改了 packages/config
pnpm --filter @zarb/config build

# 修改了 apps/ai-engine
pnpm --filter @zarb/ai-engine build

# 全量重建（慢，但保证一致）
pnpm -r build
```

**常见问题**：修改了 `shared-types` 但 typecheck 还报旧类型错误 → 先 `pnpm --filter @zarb/shared-types build` 再重试。

## 5. 运行测试

```bash
# 全量测试（根目录，收集所有包的测试）
pnpm test

# 监听模式（开发时推荐）
pnpm test:watch

# 只跑某个包的测试
pnpm --filter @zarb/cli test

# 只跑某个测试文件
npx vitest run apps/cli/test/integration.test.ts
```

测试文件位置：`packages/*/test/**/*.test.ts` 和 `apps/*/test/**/*.test.ts`

## 6. 类型检查

```bash
# 全量 typecheck
pnpm -r typecheck

# 只检查某个包
pnpm --filter @zarb/cli typecheck
pnpm --filter @zarb/local-ui typecheck
```

## 7. 配置文件说明

`.ai-regression-workbench/config.local.yaml` 关键字段：

```yaml
report:
  port: 3910          # API 服务端口

ai:
  activeProvider: openai   # 当前激活的 AI provider
  providers:
    openai:
      apiKey: sk-xxx       # 直接填 key（本地文件，不进 git）
      model: gpt-4o
    deepseek:
      apiKey: sk-xxx
      model: deepseek-chat

trace:
  provider: skywalking     # 或 jaeger
  endpoint: http://localhost:12800

codeAgent:
  engine: kiro             # 或 codex

workspace:
  targetProjectPath: /path/to/your/playwright/project
```

## 8. VSCode 调试配置

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
        "OPENAI_API_KEY": "${env:OPENAI_API_KEY}"
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
    }
  ]
}
```

> `sourceMap: true` 已在 `tsconfig.base.json` 中开启，断点可以直接打在 `src/` 源文件上。

## 9. 常用调试命令

```bash
# 检查环境和配置是否正常
node apps/cli/dist/bin.js doctor

# 查看 SQLite 数据（需要安装 sqlite3 CLI）
sqlite3 .ai-regression-workbench/data/sqlite/zarb.db ".tables"
sqlite3 .ai-regression-workbench/data/sqlite/zarb.db "SELECT * FROM runs ORDER BY created_at DESC LIMIT 5;"

# 查看 API 是否正常响应
curl http://127.0.0.1:3910/settings | jq .
curl http://127.0.0.1:3910/runs | jq .

# 手动触发一次 Run（需要先配置 targetProjectPath）
curl -X POST http://127.0.0.1:3910/runs \
  -H "Content-Type: application/json" \
  -d '{"runMode":"regression"}'
```

## 10. 目录结构速查

```
apps/cli/src/
  bin.ts              ← CLI 入口（zarb / zarb init / zarb doctor）
  server.ts           ← HTTP 服务器组装（依赖注入）
  handlers/index.ts   ← 所有 API 路由
  services/
    run-service.ts        ← Run 生命周期
    code-task-service.ts  ← CodeTask 执行
    diagnostics-service.ts← trace/log 诊断
    doctor-service.ts     ← 环境检查

apps/local-ui/src/
  App.tsx             ← 路由
  api.ts              ← 所有 API 调用
  pages/              ← 各页面组件

packages/
  shared-types/       ← DTO、接口定义（改这里要先 build）
  storage/            ← SQLite repositories + migrations
  config/             ← 配置加载、合并、脱敏
  agent-harness/      ← CodexCliAgent、KiroCliAgent、HarnessSessionManager
  ai-engine/          ← AIProvider、LocalAIEngine
```
