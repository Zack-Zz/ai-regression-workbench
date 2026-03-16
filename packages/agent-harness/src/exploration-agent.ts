import { randomUUID } from 'node:crypto';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { Db } from '@zarb/storage';
import { FindingRepository } from '@zarb/storage';

export interface AIProvider {
  complete(prompt: string): Promise<string>;
}

export interface PageProbe {
  url: string;
  title: string;
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status: number }>;
  formCount: number;
  linkCount: number;
  screenshot?: string;
}

export interface ExplorationStep {
  stepIndex: number;
  action: 'navigate' | 'click' | 'fill' | 'done';
  targetUrl?: string | undefined;
  selector?: string | undefined;
  value?: string | undefined;
  reasoning: string;
}

export interface ExplorationResult {
  findingCount: number;
  stepsExecuted: number;
  pagesVisited: number;
}

/**
 * ExplorationAgent — drives AI-guided site exploration.
 *
 * Design: agent-harness-design.md §6.1
 * - LLM decides next action (navigate/click/fill/done)
 * - Playwright probe collects page state after each action
 * - Findings are persisted to DB
 * - Hard budget: maxSteps / maxPages
 * - Soft stop: no new findings for 3 consecutive steps
 */
export class ExplorationAgent {
  private readonly findings: FindingRepository;

  constructor(
    private readonly db: Db,
    private readonly provider: AIProvider,
  ) {
    this.findings = new FindingRepository(db);
  }

  async explore(
    runId: string,
    config: ExplorationConfig,
    probe: (url: string) => Promise<PageProbe>,
  ): Promise<ExplorationResult> {
    const maxSteps = config.maxSteps ?? 20;
    const maxPages = config.maxPages ?? 10;
    const visitedUrls = new Set<string>();
    const pendingUrls: string[] = [...config.startUrls];
    let stepIndex = 0;
    let noNewFindingsStreak = 0;
    let totalFindings = 0;

    while (stepIndex < maxSteps && visitedUrls.size < maxPages && pendingUrls.length > 0) {
      const url = pendingUrls.shift()!;
      if (visitedUrls.has(url)) continue;
      visitedUrls.add(url);

      // Probe the page
      let pageState: PageProbe;
      try {
        pageState = await probe(url);
      } catch {
        continue;
      }

      // Persist findings from this page
      const newFindings = this.extractFindings(runId, pageState, config);
      for (const f of newFindings) {
        this.findings.save(f);
        totalFindings++;
      }

      if (newFindings.length === 0) {
        noNewFindingsStreak++;
      } else {
        noNewFindingsStreak = 0;
      }

      // Soft stop: 3 consecutive pages with no findings
      if (noNewFindingsStreak >= 3) break;

      // Ask LLM for next action
      const nextStep = await this.decideNextStep(pageState, config, stepIndex, [...visitedUrls]);
      if (nextStep.action === 'done') break;
      if (nextStep.action === 'navigate' && nextStep.targetUrl) {
        if (!visitedUrls.has(nextStep.targetUrl)) {
          pendingUrls.unshift(nextStep.targetUrl);
        }
      }

      stepIndex++;
    }

    return { findingCount: totalFindings, stepsExecuted: stepIndex, pagesVisited: visitedUrls.size };
  }

  private extractFindings(
    runId: string,
    page: PageProbe,
    config: ExplorationConfig,
  ): import('@zarb/storage').SaveFindingInput[] {
    const results: import('@zarb/storage').SaveFindingInput[] = [];
    const now = new Date().toISOString();
    const focusAreas = config.focusAreas ?? ['console-errors', 'network-errors'];

    if (focusAreas.includes('console-errors')) {
      for (const err of page.consoleErrors.slice(0, 5)) {
        results.push({
          id: randomUUID(), runId, category: 'console-error', severity: 'medium',
          pageUrl: page.url, title: 'Console error', summary: err, createdAt: now,
        });
      }
    }

    if (focusAreas.includes('network-errors')) {
      for (const req of page.networkErrors.slice(0, 5)) {
        const severity = req.status >= 500 ? 'high' : 'medium';
        results.push({
          id: randomUUID(), runId, category: 'network-error', severity,
          pageUrl: page.url, title: `HTTP ${String(req.status)}`,
          summary: `${req.url} returned ${String(req.status)}`, createdAt: now,
        });
      }
    }

    return results;
  }

  private async decideNextStep(
    page: PageProbe,
    config: ExplorationConfig,
    stepIndex: number,
    visited: string[],
  ): Promise<ExplorationStep> {
    const focusAreas = config.focusAreas ?? [];
    const prompt = [
      'You are an AI site exploration agent. Decide the next action to take.',
      `Current page: ${page.url} (title: "${page.title}")`,
      `Console errors: ${page.consoleErrors.length}, Network errors: ${page.networkErrors.length}`,
      `Forms: ${page.formCount}, Links: ${page.linkCount}`,
      `Focus areas: ${focusAreas.join(', ') || 'general'}`,
      `Already visited: ${visited.slice(-5).join(', ')}`,
      `Step: ${String(stepIndex)}`,
      '',
      'Respond with JSON only: {"action":"navigate"|"done","targetUrl":"...","reasoning":"..."}',
      'Choose "done" if the page has been thoroughly explored or there is nothing new to find.',
    ].join('\n');

    try {
      const raw = await this.provider.complete(prompt);
      const parsed = parseJson<{ action?: string; targetUrl?: string; reasoning?: string }>(raw, {});
      return {
        stepIndex,
        action: (parsed.action === 'done' ? 'done' : 'navigate') as ExplorationStep['action'],
        targetUrl: parsed.targetUrl,
        reasoning: parsed.reasoning ?? '',
      };
    } catch {
      return { stepIndex, action: 'done', reasoning: 'LLM unavailable' };
    }
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(raw);
    return match ? JSON.parse(match[0]) as T : fallback;
  } catch {
    return fallback;
  }
}
