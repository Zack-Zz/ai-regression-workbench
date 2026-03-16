# zarb Release Notes

## v0.1.0 — Initial Release

### What's included

- **Regression test runner** — run existing Playwright suites locally with full artifact capture
- **Real diagnostics integration** — Jaeger trace lookup and Loki log correlation per test case
- **AI-assisted code repair** — CodeTask execution via `codex exec`, system-derived diff/patch/verify artifacts
- **Controlled review and commit** — human-gated review flow, scoped git commit (only task `changedFiles`)
- **Local workbench UI** — web UI for runs, diagnostics, code tasks, review, and settings
- **Doctor checks** — environment health checks for Node, SQLite, git, Playwright, and code agent CLIs
- **`zarb init`** — guided first-run initialization with directory structure and default config

### Installation

This repository is a monorepo. The CLI is not yet published to npm. Build and link locally:

```bash
pnpm install && pnpm build
cd apps/cli && npm link
zarb init && zarb doctor && zarb
```

### Supported platforms

- macOS (arm64, x64)
- Linux (x64)
- Node.js 22+

### Known limitations

- `KiroCliAgent` interactive mode is not wired in this release
