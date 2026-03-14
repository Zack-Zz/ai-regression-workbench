# Development Review Checklist

> 适用范围：所有 `docs/development-review-*.md`
> 目的：统一开发阶段 review 的最小检查项，避免每轮只盯局部 bug，漏掉结构性约束
> 文档模板：`docs/development-review-template.md`

## 0. 输出格式要求

- 每次开发 review 必须单独产出一个结果文件，不可只口头回复
- 命名建议：
  - 首次评审：`docs/development-review-phase-<n>.md`
  - 修复后复核：`docs/development-review-phase-<n>-recheck-<m>.md`
- 结果文件应使用统一模板：
  - `1. Metadata`
  - `2. Conclusion`
  - `3. Scope`
  - `4. Findings`
  - `5. Validation`
  - `6. Phase Gate`
  - `7. Follow-ups / Notes`
- `Findings` 必须按严重级别排序：
  - `High`
  - `Medium`
  - `Low`
- 若无问题，也必须显式写明 `No blocking findings`

## 1. 结构与目录

- 生产代码必须位于 `src/`
- 测试代码必须位于 `test/`
- 不允许在 `src/` 下新增或保留 `*.test.*` / `*.spec.*`
- package/app 级目录应保持源码与测试隔离，例如：
  - `packages/foo/src/...`
  - `packages/foo/test/...`
- 如果本轮改动触及仍旧把测试放在 `src/` 下的模块，review 结果里必须明确：
  - 已迁移到 `test/`
  - 或者为何本轮显式暂缓迁移

## 2. 契约一致性

- 类型、DTO、API、存储字段命名是否一致
- 状态机和状态语义是否与设计一致
- 任何持久化字段变更是否同步到了 migration / repo / contract / docs

## 3. 存储与路径

- 落盘路径是否仍为相对路径
- schema / migration 是否与权威设计一致
- repository 覆盖面是否满足当前 phase 的设计边界

## 4. 验证

- `typecheck`
- `build`
- `test`
- 如涉及 SQL / schema，补 migration 和 repository 级测试

## 5. 文档要求

- 每份 `development-review-*.md` 应至少写明：
  - 结论
  - findings
  - 实际验证结果
  - 是否满足源码/测试目录隔离约束
