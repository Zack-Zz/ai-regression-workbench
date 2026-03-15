# Development Review: Phase 10 Recheck 1

## 1. Metadata

- Review target: Phase 10 Hardening recheck
- Review date: 2026-03-15
- Reviewer: Codex
- Scope: closure check for [development-review-phase-10.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10.md)
- Related phase: Phase 10
- Related previous reviews:
  - [development-review-phase-10.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/development-review-phase-10.md)

## 2. Conclusion

- Status:
  - `fail`
- Summary:
  - 上轮 3 个问题里，`selected e2e coverage` 资产、migration 目录比对、以及更强的 API contract 断言都已经补进来了；但 Phase 10 仍然不能收口，因为新增的 Playwright e2e 套件在真实环境里并不稳健，`pnpm test:e2e` 会因固定端口占用直接失败。另外，contract consistency 虽然加强了，但仍未完全覆盖文档列出的 testcase 级接口和 preview 层漂移。

## 3. Scope

- Reviewed modules:
  - [apps/local-ui/e2e/workbench.spec.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/local-ui/e2e/workbench.spec.ts)
  - [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts)
  - [scripts/e2e-server.mjs](/Users/zhouze/Documents/git-projects/ai-regression-workbench/scripts/e2e-server.mjs)
  - [apps/cli/test/integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts)
  - [apps/cli/src/handlers/index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts)
- Reviewed docs/contracts:
  - [.kiro/steering/module-roadmap.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/.kiro/steering/module-roadmap.md)
  - [api-contract-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md)
  - [local-ui-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/local-ui-design.md)
- Explicitly out of scope:
  - 未来性能压测
  - 新增业务功能

## 4. Findings

### High

- `pnpm test:e2e` is still brittle because the suite hard-codes ports and refuses existing servers
  - Evidence:
    - 根脚本已经把 e2e 暴露成正式命令，见 [package.json](/Users/zhouze/Documents/git-projects/ai-regression-workbench/package.json#L16)。
    - Playwright webServer 固定使用 `3910` 和 `5174`，并且两项都配置了 `reuseExistingServer: false`，见 [playwright.config.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/playwright.config.ts#L11)。
    - e2e API server 也把监听端口硬编码成 `3910`，见 [scripts/e2e-server.mjs](/Users/zhouze/Documents/git-projects/ai-regression-workbench/scripts/e2e-server.mjs#L22)。
    - 我实际执行 `pnpm test:e2e`，Playwright 直接报错：`http://localhost:3910/doctor is already used`，因此整套 e2e 未能开始执行。
  - Impact:
    - 这意味着新增的 e2e 资产并不能在“开发机已有本地服务运行”的常见场景下稳定执行。Phase 10 虽然有了 e2e 文件，但还不能算交付了一个可靠可跑的 e2e 套件。
  - Suggested fix:
    - 让 e2e 使用独立、可配置、默认随机或可覆写的端口；
    - 或者显式检测并复用已有服务；
    - 至少保证 `pnpm test:e2e` 在常见本地环境里不会因为端口占用直接失败。

### Medium

- Contract consistency checks are stronger, but still do not cover the full documented API surface or preview drift
  - Evidence:
    - 契约文档仍明确列出了 testcase 级接口：`failure-report / execution-profile / diagnostics / trace / logs / analysis`，见 [api-contract-design.md](/Users/zhouze/Documents/git-projects/ai-regression-workbench/docs/api-contract-design.md#L103)。
    - handler 层也已经实现了这些路由，见 [index.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/src/handlers/index.ts#L96)。
    - 但当前 integration tests 的 contract 段只覆盖到 `GET /runs/:runId/failure-reports`、`GET /code-tasks`、`GET /settings`、`GET /doctor` 等，见 [integration.test.ts](/Users/zhouze/Documents/git-projects/ai-regression-workbench/apps/cli/test/integration.test.ts#L239)；没有把 testcase 级接口逐一纳入 contract checks，也没有任何 preview/API 自动对齐检查。
  - Impact:
    - 上轮“只测部分接口存在”的问题已经明显改善，但 `no contract drift between design, API, storage, and preview layers` 这条 exit criterion 仍然没有完全被自动化验证。
  - Suggested fix:
    - 把 testcase 级接口补进 contract suite；
    - 至少加一组 preview/API 可见字段对齐检查，避免 design 或 preview 漂移时没有报警。

## 5. Validation

- Commands run:
  - `pnpm -r typecheck`
  - `pnpm build`
  - `pnpm test`
  - `pnpm lint`
  - `pnpm test:e2e`
- Additional checks:
  - 审阅新增 `apps/local-ui/e2e/` 资产
  - 审阅 `playwright.config.ts` 与 `scripts/e2e-server.mjs`
  - 交叉检查文档接口列表与 integration tests 覆盖范围
- Result summary:
  - `pnpm -r typecheck` 通过
  - `pnpm build` 通过
  - `pnpm test` 通过
  - `pnpm lint` 通过
  - `pnpm test:e2e` 失败，失败原因为固定端口 `3910` 已被占用，Playwright webServer 未能启动

## 6. Phase Gate

- Phase exit criteria checked:
  - Criterion:
    - `integration tests`
    - Result:
      - pass
    - Notes:
      - `apps/cli/test/integration.test.ts` 已继续增强。
  - Criterion:
    - `selected e2e coverage`
    - Result:
      - fail
    - Notes:
      - e2e 文件已存在，但正式命令当前不够稳健，真实运行失败。
  - Criterion:
    - `contract consistency checks`
    - Result:
      - fail
    - Notes:
      - 已比上轮更强，但仍未覆盖全部文档接口与 preview 漂移。
  - Criterion:
    - `migration regression checks`
    - Result:
      - pass
    - Notes:
      - `_migrations` 与 `scripts/sql` 的目录比对已经补上。
  - Criterion:
    - `critical flows are covered`
    - Result:
      - pass with notes
    - Notes:
      - 覆盖面比上轮更好，但 e2e 套件本身还不够稳定。
  - Criterion:
    - `no contract drift between design, API, storage, and preview layers`
    - Result:
      - fail
    - Notes:
      - 目前仍缺 preview 层自动化校验。
- Source/test layout isolation checked:
  - Production code under `src/`: yes
  - Tests under `test/`: yes
  - Any colocated tests under `src/`: no
  - If yes, explain:
    - N/A

## 7. Follow-ups / Notes

- Required follow-up actions:
  - 让 `test:e2e` 摆脱固定端口冲突
  - 把 testcase 级接口和 preview/API 对齐检查补进 contract suite
- Deferred items:
  - 更深入的长期稳定性测试仍可后续追加
- Risks carried into next phase:
  - 如果现在直接收口，Phase 10 最容易复发的问题会是 e2e 在不同开发机上不稳定，以及 testcase/preview 层契约漂移无自动告警
