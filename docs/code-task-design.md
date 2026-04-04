# CodeTask 与 Review 详细设计

## 1. 模块目标

`CodeTask` 模块负责受控代码修复、验证、review 和 commit 记录。

当前设计目标不是“全自动修复闭环”，而是：

- 自动准备上下文
- 受控执行代码修改
- 用系统侧 verify 判断结果
- 在 review 和 commit 节点保留人工控制

参考文档：

- [Agent Harness 详细设计](./agent-harness-design.md)
- [Agent 智能化与运行时分层设计](./agent-intelligence-refactor-plan.md)

---

## 2. 当前核心流程

```text
FailureAnalysis
  ->
CodeTask Draft（1:N）
  ->
PENDING_APPROVAL
  ->
APPROVED
  ->
RUNNING
  ->
VERIFYING
  ->
SUCCEEDED / FAILED
  ->
Review Action（accept / reject / retry；verify 失败时可做 override accept）
  ->
COMMIT_PENDING
  ->
COMMITTED
```

说明：

- `REVIEW` 是动作阶段，不是 `CodeTaskStatus`
- verify 失败后默认停在 `FAILED`
- `SUCCEEDED` 只表示 apply + verify 成功，不表示整个任务链结束
- review retry 创建新的子 `CodeTask`

当前 `CodeTaskStatus`：

- `DRAFT`
- `PENDING_APPROVAL`
- `APPROVED`
- `RUNNING`
- `VERIFYING`
- `SUCCEEDED`
- `COMMIT_PENDING`
- `COMMITTED`
- `FAILED`
- `REJECTED`
- `CANCELLED`

---

## 3. Code Repair 执行模型

### 3.1 角色划分

- `CodeRepairAgent`
  负责有限预算自治 loop、prompt、memory、上下文装配
- `CodexCliAgent` / `KiroCliAgent`
  负责 transport 执行
- `ArtifactWriter`
  负责 diff / patch / verify / changed files / runtime summary 的系统产物
- `CodeTaskService`
  负责任务状态推进

### 3.2 当前真实链路

```text
CodeTaskService.runExecution()
  -> CodeRepairAgent.executeUntilSettled()
    -> select relevant memories
    -> assemble code repair context
    -> ReadOnlyPlanAgent 生成 plan / critical files / checklist
    -> build plan prompt and record sample
    -> build apply prompt
    -> transport.run()
    -> build verify prompt and record sample
    -> ArtifactWriter.generateArtifacts()
    -> VerificationAgent 生成 verdict / adversarial checks / retry decision
    -> 若 verdict=retry 且预算未耗尽，则继续下一轮
  -> final verify passed ? SUCCEEDED : FAILED
  -> failure / retry decision / review feedback 写入 code_task_memories
```

### 3.3 当前能力边界

当前已实现：

- task-aware prompt 上下文
- `ReadOnlyPlanAgent`
- `VerificationAgent`
- `CodeRepairTaskLedger`
- relevant memory 选择（结合 goal、scope paths、verification commands、testcase）
- staged prompt samples
- apply failure / verify failure / retry decision 记忆沉淀
- 有限预算自动 retry
- 近似 token budget 控制
- token budget 紧张时的 auto compact
- no-progress 提前停止，避免连续重复失败耗尽全部预算
- final stop hooks 与 budget snapshot
- transport 与 runtime 分离
- budget snapshot 现在显式带 `maxCompactions`，方便和 exploration 统一展示预算视图

当前未实现：

- 更强的 auto compact 策略
- 更强的策略重规划，而不只是根据新 memory 再执行主链

因此 `CodeRepairAgent` 当前应被视为：

`受控 bounded autonomous runtime`，不是 `full autonomous repair loop`。

### 3.4 当前新增的中间事实

当前 code repair 运行时已经不再只产出一段 plan summary。

它现在还会产出：

- `criticalFiles`
- `checklist`
- `retryStrategy`
- `taskLedger`
- `VerificationAgent verdict`
- `adversarialChecks`
- `retry-decision` 的最终自动化结论（继续、attempt budget exhausted、token budget exhausted、no progress）
- `budget snapshot`
- `maxCompactions`
- `compacted retry memory`
- `compacted carry-over memory`（下一轮替代同任务旧的 verbose failure memory）

