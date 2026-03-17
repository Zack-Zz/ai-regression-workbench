# Phase 11-15 实现方案设计

## Phase 11：真实 Playwright 执行（test-runner）

### 现状

`apps/test-runner` 已有骨架，`RunService` 调用 `runner.run()` 但实际只做 DB 状态更新，不执行真实测试。

### 方案

**执行模型**：`zarb` 进程内 spawn 子进程执行 `playwright test`，通过 `--reporter=json` 获取结构化结果，实时解析进度写入 DB。

**核心接口**（已存在，不变）：
```ts
interface TestRunner {
  run(input: RunnerInput): Promise<RunnerResult>;
}
```

**实现步骤**：

1. `apps/test-runner/src/index.ts` 实现 `PlaywrightTestRunner`：
   - `spawn('npx', ['playwright', 'test', '--reporter=line,json', '--output-dir', artifactDir], { cwd: projectPath })`
   - 解析 stdout JSON 行，每个 testcase 结果写 `test_results` 表
   - 失败 testcase 的 screenshot/video/trace 从 `outputDir` 复制到 `artifacts/` 下
   - 网络日志从 Playwright trace 文件提取（`playwright show-trace --json`）

2. `RunService` 的 runner 调用已经存在，只需 `TestRunner` 实现真实逻辑

3. correlation context 从网络日志中提取 traceId/requestId（按 `diagnostics.correlationKeys` 配置）

**关键约束**：
- runner 启动失败（找不到 playwright、项目路径不存在）→ Run 状态设为 `FAILED`，不影响其他 Run
- testcase 级别失败不中断整个 Run
- artifact 路径遵循 `storage-mapping-design.md` 的相对路径规则

---

## Phase 14：真实 Review/Commit（review-manager）

### 现状

`apps/review-manager` 已有 `CommitManager`，但 `createCommit()` 只写 DB 记录，不执行真实 git 操作。

### 方案

**执行模型**：`CommitManager.createCommit()` 在 target workspace 执行 `git add` + `git commit`，返回 commit SHA。

**实现步骤**：

1. `apps/review-manager/src/commit-manager.ts` 的 `createCommit()` 加真实 git 操作：
   ```ts
   // 1. git add <changedFiles>
   // 2. git commit -m "<message>"
   // 3. 读取 HEAD SHA 写入 DB
   ```
   使用 `child_process.execSync` 或 `simple-git`（轻量依赖）。

2. 失败处理：
   - git 未初始化 → `errorCode: 'GIT_NOT_INITIALIZED'`
   - 工作区有未暂存变更 → `errorCode: 'GIT_DIRTY_WORKSPACE'`
   - commit 失败 → 状态设为 `COMMIT_FAILED`，保留 diff/patch 不丢失

3. `review accept` 仍然不自动 commit，只有显式 `POST /commits` 才触发

**关键约束**：
- commit 只操作 `changedFiles` 列表中的文件，不做 `git add .`
- commit message 包含 taskId 和 runId 便于追溯
- commit SHA 写入 `commits` 表的 `commit_sha` 字段

---

## Phase 15：产品打包与初始化

### 现状

`apps/cli/src/bin.ts` 存在但 `zarb init` 流程未实现，`package.json` 是 `private: true`，没有发布配置。

### 方案

**v0.1.0 分发模型**（设计文档已定义）：
```
clone repo → pnpm install && pnpm build → cd apps/cli && npm link
```
不发布到 npm registry，`private: true` 保持。

**`zarb init` 流程**：

```
zarb init
  1. 检查 Node >= 22、pnpm >= 10
  2. 检查 playwright 是否安装（npx playwright --version）
  3. 检查 git 是否可用
  4. 检查 kiro/codex CLI 是否可用（按 codeAgent.engine 配置）
  5. 创建 .ai-regression-workbench/config.local.yaml（从模板）
  6. 运行 DB migrations
  7. 打印 "zarb 已就绪，运行 zarb 启动工作台"
```

**`zarb doctor` 已实现**，init 完成后 doctor 应全部 pass。

**实现步骤**：

1. `apps/cli/src/bin.ts` 加 `init` 子命令，调用 `DoctorService` 做环境检查
2. 加 config 模板文件 `apps/cli/src/templates/config.local.yaml.tpl`
3. 加 migration runner 调用（已有 `runMigrations`，只需在 init 时调用）
4. `zarb` 默认命令（无子命令）：检查是否已初始化，未初始化则引导 init，已初始化则启动服务

**浏览器检查**：
```ts
// 检查 playwright chromium 是否已安装
execSync('npx playwright install --dry-run chromium', { stdio: 'pipe' });
```

---

## 实现优先级建议

```
Phase 11 (test-runner) → Phase 14 (commit) → Phase 15 (packaging)
```

Phase 11 是整个产品循环的入口，没有真实 runner 输出，后续的诊断、AI 分析、CodeTask 都无法端到端验证。

Phase 14 相对独立，可以在 Phase 11 进行中并行推进。

Phase 15 最后做，等核心循环跑通后再打包。
