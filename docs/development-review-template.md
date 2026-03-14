# Development Review Template

> 使用说明：
> 1. 每次阶段开发完成后，复制本模板生成独立 review 结果文件
> 2. 文件名遵循 `development-review-phase-<n>.md` 或 `development-review-phase-<n>-recheck-<m>.md`
> 3. `Findings` 必须按严重级别排序；没有问题也要明确写 `No blocking findings`

## 1. Metadata

- Review target:
- Review date:
- Reviewer:
- Scope:
- Related phase:
- Related previous reviews:

## 2. Conclusion

- Status:
  - `pass`
  - `pass with notes`
  - `fail`
- Summary:

## 3. Scope

- Reviewed modules:
- Reviewed docs/contracts:
- Explicitly out of scope:

## 4. Findings

### High

- Finding title
  - Evidence:
  - Impact:
  - Suggested fix:

### Medium

- Finding title
  - Evidence:
  - Impact:
  - Suggested fix:

### Low

- Finding title
  - Evidence:
  - Impact:
  - Suggested fix:

### No blocking findings

- Use this subsection only when no `High` / `Medium` issues remain.

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
- Additional checks:
- Result summary:

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - Result:
    - Notes:
- Source/test layout isolation checked:
  - Production code under `src/`: yes / no
  - Tests under `test/`: yes / no
  - Any colocated tests under `src/`: yes / no
  - If yes, explain:

## 7. Follow-ups / Notes

- Required follow-up actions:
- Deferred items:
- Risks carried into next phase:
