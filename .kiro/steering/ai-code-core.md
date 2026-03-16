---
inclusion: always
---

# ai-code Core Steering

This workspace is a multi-assistant toolkit for ChatGPT, Codex, Claude, Kiro, Cursor, and OpenCode.

## Core behavior

- Prefer minimal, pragmatic changes over broad rewrites.
- Keep modifications consistent with repository conventions.
- Explain key tradeoffs briefly before major multi-file changes.
- Validate with relevant tests and report exact commands run.

## Language

- All responses, comments, and explanations must be in Chinese or English only.
- Do not use Korean or any other language.

- Do not hardcode secrets, tokens, or credentials.
- Validate external input at boundaries.
- Prefer immutable transformations and avoid hidden side effects.
- Keep files focused and avoid unnecessary complexity.

