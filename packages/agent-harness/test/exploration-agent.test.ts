import { describe, it, expect } from 'vitest';
import { openDb, runMigrations } from '@zarb/storage';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { ExplorationAgent, buildExplorationDecisionPrompt } from '../src/exploration-agent.js';
import type { PageProbe } from '../src/exploration-agent.js';
import type { DomSnapshot } from '../src/playwright-tool-provider.js';

const MIGRATIONS_DIR = join(new URL('.', import.meta.url).pathname, '../../../scripts/sql');

function makeDb() {
  const dir = join(tmpdir(), `zarb-exploration-agent-test-${String(Date.now())}`);
  mkdirSync(dir, { recursive: true });
  const db = openDb(join(dir, 'test.db'));
  runMigrations(db, MIGRATIONS_DIR);
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('buildExplorationDecisionPrompt', () => {
  it('includes mission context, budget, recent steps, recent findings, and DOM summary', () => {
    const page: PageProbe = {
      url: 'https://example.com/admin',
      title: 'Admin',
      consoleErrors: ['TypeError: failed'],
      networkErrors: [{ url: 'https://example.com/api/users', status: 500 }],
      formCount: 2,
      linkCount: 12,
      domSummary: {
        headings: ['User Admin'],
        primaryButtons: ['Save', 'Search'],
        navLinks: ['Users', 'Orders'],
        inputHints: ['email / search'],
        ctaCandidates: ['button:Save (score=4)', 'link:Users (score=2)'],
        textSnippet: 'Manage users and search filters',
      },
    };
    const dom: DomSnapshot = {
      url: page.url,
      title: page.title,
      inputs: [{ type: 'text', name: 'email', label: 'Email', selector: 'input[name="email"]' }],
      buttons: [{ text: 'Save', selector: 'button[type="submit"]' }],
      forms: [{ action: '/save', method: 'post', inputCount: 2 }],
    };

    const prompt = buildExplorationDecisionPrompt({
      page,
      config: {
        startUrls: ['https://example.com/admin'],
        allowedHosts: ['example.com'],
        maxSteps: 20,
        maxPages: 8,
        focusAreas: ['navigation', 'forms', 'network-errors'],
      },
      stepIndex: 3,
      visited: ['https://example.com/admin', 'https://example.com/admin/users'],
      recentSteps: ['navigate https://example.com/admin', 'click button[type="submit"]'],
      recentFindings: ['network-error: /api/users returned 500'],
      recentToolResults: ['click button[type="submit"] => Admin Users'],
      recentNetworkHighlights: ['GET fetch status=500 https://example.com/api/users (320ms)'],
      supportedActions: '"click"|"fill"|"navigate"|"done"',
      remainingSteps: 17,
      remainingPages: 6,
      domSnapshot: dom,
    });

    expect(prompt).toContain('Mission');
    expect(prompt).toContain('Remaining budget');
    expect(prompt).toContain('Recent steps');
    expect(prompt).toContain('Recent findings');
    expect(prompt).toContain('Recent tool results');
    expect(prompt).toContain('Recent network highlights');
    expect(prompt).toContain('Available controls');
    expect(prompt).toContain('button[type="submit"]');
    expect(prompt).toContain('input[name="email"]');
    expect(prompt).toContain('CTA candidates');
    expect(prompt).toContain('button:Save (score=4)');
    expect(prompt).toContain('GET fetch status=500 https://example.com/api/users (320ms)');
    expect(prompt).toContain('"action":"click"|"fill"|"navigate"|"done"');
  });

  it('restricts prompt actions to navigate/done when interactive runtime is unavailable', () => {
    const prompt = buildExplorationDecisionPrompt({
      page: {
        url: 'https://example.com/status',
        title: 'Status',
        consoleErrors: [],
        networkErrors: [],
        formCount: 0,
        linkCount: 3,
      },
      config: {
        startUrls: ['https://example.com/status'],
        maxSteps: 4,
        maxPages: 2,
      },
      stepIndex: 1,
      visited: ['https://example.com/status'],
      recentSteps: [],
      recentFindings: [],
      recentToolResults: [],
      recentNetworkHighlights: [],
      supportedActions: '"navigate"|"done"',
      remainingSteps: 3,
      remainingPages: 1,
    });

    expect(prompt).toContain('"action":"navigate"|"done"');
  });
});

describe('ExplorationAgent.decideNextStep', () => {
  it('parses click decisions and preserves selector/reasoning', async () => {
    const { db, cleanup } = makeDb();
    try {
      const prompts: string[] = [];
      const agent = new ExplorationAgent(db, {
        complete: async (prompt: string) => {
          prompts.push(prompt);
          return '{"action":"click","selector":"button[type=\\"submit\\"]","reasoning":"submit the visible form"}';
        },
        isConfigured: () => true,
        model: 'test-model',
      });

      const step = await (agent as unknown as {
        decideNextStep: (page: PageProbe, config: Record<string, unknown>, stepIndex: number, visited: string[], stepLogger: { log: (...args: unknown[]) => void }, sessionId: string, dataRoot: string, actionId?: string, recentSteps?: string[], recentFindings?: string[], recentToolResults?: string[], recentNetworkHighlights?: string[], domSnapshot?: DomSnapshot) => Promise<{ action: string; selector?: string; reasoning: string }>;
      }).decideNextStep(
        {
          url: 'https://example.com/admin',
          title: 'Admin',
          consoleErrors: [],
          networkErrors: [],
          formCount: 1,
          linkCount: 4,
        },
        { startUrls: ['https://example.com/admin'], maxSteps: 10, maxPages: 5, focusAreas: ['forms'] },
        0,
        [],
        { log: () => undefined },
        's1',
        '/tmp',
        'a1',
        [],
        [],
        [],
        [],
        {
          url: 'https://example.com/admin',
          title: 'Admin',
          inputs: [{ type: 'text', name: 'email', selector: 'input[name="email"]' }],
          buttons: [{ text: 'Submit', selector: 'button[type="submit"]' }],
          forms: [{ inputCount: 1 }],
        },
      );

      expect(prompts[0]).toContain('Available controls');
      expect(step.action).toBe('click');
      expect(step.selector).toBe('button[type="submit"]');
      expect(step.reasoning).toContain('submit');
    } finally {
      cleanup();
    }
  });

  it('downgrades click to done when no interactive runtime is available', async () => {
    const { db, cleanup } = makeDb();
    try {
      const logs: unknown[] = [];
      const agent = new ExplorationAgent(db, {
        complete: async () => '{"action":"click","selector":"button.primary","reasoning":"best next action"}',
        isConfigured: () => true,
      });

      const step = await (agent as unknown as {
        decideNextStep: (page: PageProbe, config: Record<string, unknown>, stepIndex: number, visited: string[], stepLogger: { log: (...args: unknown[]) => void }, sessionId: string, dataRoot: string, actionId?: string, recentSteps?: string[], recentFindings?: string[], recentToolResults?: string[], recentNetworkHighlights?: string[], domSnapshot?: DomSnapshot) => Promise<{ action: string; reasoning: string }>;
      }).decideNextStep(
        {
          url: 'https://example.com/status',
          title: 'Status',
          consoleErrors: [],
          networkErrors: [],
          formCount: 0,
          linkCount: 2,
        },
        { startUrls: ['https://example.com/status'], maxSteps: 4, maxPages: 2 },
        0,
        [],
        { log: (...args: unknown[]) => { logs.push(args); } },
        's1',
        '/tmp',
        'a2',
        [],
        [],
        [],
        [],
      );

      expect(step.action).toBe('done');
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});
