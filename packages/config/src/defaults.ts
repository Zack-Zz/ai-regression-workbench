import type { PersonalSettings } from '@zarb/shared-types';
import { WORKBENCH_DIR } from './constants.js';

/**
 * Default configuration values.
 * These are the lowest-priority layer; user config.local.yaml overrides these,
 * and StartRunInput overrides those for per-run exploration settings.
 */
export const DEFAULT_SETTINGS: PersonalSettings = {
  storage: {
    sqlitePath: `./${WORKBENCH_DIR}/data/sqlite/app.db`,
    artifactRoot: `./${WORKBENCH_DIR}/data/artifacts`,
    diagnosticRoot: `./${WORKBENCH_DIR}/data/diagnostics`,
    codeTaskRoot: `./${WORKBENCH_DIR}/data/code-tasks`,
  },
  workspace: {
    targetProjectPath: '',
    testSuitesRoot: '',
    gitRootStrategy: 'auto',
    allowOutsideToolWorkspace: true,
  },
  testAssets: {
    sharedRootMode: 'auto',
    generatedRoot: `./${WORKBENCH_DIR}/data/generated-tests`,
    includeSharedInRuns: true,
    includeGeneratedInRuns: false,
    requireGitForSharedRoot: false,
  },
  diagnostics: {
    correlationKeys: {
      responseHeaders: ['X-Trace-Id', 'X-B3-TraceId', 'X-Request-Id'],
      responseBodyPaths: ['traceId', 'requestId', 'data.traceId'],
      logFields: ['traceId', 'trace_id', 'requestId', 'sessionId'],
      caseInsensitiveHeaderMatch: true,
      timeWindowSeconds: 120,
    },
  },
  trace: {
    provider: 'jaeger',
    endpoint: 'http://localhost:16686',
  },
  logs: {
    provider: 'loki',
    endpoint: 'http://localhost:3100',
    defaultLimit: 50,
    redactFields: ['authorization', 'cookie', 'token'],
  },
  ai: {
    activeProvider: 'openai',
    enabled: true,
    providers: {
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        apiKeyEnvVar: 'OPENAI_API_KEY',
      },
      deepseek: {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKeyEnvVar: 'DEEPSEEK_API_KEY',
      },
    },
  },
  exploration: {
    defaultMode: 'hybrid',
    maxSteps: 80,
    maxPages: 20,
    allowedHosts: ['localhost'],
    defaultFocusAreas: ['smoke', 'navigation', 'console-errors'],
    persistAsCandidateTests: true,
  },
  codeAgent: {
    engine: 'kiro' as const,
    defaultApprovalRequired: true,
    allowedWriteScopes: [
      'packages/test-assets',
      'playwright',
      '.zarb/data/generated-tests',
    ],
    defaultVerifyCommands: ['pnpm test'],
    allowReviewOnVerifyFailure: false,
  },
  report: {
    port: 3910,
  },
  ui: {
    locale: 'zh-CN',
  },
  log: {
    level: 'info' as const,
    file: true,
  },
};
