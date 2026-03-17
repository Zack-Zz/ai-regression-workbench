# ai-regression-workbench

English | [简体中文](./README.zh-CN.md)

`ai-regression-workbench` is a local-first regression testing, AI-assisted exploration, and controlled remediation system built around Playwright. It is designed to help teams run tests, let AI probe sites under bounded budgets, collect diagnostics, analyze failures with AI, generate candidate tests or controlled code-fix tasks, review diffs, and explicitly decide whether to commit changes.

CLI command:

- `zarb` (`Zack AI Regression Bench`)

Quick start:

```bash
npm install -g ai-regression-workbench
zarb
```

On first run, `zarb` should guide initialization and then open the local workbench.

## Goals

- Run existing Playwright suites locally.
- Explore sites with AI under explicit budget and approval boundaries.
- Collect artifacts, trace data, and log summaries for failed cases.
- Use AI to generate structured failure analysis.
- Create candidate tests and controlled code-fix tasks instead of applying unreviewed changes.
- Support human approval, review, and explicit commit actions.
- Keep the architecture ready for future platformization.

## Core Flow

```text
Regression run / AI exploration
  -> artifacts
  -> correlation context
  -> trace lookup
  -> log lookup
  -> AI analysis
  -> candidate test / CodeTask draft
  -> approval
  -> agent harness execution
  -> verify
  -> review
  -> commit
```

## Key Design Properties

- Local-first: single-machine runnable.
- Interruptible: pause, resume, cancel, retry.
- Observable: state, events, artifacts, diagnostics.
- Human-in-the-loop: no implicit code execution or commit.
- Platform-ready: modular interfaces for runner, trace, logs, AI, storage, and code agents.

## Repository Layout

```text
apps/
  cli/
  orchestrator/
  test-runner/
  trace-bridge/
  log-bridge/
  ai-engine/
  review-manager/
  local-ui/
packages/
  agent-harness/
  shared-types/
  shared-utils/
  config/
  storage/
  event-store/
  logger/
  test-assets/
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
docs/
design.md
```

## Diagnostics Model

The system does not rely on a single hard-coded header such as `X-Trace-Id`. Instead, it extracts configurable correlation keys from responses and uses them to query trace and log backends.

Typical correlation sources:

- Response headers
- Response body fields
- Request identifiers
- Session identifiers
- Service hints
- Time windows

## Documentation

- Detailed design: [docs/design.md](./docs/design.md)
- Development history: [docs/development-completed.md](./docs/development-completed.md)
- Operator guide: [docs/operator-guide.md](./docs/operator-guide.md)
- Local debug guide: [docs/local-debug-guide.md](./docs/local-debug-guide.md)
- Release notes: [docs/release-notes.md](./docs/release-notes.md)

Module design docs (implemented):
  [orchestrator](./docs/orchestrator-design.md),
  [diagnostics](./docs/diagnostics-design.md),
  [ai-engine](./docs/ai-engine-design.md),
  [ai-provider](./docs/ai-provider-design.md),
  [agent-harness](./docs/agent-harness-design.md),
  [code-task](./docs/code-task-design.md),
  [api-contract](./docs/api-contract-design.md),
  [local-ui](./docs/local-ui-design.md),
  [packaging](./docs/packaging-design.md),
  [test-assets](./docs/test-assets-design.md),
  [observability](./docs/observability-design.md),
  [app-services](./docs/app-services-design.md),
  [storage-mapping](./docs/storage-mapping-design.md)

Future feature specs (not yet implemented):
  [project & site management](./docs/project-site-design.md),
  [real exploration](./docs/exploration-design.md),
  [codetask automation](./docs/codetask-automation-design.md)

- Chinese README: [README.zh-CN.md](./README.zh-CN.md)

## Current Status

Phase 0-16 is complete: the repository includes the local workbench baseline, API/UI flow, AI provider integration (OpenAI + DeepSeek with runtime switching), doctor checks, and hardening coverage.

Active design work (spec phase, not yet implemented):
- Project & site management — multi-project, multi-domain, per-project code repos and data directories
- Real exploration — Playwright-backed browser exploration replacing the current `fetch` stub
- CodeTask automation — auto-trigger on regression failure and exploration findings

See [docs/development-completed.md](./docs/development-completed.md) for the full phase-by-phase delivery summary.
