/**
 * PlaywrightToolProvider — registers playwright.* tools into a ToolRegistry.
 *
 * Tools registered:
 *   playwright.navigate  { url: string }                → PageState
 *   playwright.click     { selector: string }           → { ok: boolean }
 *   playwright.fill      { selector: string, value: string } → { ok: boolean }
 *   playwright.getState  {}                             → PageState
 *   playwright.close     {}                             → void
 *
 * PageState mirrors PageProbe so ExplorationAgent can use either path.
 */

import type { Browser, BrowserContext, Page, Request, Response } from 'playwright';
import type { ToolRegistry } from './tool-registry.js';
import type { PageProbe } from './exploration-agent.js';
import type { SiteCredentialRow } from '@zarb/storage';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PlaywrightToolProviderOptions {
  /** Milliseconds to wait after navigation before collecting state. Default 500. */
  waitAfterNavigateMs?: number;
}

export interface NetworkEntry {
  ts: string;
  url: string;
  method: string;
  status: number;
  durationMs: number;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  error?: string;
}

export class PlaywrightToolProvider {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly networkLog: NetworkEntry[] = [];
  private readonly requestStartTimes = new Map<string, number>();

  async launch(opts?: PlaywrightToolProviderOptions): Promise<void> {
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: 'zarb-exploration-agent/1.0',
    });
    this.page = await this.context.newPage();

    // Collect network events for later persistence
    this.context.on('request', (req: Request) => {
      this.requestStartTimes.set(req.url(), Date.now());
    });
    this.context.on('response', (res: Response) => {
      const start = this.requestStartTimes.get(res.url()) ?? Date.now();
      this.requestStartTimes.delete(res.url());
      this.networkLog.push({
        ts: new Date().toISOString(),
        url: res.url(),
        method: res.request().method(),
        status: res.status(),
        durationMs: Date.now() - start,
        resourceType: res.request().resourceType(),
      });
    });
    this.context.on('requestfailed', (req: Request) => {
      this.requestStartTimes.delete(req.url());
      this.networkLog.push({
        ts: new Date().toISOString(),
        url: req.url(),
        method: req.method(),
        status: 0,
        durationMs: 0,
        resourceType: req.resourceType(),
        error: req.failure()?.errorText ?? 'unknown',
      });
    });

    void opts;
  }

  registerTools(registry: ToolRegistry, opts?: PlaywrightToolProviderOptions): void {
    const waitMs = opts?.waitAfterNavigateMs ?? 500;

    registry.register('playwright.navigate', async (input) => {
      const { url } = input as { url: string };
      const page = this.requirePage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (waitMs > 0) await page.waitForTimeout(waitMs);
      return this.collectState(page, url);
    });

    registry.register('playwright.click', async (input) => {
      const { selector } = input as { selector: string };
      const page = this.requirePage();
      try {
        await page.click(selector, { timeout: 10_000 });
        await page.waitForTimeout(300);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    });

    registry.register('playwright.fill', async (input) => {
      const { selector, value } = input as { selector: string; value: string };
      const page = this.requirePage();
      try {
        await page.fill(selector, value, { timeout: 10_000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    });

    registry.register('playwright.getState', async () => {
      const page = this.requirePage();
      return this.collectState(page, page.url());
    });

    registry.register('playwright.close', async () => {
      await this.close();
    });
  }

  /**
   * Apply a SiteCredential to the current browser context/page.
   * - cookie: inject cookies directly into context
   * - token: set extra HTTP headers on context
   * - userpass: navigate to loginUrl and fill the form
   */
  async applyCredential(cred: SiteCredentialRow, baseUrl: string): Promise<void> {
    const ctx = this.context;
    const page = this.page;
    if (!ctx || !page) throw new Error('PlaywrightToolProvider not launched');

    if (cred.auth_type === 'cookie' && cred.cookies_json) {
      const cookies = JSON.parse(cred.cookies_json) as Array<{
        name: string; value: string; domain?: string; path?: string;
        expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None';
      }>;
      // Fill in domain from baseUrl if missing
      const domain = (() => { try { return new URL(baseUrl).hostname; } catch { return ''; } })();
      await ctx.addCookies(cookies.map(c => ({ ...c, domain: c.domain ?? domain, path: c.path ?? '/' })));
      return;
    }

    if (cred.auth_type === 'token' && cred.headers_json) {
      const headers = JSON.parse(cred.headers_json) as Record<string, string>;
      await ctx.setExtraHTTPHeaders(headers);
      return;
    }

    if (cred.auth_type === 'userpass' && cred.login_url && cred.username && cred.password) {
      await page.goto(cred.login_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const userSel = cred.username_selector ?? 'input[type="text"], input[name="username"], input[name="email"]';
      const passSel = cred.password_selector ?? 'input[type="password"]';
      const submitSel = cred.submit_selector ?? 'button[type="submit"], input[type="submit"]';
      await page.fill(userSel, cred.username, { timeout: 10_000 });
      await page.fill(passSel, cred.password, { timeout: 10_000 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined),
        page.click(submitSel, { timeout: 10_000 }),
      ]);
    }
  }

  /** Write collected network entries as NDJSON to the given path. */
  flushNetworkLog(filePath: string): void {
    if (this.networkLog.length === 0) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const lines = this.networkLog.map(e => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(filePath, lines, 'utf8');
  }

  async close(): Promise<void> {
    try { await this.page?.close(); } catch { /* ignore */ }
    try { await this.context?.close(); } catch { /* ignore */ }
    try { await this.browser?.close(); } catch { /* ignore */ }
    this.page = null; this.context = null; this.browser = null;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('PlaywrightToolProvider not launched');
    return this.page;
  }

  private async collectState(page: Page, url: string): Promise<PageProbe> {
    const consoleErrors: string[] = [];
    const networkErrors: Array<{ url: string; status: number }> = [];

    // Collect console errors via evaluate (avoids listener lifecycle issues)
    const title = await page.title().catch(() => '');

    const counts = await page.evaluate(() => [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).document.querySelectorAll('form').length as number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).document.querySelectorAll('a[href]').length as number,
    ]).catch(() => [0, 0]);
    const formCount = counts[0] ?? 0;
    const linkCount = counts[1] ?? 0;

    return { url, title, consoleErrors, networkErrors, formCount, linkCount };
  }

  /** Build a probe function compatible with ExplorationAgent's probe callback. */
  buildProbe(): (url: string) => Promise<PageProbe> {
    return async (url: string) => {
      const page = this.requirePage();
      const networkErrors: Array<{ url: string; status: number }> = [];
      const consoleErrors: string[] = [];

      // Attach one-shot listeners before navigation
      const onResponse = (res: import('playwright').Response): void => {
        if (res.status() >= 400) networkErrors.push({ url: res.url(), status: res.status() });
      };
      const onConsole = (msg: import('playwright').ConsoleMessage): void => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      };
      page.on('response', onResponse);
      page.on('console', onConsole);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(500);
        const title = await page.title().catch(() => '');
        const counts = await page.evaluate(() => [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).document.querySelectorAll('form').length as number,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).document.querySelectorAll('a[href]').length as number,
        ]).catch(() => [0, 0]);
        const formCount = counts[0] ?? 0;
        const linkCount = counts[1] ?? 0;
        return { url, title, consoleErrors, networkErrors, formCount, linkCount };
      } finally {
        page.off('response', onResponse);
        page.off('console', onConsole);
      }
    };
  }
}
