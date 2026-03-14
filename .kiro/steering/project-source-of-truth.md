---
inclusion: always
---

# Project Source of Truth

This repository is design-driven. Kiro must treat the following documents as authoritative before making implementation changes.

## Primary authority

- `docs/design.md`

## Module authorities

- `docs/agent-harness-design.md`
- `docs/orchestrator-design.md`
- `docs/ai-engine-design.md`
- `docs/api-contract-design.md`
- `docs/app-services-design.md`
- `docs/code-task-design.md`
- `docs/storage-mapping-design.md`
- `docs/test-assets-design.md`
- `docs/local-ui-design.md`
- `docs/observability-design.md`
- `docs/packaging-design.md`

## Review documents

- `docs/design-review.md`
- `docs/design-review-v2.md`
- `docs/design-review-v3.md`

Review files are input, not final truth.

Accepted dispositions are:

- `docs/design-review-v2-disposition.md`
- `docs/design-review-v3-disposition.md`

If a review file conflicts with the main design, follow the main design plus the latest disposition file.

## Required behavior

- Before implementation, list the authoritative design docs used for the task.
- If docs conflict, stop implementation and report the exact conflict.
- Do not invent new architecture, states, fields, or API shapes when the design already defines them.
- If implementation pressure requires a design change, update the design first, then implement code.
