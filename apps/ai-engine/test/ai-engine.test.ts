import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { openDb, runMigrations, RunRepository, AnalysisRepository, GeneratedTestRepository, CodeTaskDraftRepository } from '@zarb/storage';
import { LocalAIEngine } from '../src/ai-engine.js';
import { trimContext } from '../src/context-trimmer.js';
import { loadTemplate, renderTemplate, TEMPLATE_VERSIONS, resetPromptsDir } from '../src/prompt-loader.js';
import type { AIProvider } from '../src/ai-engine.js';
import type { FailureContext, ExplorationFindingContext, FailureAnalysis } from '@zarb/shared-types';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

let dir: string;

beforeEach(() => {
  dir = join(tmpdir(), `zarb-ai-engine-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  resetPromptsDir();
});

function makeDb() {
  const db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

function seedRun(db: ReturnType<typeof makeDb>, runId = 'r1') {
  new RunRepository(db).create({ runId, scopeType: 'suite', workspacePath: '/ws', startedAt: new Date().toISOString() });
}

/** Stub provider that returns a fixed JSON response. */
function stubProvider(response: unknown): AIProvider {
  return { complete: () => Promise.resolve(JSON.stringify(response)) };
}

// ---------------------------------------------------------------------------
// ContextTrimmer
// ---------------------------------------------------------------------------

describe('trimContext', () => {
  it('limits error log samples to 5', () => {
    const result = trimContext({
      logSummary: {
        matched: true,
        highlights: [],
        errorSamples: Array.from({ length: 10 }, (_, i) => ({
          timestamp: new Date().toISOString(),
          message: `error ${String(i)}`,
        })),
      },
    });
    expect(result.recentErrorLogs).toHaveLength(5);
  });

  it('limits slow spans to 3', () => {
    const result = trimContext({
      traceSummary: {
        traceId: 't1',
        hasError: false,
        errorSpans: [],
        topSlowSpans: Array.from({ length: 6 }, (_, i) => ({ spanId: `s${String(i)}`, durationMs: 100 })),
      },
    });
    expect(result.topSlowSpans).toHaveLength(3);
  });

  it('truncates verifyOutput to 500 chars', () => {
    const result = trimContext({ verifyOutput: 'x'.repeat(1000) });
    expect(result.verifyOutputSnippet).toHaveLength(500);
  });

  it('returns empty arrays when no diagnostics provided', () => {
    const result = trimContext({});
    expect(result.recentErrorLogs).toHaveLength(0);
    expect(result.topSlowSpans).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PromptLoader
// ---------------------------------------------------------------------------

describe('PromptLoader', () => {
  it('loads a known template from filesystem', () => {
    const tpl = loadTemplate(TEMPLATE_VERSIONS.failureAnalysis);
    expect(tpl).toContain('{{context}}');
  });

  it('throws for unknown template', () => {
    expect(() => loadTemplate('unknown@v99')).toThrow(/not found/);
  });

  it('throws for key without @version', () => {
    expect(() => loadTemplate('no-version')).toThrow(/@version/);
  });

  it('renders template with variables', () => {
    const rendered = renderTemplate(TEMPLATE_VERSIONS.failureAnalysis, { context: '{"error":"oops"}' });
    expect(rendered).toContain('{"error":"oops"}');
    expect(rendered).not.toContain('{{context}}');
  });
});

// ---------------------------------------------------------------------------
// LocalAIEngine.analyzeFailure
// ---------------------------------------------------------------------------

describe('LocalAIEngine.analyzeFailure', () => {
  it('returns FailureAnalysis with correct fields and persists to DB', async () => {
    const db = makeDb(); seedRun(db);
    const provider = stubProvider({
      category: 'network',
      suspectedLayer: 'backend',
      confidence: 0.9,
      summary: 'API timeout',
      probableCause: 'slow DB query',
      suggestions: ['add index', 'cache result'],
    });
    const engine = new LocalAIEngine(provider, db, dir);
    const input: FailureContext = {
      runId: 'r1', testcaseId: 'tc1', testcaseName: 'login test',
      errorMessage: 'Timeout waiting for response',
    };
    const result = await engine.analyzeFailure(input);
    expect(result.category).toBe('network');
    expect(result.suspectedLayer).toBe('backend');
    expect(result.confidence).toBe(0.9);
    expect(result.suggestions).toEqual(['add index', 'cache result']);
    expect(result.promptTemplateVersion).toBe(TEMPLATE_VERSIONS.failureAnalysis);
    // Persisted to DB
    const row = new AnalysisRepository(db).findByTestcase('r1', 'tc1');
    expect(row).toBeTruthy();
    expect(row?.category).toBe('network');
  });

  it('uses fallback values when provider returns empty JSON', async () => {
    const db = makeDb(); seedRun(db);
    const engine = new LocalAIEngine(stubProvider({}), db, dir);
    const result = await engine.analyzeFailure({ runId: 'r1', testcaseId: 'tc1', testcaseName: 't' });
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('persists promptTemplateVersion to DB', async () => {
    const db = makeDb(); seedRun(db);
    const engine = new LocalAIEngine(stubProvider({ category: 'ui', suspectedLayer: 'frontend', confidence: 0.5, summary: 's', probableCause: 'p', suggestions: [] }), db, dir);
    await engine.analyzeFailure({ runId: 'r1', testcaseId: 'tc1', testcaseName: 't' });
    const row = new AnalysisRepository(db).findByTestcase('r1', 'tc1');
    expect(row?.prompt_template_version).toBe(TEMPLATE_VERSIONS.failureAnalysis);
  });
});

// ---------------------------------------------------------------------------
// LocalAIEngine.summarizeFindings
// ---------------------------------------------------------------------------

describe('LocalAIEngine.summarizeFindings', () => {
  it('returns FindingSummary array from provider', async () => {
    const db = makeDb(); seedRun(db);
    const summaries = [{ findingId: 'f1', category: 'ui', severity: 'high', summary: 'broken button', suggestedAction: 'fix selector' }];
    const engine = new LocalAIEngine(stubProvider(summaries), db, dir);
    const input: ExplorationFindingContext = {
      runId: 'r1', sessionId: 's1',
      findings: [{ findingId: 'f1', category: 'ui', severity: 'high', description: 'button broken' }],
    };
    const result = await engine.summarizeFindings(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.findingId).toBe('f1');
  });

  it('returns empty array when provider returns non-array', async () => {
    const db = makeDb(); seedRun(db);
    const engine = new LocalAIEngine(stubProvider({ error: 'bad' }), db, dir);
    const result = await engine.summarizeFindings({ runId: 'r1', sessionId: 's1', findings: [] });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LocalAIEngine.createGeneratedTestDraft
// ---------------------------------------------------------------------------

describe('LocalAIEngine.createGeneratedTestDraft', () => {
  it('writes test code to disk and persists metadata to DB', async () => {
    const db = makeDb(); seedRun(db);
    const engine = new LocalAIEngine(
      stubProvider({ title: 'Login test', code: 'test("login", async () => {})' }),
      db, dir,
    );
    const input: FailureContext = { runId: 'r1', testcaseId: 'tc1', testcaseName: 'login' };
    const [draft] = await engine.createGeneratedTestDraft(input);
    expect(draft?.title).toBe('Login test');
    expect(draft?.status).toBe('draft');
    expect(existsSync(join(dir, draft?.filePath ?? ''))).toBe(true);
    expect(readFileSync(join(dir, draft?.filePath ?? ''), 'utf8')).toContain('login');
    // DB
    const rows = new GeneratedTestRepository(db).findByRun('r1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Login test');
  });

  it('works with ExplorationFindingContext', async () => {
    const db = makeDb(); seedRun(db);
    const engine = new LocalAIEngine(
      stubProvider({ title: 'Explore test', code: 'test("explore", () => {})' }),
      db, dir,
    );
    const input: ExplorationFindingContext = { runId: 'r1', sessionId: 's1', findings: [] };
    const [draft] = await engine.createGeneratedTestDraft(input);
    expect(draft?.sessionId).toBe('s1');
    expect(draft?.status).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// LocalAIEngine.createCodeTaskDraft
// ---------------------------------------------------------------------------

describe('LocalAIEngine.createCodeTaskDraft', () => {
  it('returns CodeTaskDraft in draft status and persists to DB', async () => {
    const db = makeDb(); seedRun(db);
    const engine = new LocalAIEngine(
      stubProvider({ goal: 'Fix login timeout', target: 'app', scopePaths: ['src/auth'], constraints: [], verificationCommands: ['pnpm test'] }),
      db, dir,
    );
    const analysis: FailureAnalysis = {
      id: 'a1', runId: 'r1', testcaseId: 'tc1',
      category: 'network', suspectedLayer: 'backend', confidence: 0.9,
      summary: 'timeout', probableCause: 'slow query', suggestions: [],
      promptTemplateVersion: TEMPLATE_VERSIONS.failureAnalysis,
      createdAt: new Date().toISOString(),
    };
    const [draft] = await engine.createCodeTaskDraft(analysis);
    expect(draft?.goal).toBe('Fix login timeout');
    expect(draft?.target).toBe('app');
    expect(draft?.status).toBe('draft');
    expect(draft?.analysisId).toBe('a1');
    expect(draft?.verificationCommands).toEqual(['pnpm test']);
    // Persisted to DB
    const rows = new CodeTaskDraftRepository(db).findByRun('r1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.goal).toBe('Fix login timeout');
    expect(rows[0]?.prompt_template_version).toBe(TEMPLATE_VERSIONS.codeTaskDraft);
  });

  it('parses JSON from markdown code block', async () => {
    const db = makeDb(); seedRun(db);
    const jsonInMarkdown = '```json\n{"goal":"fix","target":"test","scopePaths":[],"constraints":[],"verificationCommands":[]}\n```';
    const engine = new LocalAIEngine({ complete: () => Promise.resolve(jsonInMarkdown) }, db, dir);
    const analysis: FailureAnalysis = {
      id: 'a2', runId: 'r1', testcaseId: 'tc1',
      category: 'ui', suspectedLayer: 'frontend', confidence: 0.5,
      summary: '', probableCause: '', suggestions: [],
      promptTemplateVersion: TEMPLATE_VERSIONS.failureAnalysis,
      createdAt: new Date().toISOString(),
    };
    const [draft] = await engine.createCodeTaskDraft(analysis);
    expect(draft?.goal).toBe('fix');
    expect(draft?.target).toBe('test');
  });
});
