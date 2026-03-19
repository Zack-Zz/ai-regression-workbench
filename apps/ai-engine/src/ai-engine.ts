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
import { appLogger } from '@zarb/logger';

const log = appLogger.child('AIEngine');

export type AIProviderScene =
  | 'explorationDecision'
  | 'explorationLogin'
  | 'failureAnalysis'
  | 'findingSummary'
  | 'testDraft'
  | 'codeTaskDraft';

export interface AICompletionOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
      strict?: boolean;
    };
  }>;
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };
  retry?: {
    maxAttempts?: number;
    retryOnEmpty?: boolean;
  };
  scene?: AIProviderScene;
}

export interface AIProvider {
  complete(prompt: string, options?: AICompletionOptions): Promise<string>;
  isConfigured(): boolean;
  readonly model: string | undefined;
}

interface ChatCompletionRequestBody {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
  tools?: AICompletionOptions['tools'];
  tool_choice?: AICompletionOptions['toolChoice'];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: Array<{ function?: { arguments?: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

/**
 * OpenAICompatibleProvider — works with any OpenAI-compatible API (OpenAI, DeepSeek, etc.).
 * Falls back gracefully: if API key is missing or call fails, returns empty string.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  isConfigured(): boolean { return !!this.apiKey; }

  async complete(prompt: string, options: AICompletionOptions = {}): Promise<string> {
    if (!this.apiKey) return '';
    const maxAttempts = Math.max(1, options.retry?.maxAttempts ?? 1);
    let lastNetworkErr: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const fullBody = this.buildRequestBody(prompt, options, true);
      const fallbackBody = this.buildRequestBody(prompt, options, false);
      const payloads = this.samePayload(fullBody, fallbackBody) ? [fullBody] : [fullBody, fallbackBody];

      for (let idx = 0; idx < payloads.length; idx++) {
        const body = payloads[idx]!;
        try {
          const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
          });
          if (!res.ok) {
            log.warn('AI provider HTTP error', {
              model: this.model,
              status: res.status,
              baseUrl: this.baseUrl,
              attempt,
              fallbackPayload: idx > 0,
            });
            continue;
          }
          const parsed = await res.json() as ChatCompletionResponse;
          log.debug('AI provider response', {
            model: this.model,
            attempt,
            promptTokens: parsed.usage?.prompt_tokens,
            completionTokens: parsed.usage?.completion_tokens,
            cacheHitTokens: parsed.usage?.prompt_cache_hit_tokens,
            cacheMissTokens: parsed.usage?.prompt_cache_miss_tokens,
          });

          const output = extractChatOutput(parsed).trim();
          if (output.length > 0) return output;
        } catch (err) {
          lastNetworkErr = err;
          log.error('AI provider request failed', { model: this.model, error: String(err), attempt });
          break;
        }
      }
      if (!options.retry?.retryOnEmpty) break;
    }

    if (lastNetworkErr) throw lastNetworkErr;
    return '';
  }

  private samePayload(a: ChatCompletionRequestBody, b: ChatCompletionRequestBody): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private buildRequestBody(prompt: string, options: AICompletionOptions, allowTools: boolean): ChatCompletionRequestBody {
    const messages: ChatCompletionRequestBody['messages'] = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const body: ChatCompletionRequestBody = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.2,
    };
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.responseFormat) body.response_format = options.responseFormat;
    if (allowTools && options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      if (options.toolChoice) body.tool_choice = options.toolChoice;
    }
    return body;
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
  readonly model = undefined;
  isConfigured(): boolean { return false; }
  complete(_prompt: string, _options?: AICompletionOptions): Promise<string> { return Promise.resolve(''); }
}

class RoutedAIProvider implements AIProvider {
  constructor(
    private readonly providers: Record<string, AIProvider>,
    private readonly defaultProviderKey: string,
    private readonly sceneProviders: Partial<Record<AIProviderScene, string>>,
  ) {}

  get model(): string | undefined {
    return this.providerFor(undefined).model;
  }

  isConfigured(): boolean {
    return this.providerFor(undefined).isConfigured();
  }

  complete(prompt: string, options: AICompletionOptions = {}): Promise<string> {
    const provider = this.providerFor(options.scene);
    const forwardedOptions: AICompletionOptions = { ...options };
    if (forwardedOptions.scene) delete forwardedOptions.scene;
    return provider.complete(prompt, forwardedOptions);
  }

  private providerFor(scene?: AIProviderScene): AIProvider {
    const sceneKey = scene ? this.sceneProviders[scene] : undefined;
    if (sceneKey && this.providers[sceneKey]) return this.providers[sceneKey]!;
    return this.providers[this.defaultProviderKey] ?? new NullAIProvider();
  }
}

/**
 * createAIProvider — factory from settings ai config.
 */
export function createAIProvider(config: {
  activeProvider: string;
  enabled: boolean;
  sceneProviders?: Partial<Record<AIProviderScene, string>>;
  providers: { [key: string]: { baseUrl: string; model: string; apiKey?: string; apiKeyEnvVar?: string } };
}): AIProvider {
  if (!config.enabled) return new NullAIProvider();
  const providerEntries = Object.entries(config.providers ?? {});
  if (providerEntries.length === 0) return new NullAIProvider();

  const providers: Record<string, AIProvider> = {};
  for (const [key, cfg] of providerEntries) {
    const apiKey = (cfg.apiKey && cfg.apiKey !== '**masked**')
      ? cfg.apiKey
      : (cfg.apiKeyEnvVar ? (process.env[cfg.apiKeyEnvVar] ?? '') : '');
    providers[key] = new OpenAICompatibleProvider(cfg.baseUrl, apiKey, cfg.model);
  }

  const defaultKey = providers[config.activeProvider]
    ? config.activeProvider
    : providerEntries[0]?.[0];
  if (!defaultKey) return new NullAIProvider();

  return new RoutedAIProvider(providers, defaultKey, config.sceneProviders ?? {});
}
export interface AIEngine {
  getProvider(): AIProvider;
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

  getProvider(): AIProvider {
    return this.provider;
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
    log.info('analyzeFailure start', { runId: input.runId, testcaseId: input.testcaseId, model: this.provider.model });
    const t0 = Date.now();
    const raw = await this.provider.complete(prompt, {
      scene: 'failureAnalysis',
      responseFormat: { type: 'json_object' },
      temperature: 0.1,
      maxTokens: 900,
      retry: { maxAttempts: 2, retryOnEmpty: true },
    });
    log.info('analyzeFailure done', { runId: input.runId, testcaseId: input.testcaseId, durationMs: Date.now() - t0, hasOutput: raw.length > 0 });
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
    const raw = await this.provider.complete(prompt, {
      scene: 'findingSummary',
      temperature: 0.1,
      maxTokens: 1200,
      retry: { maxAttempts: 2, retryOnEmpty: true },
    });
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
    const raw = await this.provider.complete(prompt, {
      scene: 'testDraft',
      responseFormat: { type: 'json_object' },
      temperature: 0.1,
      maxTokens: 1200,
      retry: { maxAttempts: 2, retryOnEmpty: true },
    });
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
    log.info('createCodeTaskDraft start', { runId: input.runId, analysisId: input.id, model: this.provider.model });
    const t0 = Date.now();
    const raw = await this.provider.complete(prompt, {
      scene: 'codeTaskDraft',
      responseFormat: { type: 'json_object' },
      temperature: 0.1,
      maxTokens: 900,
      retry: { maxAttempts: 2, retryOnEmpty: true },
    });
    log.info('createCodeTaskDraft done', { runId: input.runId, durationMs: Date.now() - t0 });
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

function extractChatOutput(body: ChatCompletionResponse): string {
  const message = body.choices?.[0]?.message;
  const toolArgs = message?.tool_calls?.[0]?.function?.arguments;
  if (typeof toolArgs === 'string' && toolArgs.trim().length > 0) return toolArgs;

  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? '')
      .join('\n')
      .trim();
  }
  return '';
}