这些对象的目标是让后续自动重试、人工 review 和 trace 查阅共享同一套结构化事实。

当前 `retryStrategy` 已经不是泛化建议，而是会尽量给出：

- 重复触碰的失败文件
- 重复出现的失败验证信号
- “上一轮没有落成实际 diff” 这类 no-op 尝试提醒
- 下一轮建议扩展的相邻 scope/test 目标
- 应避免继续重复的窄改动模式

同时 `no progress` 判断也不再依赖整段 verify 输出全文相等，而是优先比较提炼后的失败信号，避免因为日志噪音、耗时、额外堆栈差异而误判成“还有进展”。

同时 apply prompt 已经把这些结构化事实分区展开：

- `Critical Files`
- `Checklist`
- `Retry Strategy`

---

## 4. 关键对象

### 4.1 CodeTask

`CodeTask` 必须绑定目标工作区：

- `workspacePath`
- `scopePaths`
- `goal`
- `constraints`
- `verificationCommands`
- `parentTaskId`
- `attempt`
- `automationLevel`

### 4.2 Review

review 必须绑定本次任务的系统产物快照，而不是 agent 自报内容。

要求：

- review 绑定 `codeTaskVersion`
- review 绑定 diff / patch 哈希
- verify 失败时只有显式 override 才允许 accept

### 4.3 CommitRecord

commit 是独立动作，不自动跟随 review。

要求：

- staging 只覆盖当前任务的 `changedFiles`
- 不允许把不相关脏文件一起提交

---

## 5. 产物与事实来源

系统事实优先级：

1. workspace/git 派生结果
2. verify 输出
3. session / prompt / tool call 记录
4. agent 自然语言输出

因此：

- `changedFiles`、`diffPath`、`patchPath` 必须以系统计算为准
- `rawOutputPath` 可以保留 agent 原始输出
- 最终成功与否以系统 verify 为准

必须保留的产物：

- `raw-output.txt`
- `changes.diff`
- `changes.patch`
- `verify.txt`
- `runtime-summary.json`

其中 `runtime-summary.json` 当前会同步暴露到 `CodeTaskDetail.runtimeSummary`，用于展示：

- final status / stop reason / budget snapshot
- 每轮 attempt 的 `plan / retryStrategy / verificationVerdict`
- 每轮 attempt 的 `taskLedger / changedFiles`

---

## 6. review 与失败语义

### 6.1 verify 失败

- 任务进入 `FAILED`
- diff / patch / raw output / verify output 仍需保留
- 系统会额外记录 `VerificationAgent` 的 retry decision
- 若策略允许，可进入 override review
- 用户仍可选择 retry 生成新的子任务

### 6.2 retry

- `retryCodeTask` 不回退旧任务状态
- 必须创建新的 `CodeTask`
- 新任务通过 `parentTaskId` 关联旧任务
- memory 应能吸收旧任务失败原因
- 当前系统已经会在单个 `CodeTask` 内做有限预算自动 retry
- 预算耗尽后，人工仍可通过 `retryCodeTask` 创建新的子任务版本

### 6.3 review override

当前策略通过 `reviewOnVerifyFailureAllowed` 控制是否允许 verify 失败后继续进入 review。

这代表的是业务策略，不代表 `CodeRepairAgent` 自己已经完成了 retry 决策闭环。

---

## 7. Transport 设计

### 7.1 CodexCliAgent

适合作为 `headless` transport：

- 自动执行
- 由 runtime 提供结构化 prompt
- 结果由系统二次验证

### 7.2 KiroCliAgent

适合作为 `interactive` transport：

- 用户接管的复杂修复会话
- 不要求严格 machine-readable 输出

原则：

- transport 不承担系统事实判断
- runtime 不应假设不同 transport 的输出格式完全一致

---

## 8. 当前推荐设计口径

不要再用 `CodeAgent` 这个过于笼统的词描述当前实现。

统一采用：

- `CodeRepairAgent`
- `ReadOnlyPlanAgent`
- `VerificationAgent`
- `CodeRepairTransport`
- `CodexCliAgent`
- `KiroCliAgent`

这样可以明确区分：

- runtime
- transport
- 业务服务
