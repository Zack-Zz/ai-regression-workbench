# Test Assets 详细设计

## 1. 目标

Playwright 测试集资源必须支持：

- 正式共享测试资产管理
- 本地候选测试管理
- 运行时产物隔离
- 团队协作与 Git 管理

## 2. 资源分层

建议分成三类：

### 2.1 Shared Test Assets

团队共享的正式测试资产，纳入 Git 管理。

典型内容：

- `tests/`
- `pages/`
- `fixtures/`
- `helpers/`
- 测试数据

特点：

- 团队共享
- 走 Git review
- 是正式回归来源

### 2.2 Generated Candidate Assets

AI 生成或 AI 修复产生的候选测试资源。

特点：

- 默认不进入正式回归集
- 必须 review 后才能晋升

### 2.3 Runtime Artifacts

某次运行过程中产生的临时资源。

特点：

- 不属于测试资产本身
- 不进入 Git 正式管理

## 3. 建议目录

```text
<target-project>/
  packages/test-assets/
    tests/
      smoke/
      regression/
    pages/
    fixtures/
    data/
    helpers/

<tool-workspace>/
  data/
    generated-tests/
      <taskId>/
        candidate.spec.ts
    artifacts/
    diagnostics/
    analysis/
```

## 4. 可配置目录

团队共享测试目录必须可配置，而不是写死，也不要求必须位于目标项目内。

建议配置：

```yaml
testAssets:
  sharedRoot: /absolute/or/relative/path
  sharedRootMode: auto
  generatedRoot: ./.zarb/data/generated-tests
  includeSharedInRuns: true
  includeGeneratedInRuns: false
  requireGitForSharedRoot: false
```

说明：

- `sharedRoot`
  团队共享测试资产目录，可以是相对路径或绝对路径

- `sharedRootMode`
  `auto | relative-to-target | absolute`

- `generatedRoot`
  候选测试默认输出目录

- `includeSharedInRuns`
  是否默认执行共享正式测试

- `includeGeneratedInRuns`
  是否默认执行候选测试，第一阶段建议关闭

- `requireGitForSharedRoot`
  是否要求共享目录必须受 Git 管理，第一阶段建议默认关闭

### 4.1 路径解析规则

建议规则：

- `sharedRoot` 未配置
  视为当前没有团队共享测试集

- `sharedRoot` 为相对路径
  默认相对于 `workspace.targetProjectPath` 解析

- `sharedRoot` 为绝对路径
  直接作为共享测试集根目录使用

### 4.2 目录状态

建议将共享测试集目录解析为以下状态之一：

- `missing`
  未配置或解析后目录不存在

- `available`
  目录存在且可作为共享测试集加载

- `invalid`
  目录存在，但结构不合法或无法读取

设计要求：

- `missing` 不应视为致命错误
- `available` 时允许加载共享测试集
- `invalid` 时应展示配置告警

## 5. Git 管理建议

共享测试集应由 Git 管理指定目录。

建议规则：

- 正式测试资产只能来自 `sharedRoot`
- code agent 如需修改正式测试，必须在 `sharedRoot` 范围内受控修改
- 所有正式测试变更必须可通过 `git diff` review

补充说明：

- `sharedRoot` 可以位于目标项目目录外
- 若位于外部目录，可独立受 Git 管理，也可以先不强制 Git

## 6. 元数据模型

建议至少包含：

- `Scenario`
- `TestCase`
- `GeneratedTest`
- `ReviewRecord`

`TestCase` 建议字段：

- `id`
- `scenarioId`
- `name`
- `filePath`
- `testTitle`
- `suite`
- `tags`
- `sourceType`
- `reviewStatus`
- `enabled`
- `owner`
- `createdAt`
- `updatedAt`

`Scenario` 第一阶段来源：

- 正式测试中的 `scenarioId` 由测试资产元数据或测试文件注解静态声明
- AI exploration 可以提出 `candidateScenario`，但第一阶段不自动写入 `scenarios` 表
- 第一阶段不提供独立的 Scenario 管理 UI；后续再补专门入口

## 7. 执行选择策略

不要仅靠目录扫描决定要跑哪些测试。

建议流程：

```text
RunRequest
  ->
TestCaseRepository / AssetIndex
  ->
得到可执行 testcase 列表
  ->
转换为 Playwright 过滤条件
  ->
交给 Test Runner
```

补充：

- `regression` 模式走上面的标准路径
- `exploration` 模式不要求先命中现有 testcase，而是由 harness 驱动 `ExplorationAgent` 基于 `startUrls` 与预算执行
- `hybrid` 模式先跑 `regression`，再对未覆盖或高风险路径做 bounded exploration
- `hybrid` 模式下 exploration planning 应优先消费 regression 的失败结果、未覆盖页面和高风险 `focusAreas`

补充规则：

- 第一阶段 `RunRequest.selector` 仅支持单一主选择器（`suite | scenario | tag | testcase`）
- 若同时传入多个主选择器，视为参数错误并阻止启动 run
- 若未传入主选择器，使用配置默认值（建议默认 `suite=smoke`）
- 若 `includeSharedInRuns=true` 且 `sharedRootStatus=available`，则加载共享测试集
- 若 `sharedRootStatus=missing`，则跳过共享测试集，不报致命错误
- 若 `sharedRootStatus=invalid`，则展示告警，并由用户决定是否继续
- 若共享测试集加载失败但候选测试仍可执行，记录 degraded 并继续
- 若可执行 testcase 集为空且无可继续路径，终止 run 并生成执行报告

## 7.1 GeneratedTestDraft 生命周期

第一阶段按“候选产物优先”设计，不直接自动晋升为正式测试：

```text
AI 生成 GeneratedTestDraft
  ->
落盘到 generated-tests/<taskId>/
  ->
reviewStatus = draft
  ->
人工 review
  ->
approved candidate / rejected
  ->
显式 promote 到 sharedRoot（后续动作）
```

约束：

- `includeGeneratedInRuns=true` 仅允许执行 `approved candidate`，不执行 `draft`
- 第一阶段不要求实现自动 promote API；人工晋升可以作为后续动作
- 第一阶段不做自动去重；候选测试是否与现有测试重复，由 review 阶段判断

## 8. 设计约束

- 正式共享测试和候选测试必须分开
- 运行产物不得混入共享测试目录
- 每个测试用例必须能提取 `scenarioId / testcaseId`
- UI 必须展示共享测试目录的解析结果与当前状态（CLI 为后续可选扩展）
