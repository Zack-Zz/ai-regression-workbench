# Phase 2 开发 Review 记录

> 评审日期：2026-03-14
> 评审范围：Phase 2 storage + migrations
> 当前结论：未通过，存在 schema / repository / path rule 三类问题

## 1. 结论

Phase 2 已补出 SQLite 打开、migration runner、路径 helper 和一批 repository，但当前实现还没有满足“schema matches design and storage mapping / relative path rules are enforced / repository supports orchestrator + harness read/write paths”的退出条件。

本轮 review 发现 2 个高优先级问题和 2 个中优先级问题。

## 2. Findings

### 2.1 High

- `CodeTaskRepository` 和初始 DDL 使用了不在共享类型中的默认枚举值
  - `automation_level` 默认写成了 `semi`
  - `mode` 默认写成了 `fix`
  - 这两个值都不在 `AutomationLevel` / `CodeTaskMode` 的定义里
  - 风险：
    - 数据库里会落入 DTO 无法表达的非法状态值
    - 后续 API/UI/状态机会出现类型与存储不一致

- `test_runs` schema / repository 严重缺字段，无法承接设计要求的运行时状态
  - 缺少 `exploration_config_json`
  - 缺少 `pause_requested / current_stage / paused_at`
  - 缺少汇总字段 `total / passed / failed / skipped / summary`
  - Repository 也没有相应读写接口
  - 风险：
    - 直接阻塞 Phase 4 orchestrator 实现
    - `hybrid/exploration` 运行和 pause/resume 语义无法落库

### 2.2 Medium

- 路径 helper 没有真正“强制相对路径”
  - 当前只使用 `path.join()` 拼接
  - 对 `../` 之类输入会发生路径归一化，可能逃逸出预期子目录
  - 风险：
    - 违反存储映射里“相对路径、受控子目录”的约束
    - 后续若直接用外部传入的 id 生成路径，会有路径逃逸风险

- `reviews` 的 schema / repo 与设计契约仍未对齐
  - 缺少 `patch_hash`
  - 时间字段使用 `reviewed_at`，与设计里的 `created_at` 不一致
  - 风险：
    - Review DTO、持久层、后续 API 映射会继续漂移

## 3. 验证结果

本轮实际执行结果如下：

- `pnpm test`
  - 结果：通过
- `pnpm -r typecheck`
  - 结果：通过
- `pnpm build`
  - 结果：通过

说明当前问题主要是契约和存储语义层面的，不是编译失败。

## 4. 修复建议

- 把 `code_tasks` 的默认值和 repository 默认值改回设计允许的枚举集合。
- 以 `docs/design.md` / `docs/storage-mapping-design.md` 为准，补齐 `test_runs`、`code_tasks`、`reviews` 等表的字段，并同步 repository 入参/返回模型。
- 为路径 helper 增加明确的 segment 校验，拒绝 `..`、绝对路径和空段，而不是只检查“结果是否以 `/` 开头”。
- 增补能覆盖 schema 契约的测试，不要只测“表存在”和简单 CRUD。

