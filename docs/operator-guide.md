# zarb Operator Guide

## Installation

This repository is a monorepo. The CLI is not yet published to npm. Install locally:

```bash
git clone https://github.com/your-org/ai-regression-workbench.git
cd ai-regression-workbench
pnpm install
pnpm build
# Link the CLI globally
cd apps/cli && npm link
```

Or run directly without linking:

```bash
node apps/cli/dist/bin.js
```

## First-run setup

```bash
node apps/cli/dist/bin.js init   # creates .ai-regression-workbench/ with default config
node apps/cli/dist/bin.js doctor # verify environment dependencies
node apps/cli/dist/bin.js        # start server; open http://127.0.0.1:3000 in your browser
```

The server serves both the API and the bundled local workbench UI from the same port. No separate UI process is required.

## Configuration

Edit `.ai-regression-workbench/config.local.yaml`:

```yaml
storage:
  sqlitePath: .ai-regression-workbench/data/sqlite/zarb.db

report:
  port: 3000

workspace:
  targetProjectPath: /path/to/your/project   # required for code tasks

ai:
  apiKeyEnvVar: OPENAI_API_KEY               # env var name, not the key itself

trace:
  provider: jaeger                           # or: none
  endpoint: http://localhost:16686

logs:
  provider: loki                             # or: none
  endpoint: http://localhost:3100
```

## Security guidelines

- **Never store API keys in config files** — use `apiKeyEnvVar` to reference an environment variable name
- **Workspace path** — `targetProjectPath` must be an absolute path to a git repository; relative paths and path traversal (`../`) are rejected at commit time
- **Commit scope** — commits only stage files listed in `changedFiles` (system-derived); unrelated dirty files are never included
- **Review gate** — `COMMIT_PENDING` requires explicit human review acceptance; verify-failed tasks require `forceReviewOnVerifyFailure=true`
- **Git credentials** — zarb uses the system git credential store; no credentials are stored by zarb itself

## Dependency requirements

| Dependency | Required | Notes |
|---|---|---|
| Node.js | ≥ 22 | |
| git | required | for diff/patch/commit |
| Playwright | required for test runs | `npx playwright install` |
| codex CLI | required for code repair | `npm install -g @openai/codex` |
| kiro-cli | optional | for interactive repair sessions |

## Database migrations

Migrations run automatically on `zarb init` and on every `zarb` startup. To check schema health:

```bash
zarb doctor
```

## Uninstall

```bash
npm uninstall -g ai-regression-workbench
rm -rf .ai-regression-workbench   # remove local data (optional)
```
