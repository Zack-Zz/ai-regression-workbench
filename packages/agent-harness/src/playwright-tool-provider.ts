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
import { appLogger } from '@zarb/logger';

const log = appLogger.child('PlaywrightTool');

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
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  error?: string;
}

export class PlaywrightToolProvider {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly networkLog: NetworkEntry[] = [];
  private readonly consoleErrorLog: Array<{ ts: string; url: string; text: string }> = [];
  private readonly requestStartTimes = new Map<string, number>();
  private stateCursor = { network: 0, console: 0 };

  async launch(opts?: PlaywrightToolProviderOptions): Promise<void> {
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: 'zarb-exploration-agent/1.0',
    });
    this.page = await this.context.newPage();
    this.stateCursor = { network: 0, console: 0 };

    // Collect network events for later persistence
    this.context.on('request', (req: Request) => {
      this.requestStartTimes.set(req.url(), Date.now());
    });
    this.context.on('response', (res: Response) => {
      const start = this.requestStartTimes.get(res.url()) ?? Date.now();
      this.requestStartTimes.delete(res.url());
      const req = res.request();
      const type = req.resourceType();
      const entry: NetworkEntry = {
        ts: new Date().toISOString(),
        url: res.url(),
        method: req.method(),
        status: res.status(),
        durationMs: Date.now() - start,
        resourceType: type,
        requestHeaders: req.headers(),
        responseHeaders: res.headers(),
      };
      if (type === 'xhr' || type === 'fetch') {
        const postData = req.postData();
        if (postData) entry.requestBody = postData;
        res.text().then(body => { entry.responseBody = body.slice(0, 4096); }).catch(() => undefined);
      }
      this.networkLog.push(entry);
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
    this.page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      this.consoleErrorLog.push({
        ts: new Date().toISOString(),
        url: this.page?.url() ?? '',
        text: msg.text(),
      });
    });

    void opts;
  }

  registerTools(registry: ToolRegistry, opts?: PlaywrightToolProviderOptions): void {
    const waitMs = opts?.waitAfterNavigateMs ?? 500;

    registry.register('playwright.navigate', async (input) => {
      const { url } = input as { url: string };
      const page = this.requirePage();
      log.debug('navigate', { url });
      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (waitMs > 0) await page.waitForTimeout(waitMs);
      const state = await this.collectState(page, url);
      log.debug('navigate done', { url, title: state.title, formCount: state.formCount, linkCount: state.linkCount, consoleErrors: state.consoleErrors.length, networkErrors: state.networkErrors.length, durationMs: Date.now() - t0 });
      return state;
    });

    registry.register('playwright.click', async (input) => {
      const { selector } = input as { selector: string };
      const page = this.requirePage();
      log.debug('click', { selector });
      const t0 = Date.now();
      try {
        await page.click(selector, { timeout: 10_000 });
        await page.waitForTimeout(300);
        log.debug('click ok', { selector, durationMs: Date.now() - t0 });
        return { ok: true };
      } catch (e) {
        log.warn('click failed', { selector, error: String(e), durationMs: Date.now() - t0 });
        throw new Error(String(e));
      }
    });

    registry.register('playwright.fill', async (input) => {
      const { selector, value } = input as { selector: string; value: string };
      const page = this.requirePage();
      log.debug('fill', { selector, valueLength: String(value).length });
      const t0 = Date.now();
      try {
        await page.fill(selector, value, { timeout: 10_000 });
        log.debug('fill ok', { selector, durationMs: Date.now() - t0 });
        return { ok: true };
      } catch (e) {
        log.warn('fill failed', { selector, error: String(e), durationMs: Date.now() - t0 });
        throw new Error(String(e));
      }
    });

    registry.register('playwright.getState', async () => {
      const page = this.requirePage();
      log.debug('getState', { url: page.url() });
      return this.collectState(page, page.url());
    });

    registry.register('playwright.close', async () => {
      log.debug('close');
      await this.close();
    });
  }

  /**
   * Apply a SiteCredential to the current browser context/page.
   * - cookie: inject cookies directly into context
   * - token: set extra HTTP headers on context
   * - userpass: navigate to loginUrl and fill the form
   * After applying, verifies login succeeded (throws LoginFailedError if not).
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
      const loginUrl = cred.login_url;
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const userSel = cred.username_selector ?? 'input[type="text"], input[name="username"], input[name="email"]';
      const passSel = cred.password_selector ?? 'input[type="password"]';
      await page.fill(userSel, cred.username, { timeout: 10_000 });
      await page.fill(passSel, cred.password, { timeout: 10_000 });

      let submitSel = cred.submit_selector;
      if (!submitSel) {
        const candidates = ['button[type="submit"]', 'input[type="submit"]', 'button[type="button"]', 'button'];
        for (const sel of candidates) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1000 }).catch(() => false)) { submitSel = sel; break; }
        }
        submitSel ??= 'button';
      }
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined),
        page.click(submitSel, { timeout: 10_000 }),
      ]);

      await this.verifyLoginSuccess(loginUrl);
    }
  }

  /** Verify the page is no longer the login page. Throws if login appears to have failed. */
  private async verifyLoginSuccess(loginUrl: string): Promise<void> {
    const page = this.requirePage();
    const currentUrl = page.url();
    const isStillLoginPage = currentUrl === loginUrl || isLoginUrl(currentUrl);
    if (isStillLoginPage) {
      throw new LoginFailedError(`Login verification failed: still on login page (${currentUrl})`);
    }
    // Check for password input still visible — indicates login form still present
    const hasPasswordInput = await page.locator('input[type="password"]').isVisible({ timeout: 1000 }).catch(() => false);
    if (hasPasswordInput) {
      throw new LoginFailedError(`Login verification failed: password input still visible on ${currentUrl}`);
    }
  }

  /** Collect a structured DOM snapshot for AI login decision-making. */
  async collectDomSnapshot(): Promise<DomSnapshot> {
    const page = this.requirePage();
    const url = page.url();
    const title = await page.title().catch(() => '');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getLabelText = (el: any): string => {
        const id = el.getAttribute('id');
        if (id) { const lbl = doc.querySelector(`label[for="${id as string}"]`); if (lbl) return (lbl.textContent ?? '').trim(); }
        const parent = el.closest('label');
        return parent ? (parent.textContent ?? '').trim().replace(el.value ?? '', '').trim() : '';
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputs = Array.from(doc.querySelectorAll('input:not([type=hidden]):not([type=submit])')).slice(0, 20).map((el: any, i: number) => {
        const id = el.getAttribute('id') as string | null;
        const name = el.getAttribute('name') as string | null;
        return { type: (el.getAttribute('type') ?? 'text') as string, name: name ?? undefined, id: id ?? undefined, placeholder: (el.getAttribute('placeholder') as string | null) ?? undefined, label: getLabelText(el) || undefined, selector: id ? `#${id}` : name ? `input[name="${name}"]` : `input:nth-of-type(${i + 1})` };
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buttons = Array.from(doc.querySelectorAll('button, input[type=submit]')).slice(0, 10).map((el: any, i: number) => {
        const id = el.getAttribute('id') as string | null;
        return { text: ((el.textContent ?? el.getAttribute('value') ?? '') as string).trim(), type: (el.getAttribute('type') as string | null) ?? undefined, selector: id ? `#${id}` : `button:nth-of-type(${i + 1})` };
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const forms = Array.from(doc.querySelectorAll('form')).slice(0, 5).map((f: any) => ({ action: (f.getAttribute('action') as string | null) ?? undefined, method: (f.getAttribute('method') as string | null) ?? undefined, inputCount: f.querySelectorAll('input').length as number }));
      return { inputs, buttons, forms };
    }).catch(() => ({ inputs: [], buttons: [], forms: [] }));

    return { url, title, ...(raw as { inputs: DomSnapshot['inputs']; buttons: DomSnapshot['buttons']; forms: DomSnapshot['forms'] }) };
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
    this.stateCursor = { network: this.networkLog.length, console: this.consoleErrorLog.length };
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('PlaywrightToolProvider not launched');
    return this.page;
  }

  /** Returns the active page, or throws if not launched. */
  getPage(): Page {
    return this.requirePage();
  }

  getRecentNetworkHighlights(limit = 5): string[] {
    return this.networkLog
      .filter((entry) =>
        entry.status >= 400 ||
        !!entry.error ||
        ((entry.resourceType === 'xhr' || entry.resourceType === 'fetch') && entry.durationMs >= 1200)
      )
      .slice(-limit)
      .map((entry) => {
        const status = entry.error ? `error=${entry.error}` : `status=${String(entry.status)}`;
        return `${entry.method} ${entry.resourceType} ${status} ${entry.url} (${String(entry.durationMs)}ms)`;
      });
  }

  private async collectState(page: Page, url: string): Promise<PageProbe> {
    const recentConsole = this.consoleErrorLog.slice(this.stateCursor.console);
    const recentNetwork = this.networkLog.slice(this.stateCursor.network);
    this.stateCursor = { network: this.networkLog.length, console: this.consoleErrorLog.length };
    const consoleErrors = recentConsole.slice(-10).map((entry) => entry.text);
    const networkErrors = recentNetwork
      .filter((entry) => entry.status >= 400 || !!entry.error)
      .slice(-10)
      .map((entry) => ({ url: entry.url, status: entry.status }));

    // Collect console errors via evaluate (avoids listener lifecycle issues)
    const title = await page.title().catch(() => '');

    const snapshot = await page.evaluate(() => {
      const doc = ((globalThis as unknown) as { document: { querySelectorAll: (selector: string) => ArrayLike<{ textContent?: string | null }>; querySelector: (selector: string) => { textContent?: string | null } | null; body?: { textContent?: string | null } | null } }).document;
      const textOf = (el: { textContent?: string | null } | null): string => (el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const scoreText = (text: string): number => {
        const normalized = text.toLowerCase();
        let score = 0;
        if (/submit|save|search|next|continue|create|add|new|view|detail|login|sign in|checkout|apply/.test(normalized)) score += 3;
        if (/cancel|close|back/.test(normalized)) score -= 2;
        if (normalized.length > 0 && normalized.length < 40) score += 1;
        return score;
      };
      const headings = Array.from(doc.querySelectorAll('h1, h2, h3')).slice(0, 5).map((el) => textOf(el)).filter(Boolean);
      const primaryButtons = Array.from(doc.querySelectorAll('button, input[type=submit], [role="button"]')).slice(0, 8).map((el) => textOf(el)).filter(Boolean);
      const navLinks = Array.from(doc.querySelectorAll('nav a[href], aside a[href], header a[href]')).slice(0, 8).map((el) => textOf(el)).filter(Boolean);
      const ctaCandidates = [
        ...Array.from(doc.querySelectorAll('button, input[type=submit], [role="button"]')).map((el) => ({ kind: 'button', text: textOf(el) })),
        ...Array.from(doc.querySelectorAll('a[href]')).slice(0, 20).map((el) => ({ kind: 'link', text: textOf(el) })),
      ]
        .filter((item) => item.text)
        .map((item) => ({ ...item, score: scoreText(item.text) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map((item) => `${item.kind}:${item.text} (score=${String(item.score)})`);
      const inputHints = Array.from(doc.querySelectorAll('input:not([type=hidden]), textarea, select')).slice(0, 8).map((el) => {
        const htmlEl = el as { getAttribute: (name: string) => string | null };
        return [htmlEl.getAttribute('name'), htmlEl.getAttribute('placeholder'), htmlEl.getAttribute('aria-label')].filter(Boolean).join(' / ');
      }).filter(Boolean);
      const textSnippet = textOf(doc.querySelector('main')) || textOf(doc.body ?? null);
      return {
        formCount: doc.querySelectorAll('form').length,
        linkCount: doc.querySelectorAll('a[href]').length,
        headings,
        primaryButtons,
        navLinks,
        ctaCandidates,
        inputHints,
        textSnippet,
      };
    }).catch(() => ({ formCount: 0, linkCount: 0, headings: [], primaryButtons: [], navLinks: [], ctaCandidates: [], inputHints: [], textSnippet: '' }));

    return {
      url,
      title,
      consoleErrors,
      networkErrors,
      formCount: snapshot.formCount ?? 0,
      linkCount: snapshot.linkCount ?? 0,
      domSummary: {
        headings: snapshot.headings ?? [],
        primaryButtons: snapshot.primaryButtons ?? [],
        navLinks: snapshot.navLinks ?? [],
        ctaCandidates: snapshot.ctaCandidates ?? [],
        inputHints: snapshot.inputHints ?? [],
        ...(snapshot.textSnippet ? { textSnippet: snapshot.textSnippet } : {}),
      },
    };
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
        return this.collectState(page, url).then((state) => ({
          ...state,
          consoleErrors,
          networkErrors,
        }));
      } finally {
        page.off('response', onResponse);
        page.off('console', onConsole);
      }
    };
  }
}

export interface DomSnapshot {
  url: string;
  title: string;
  inputs: Array<{ type: string; name?: string; id?: string; placeholder?: string; label?: string; selector: string }>;
  buttons: Array<{ text: string; type?: string; selector: string }>;
  forms: Array<{ action?: string; method?: string; inputCount: number }>;
}

/** Thrown when login verification fails after applyCredential(). */
export class LoginFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginFailedError';
  }
}

const LOGIN_URL_PATTERNS = ['/login', '/signin', '/sign-in', '/auth', '/sso', '/account/login'];

export function isLoginUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return LOGIN_URL_PATTERNS.some(p => path.includes(p));
  } catch {
    return false;
  }
}
