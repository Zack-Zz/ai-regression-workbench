import type { PersonalSettings } from '@zarb/shared-types';

/**
 * Default configuration values.
 * These are the lowest-priority layer; user config.local.yaml overrides these,
 * and StartRunInput overrides those for per-run exploration settings.
 */
export const DEFAULT_SETTINGS: PersonalSettings = {
  storage: {
    sqlitePath: './.ai-regression-workbench/data/sqlite/app.db',
    artifactRoot: './.ai-regression-workbench/data/artifacts',
    diagnosticRoot: './.ai-regression-workbench/data/diagnostics',
    codeTaskRoot: './.ai-regression-workbench/data/code-tasks',
  },
  workspace: {
    targetProjectPath: '',
    gitRootStrategy: 'auto',
    allowOutsideToolWorkspace: true,
  },
  testAssets: {
    sharedRootMode: 'auto',
    generatedRoot: './.ai-regression-workbench/data/generated-tests',
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
      '.ai-regression-workbench/data/generated-tests',
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
};
