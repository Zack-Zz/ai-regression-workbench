import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  FailureContext,
  ExplorationFindingContext,
  FailureAnalysis,
  FindingSummary,
  GeneratedTestDraft,
  CodeTaskDraft,
} from '@zarb/shared-types';
import type { Db } from '@zarb/storage';
import { AnalysisRepository, GeneratedTestRepository, CodeTaskDraftRepository, RunRepository, generatedTestPath } from '@zarb/storage';
import { trimContext } from './context-trimmer.js';
import { renderTemplate, TEMPLATE_VERSIONS } from './prompt-loader.js';

export interface AIProvider {
  complete(prompt: string): Promise<string>;
}

/**
 * OpenAICompatibleProvider — works with any OpenAI-compatible API (OpenAI, DeepSeek, etc.).
 * Falls back gracefully: if API key is missing or call fails, returns empty string.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(prompt: string): Promise<string> {
    if (!this.apiKey) return '';
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return '';
      const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return body.choices?.[0]?.message?.content ?? '';
    } catch {
      return '';
    }
  }
}

/** @deprecated Use OpenAICompatibleProvider directly. Kept for backward compatibility. */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, model = 'gpt-4o') {
    super('https://api.openai.com/v1', apiKey, model);
  }
}

/**
 * NullAIProvider — used when no AI provider is configured.
 * Returns empty string so callers degrade gracefully.
 */
export class NullAIProvider implements AIProvider {
  complete(_prompt: string): Promise<string> { return Promise.resolve(''); }
}

/**
 * createAIProvider — factory from settings ai config.
 */
export function createAIProvider(config: {
  activeProvider: string;
  enabled: boolean;
  providers: { [key: string]: { baseUrl: string; model: string; apiKey?: string; apiKeyEnvVar?: string } };
}): AIProvider {
  if (!config.enabled) return new NullAIProvider();
  const providerCfg = config.providers[config.activeProvider];
  if (!providerCfg) return new NullAIProvider();
  const apiKey = (providerCfg.apiKey && providerCfg.apiKey !== '**masked**')
    ? providerCfg.apiKey
    : (providerCfg.apiKeyEnvVar ? (process.env[providerCfg.apiKeyEnvVar] ?? '') : '');
  return new OpenAICompatibleProvider(providerCfg.baseUrl, apiKey, providerCfg.model);
}
export interface AIEngine {
  analyzeFailure(input: FailureContext): Promise<FailureAnalysis>;
  summarizeFindings(input: ExplorationFindingContext): Promise<FindingSummary[]>;
  createGeneratedTestDraft(input: FailureContext | ExplorationFindingContext): Promise<GeneratedTestDraft[]>;
  createCodeTaskDraft(input: FailureAnalysis): Promise<CodeTaskDraft[]>;
}

/**
 * LocalAIEngine — implements AIEngine using a pluggable AIProvider.
 * All outputs are persisted to DB and disk before returning.
 * AI output stays within draft/pending-approval boundaries.
 * Derived from ai-engine-design.md §4, §6.
 */
export class LocalAIEngine implements AIEngine {
  private readonly analysisRepo: AnalysisRepository;
  private readonly generatedTestRepo: GeneratedTestRepository;
  private readonly codeTaskDraftRepo: CodeTaskDraftRepository;
  private readonly runRepo: RunRepository;

  constructor(
    private provider: AIProvider,
    private readonly db: Db,
    private readonly dataRoot: string,
  ) {
    this.analysisRepo = new AnalysisRepository(db);
    this.generatedTestRepo = new GeneratedTestRepository(db);
    this.codeTaskDraftRepo = new CodeTaskDraftRepository(db);
    this.runRepo = new RunRepository(db);
  }

  /** Hot-swap the underlying AI provider (e.g. when user switches in Settings). */
  setProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  async analyzeFailure(input: FailureContext): Promise<FailureAnalysis> {
    const ctx = trimContext({
      ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
      ...(input.traceSummary !== undefined ? { traceSummary: input.traceSummary } : {}),
      ...(input.logSummary !== undefined ? { logSummary: input.logSummary } : {}),
      ...(input.screenshotPath !== undefined ? { screenshotPath: input.screenshotPath } : {}),
      ...(input.verifyOutput !== undefined ? { verifyOutput: input.verifyOutput } : {}),
    });
    const prompt = renderTemplate(TEMPLATE_VERSIONS.failureAnalysis, {
      context: JSON.stringify(ctx),
    });
    const raw = await this.provider.complete(prompt);
    const parsed = parseJson<{
      category?: string;
      suspectedLayer?: string;
      confidence?: number;
      summary?: string;
      probableCause?: string;
      suggestions?: string[];
    }>(raw, {});

    const id = randomUUID();
    const now = new Date().toISOString();
    const analysis: FailureAnalysis = {
      id,
      runId: input.runId,
      testcaseId: input.testcaseId,
      category: parsed.category ?? 'unknown',
      suspectedLayer: parsed.suspectedLayer ?? 'unknown',
      confidence: parsed.confidence ?? 0,
      summary: parsed.summary ?? '',
      probableCause: parsed.probableCause ?? '',
      suggestions: parsed.suggestions ?? [],
      promptTemplateVersion: TEMPLATE_VERSIONS.failureAnalysis,
      createdAt: now,
    };

    this.analysisRepo.save({
      id,
      runId: input.runId,
      testcaseId: input.testcaseId,
      category: analysis.category,
      suspectedLayer: analysis.suspectedLayer,
      confidence: analysis.confidence,
      summary: analysis.summary,
      probableCause: analysis.probableCause,
      suggestionsJson: JSON.stringify(analysis.suggestions),
      promptTemplateVersion: analysis.promptTemplateVersion,
      version: 1,
      createdAt: now,
    });

    return analysis;
  }

  async summarizeFindings(input: ExplorationFindingContext): Promise<FindingSummary[]> {
    const prompt = renderTemplate(TEMPLATE_VERSIONS.findingSummary, {
      findings: JSON.stringify(input.findings),
    });
    const raw = await this.provider.complete(prompt);
    const parsed = parseJson<FindingSummary[]>(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  async createGeneratedTestDraft(
    input: FailureContext | ExplorationFindingContext,
  ): Promise<GeneratedTestDraft[]> {
    const failureInput = isFailureContext(input) ? input : null;
    const explorationInput = !isFailureContext(input) ? input : null;

    const ctx = failureInput
      ? trimContext({ ...(failureInput.errorMessage !== undefined ? { errorMessage: failureInput.errorMessage } : {}) })
      : { findings: explorationInput?.findings ?? [] };

    const prompt = renderTemplate(TEMPLATE_VERSIONS.testDraft, {
      context: JSON.stringify(ctx),
    });
    const raw = await this.provider.complete(prompt);
    const parsed = parseJson<{ title?: string; code?: string }>(raw, {});

    const id = randomUUID();
    const now = new Date().toISOString();
    const relPath = generatedTestPath(id);
    const draft: GeneratedTestDraft = {
      id,
      runId: input.runId,
      ...(failureInput ? { testcaseId: failureInput.testcaseId } : {}),
      ...(explorationInput ? { sessionId: explorationInput.sessionId } : {}),
      title: parsed.title ?? 'Generated test',
      code: parsed.code ?? '',
      filePath: relPath,
      promptTemplateVersion: TEMPLATE_VERSIONS.testDraft,
      status: 'draft' as const,
      createdAt: now,
    };

    // Persist code to disk
    const absPath = join(this.dataRoot, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, draft.code, 'utf8');

    // Persist metadata to DB
    this.generatedTestRepo.save({
      id,
      runId: input.runId,
      ...(failureInput ? { testcaseId: failureInput.testcaseId } : {}),
      ...(explorationInput ? { sessionId: explorationInput.sessionId } : {}),
      title: draft.title,
      filePath: relPath,
      promptTemplateVersion: draft.promptTemplateVersion,
      status: 'draft',
      createdAt: now,
    });

    return [draft];
  }

  async createCodeTaskDraft(input: FailureAnalysis): Promise<CodeTaskDraft[]> {
    const prompt = renderTemplate(TEMPLATE_VERSIONS.codeTaskDraft, {
      analysis: JSON.stringify(input),
    });
    const raw = await this.provider.complete(prompt);
    const parsed = parseJson<{
      goal?: string;
      target?: 'app' | 'test';
      scopePaths?: string[];
      constraints?: string[];
      verificationCommands?: string[];
    }>(raw, {});

    const id = randomUUID();
    const now = new Date().toISOString();
    const draft: CodeTaskDraft = {
      id,
      runId: input.runId,
      analysisId: input.id,
      goal: parsed.goal ?? '',
      target: parsed.target ?? 'app',
      workspacePath: this.runRepo.findById(input.runId)?.workspace_path ?? '',
      scopePaths: parsed.scopePaths ?? [],
      constraints: parsed.constraints ?? [],
      verificationCommands: parsed.verificationCommands ?? [],
      promptTemplateVersion: TEMPLATE_VERSIONS.codeTaskDraft,
      status: 'draft',
      createdAt: now,
    };

    this.codeTaskDraftRepo.save({
      id,
      runId: input.runId,
      analysisId: input.id,
      goal: draft.goal,
      target: draft.target,
      workspacePath: draft.workspacePath,
      scopePathsJson: JSON.stringify(draft.scopePaths),
      constraintsJson: JSON.stringify(draft.constraints),
      verificationCommandsJson: JSON.stringify(draft.verificationCommands),
      promptTemplateVersion: draft.promptTemplateVersion,
      status: 'draft',
      createdAt: now,
    });

    return [draft];
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
    const src = match?.[1] ?? raw;
    return JSON.parse(src) as T;
  } catch {
    return fallback;
  }
}

function isFailureContext(
  input: FailureContext | ExplorationFindingContext,
): input is FailureContext {
  return 'testcaseId' in input;
}
