import { describe, expect, it } from 'vitest';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { PageProbe } from '../src/exploration/types.js';
import {
  buildFallbackBrainPlan,
  dedupeUrls,
  deriveAllowedHosts,
  hasAuthNetworkError,
  includesNoScriptBanner,
  isUrlAllowedByHosts,
  normalizeAbsoluteUrl,
  pageLooksLikeLogin,
} from '../src/exploration/heuristics.js';

function makePage(overrides: Partial<PageProbe> = {}): PageProbe {
  return {
    url: 'https://example.com/dashboard',
    title: 'Dashboard',
    consoleErrors: [],
    networkErrors: [],
    formCount: 0,
    linkCount: 3,
    ...overrides,
  };
}

describe('exploration heuristics', () => {
  it('detects auth-related network failures', () => {
    expect(hasAuthNetworkError(makePage({
      networkErrors: [{ url: 'https://example.com/api/me', status: 401 }],
    }))).toBe(true);

    expect(hasAuthNetworkError(makePage({
      networkErrors: [{ url: 'https://example.com/api/me', status: 500 }],
    }))).toBe(false);
  });

  it('detects no-script banners from DOM signals', () => {
    expect(includesNoScriptBanner(makePage({
      domSummary: {
        headings: [],
        primaryButtons: [],
        navLinks: [],
        inputHints: [],
        textSnippet: "This app doesn't work properly without JavaScript enabled.",
      },
    }))).toBe(true);
  });

  it('detects login pages from URL or login cues', () => {
    expect(pageLooksLikeLogin(makePage({
      url: 'https://example.com/login',
    }))).toBe(true);

    expect(pageLooksLikeLogin(makePage({
      formCount: 1,
      domSummary: {
        headings: [],
        primaryButtons: ['登录'],
        navLinks: [],
        inputHints: ['username password'],
        textSnippet: '请输入账号密码登录',
      },
    }))).toBe(true);
  });

  it('normalizes URLs and strips hash fragments', () => {
    expect(normalizeAbsoluteUrl('/admin#users', 'https://example.com/dashboard')).toBe('https://example.com/admin');
    expect(normalizeAbsoluteUrl('not a url', '%%%%')).toBeNull();
  });

  it('deduplicates URLs while preserving order', () => {
    expect(dedupeUrls([
      'https://example.com/a',
      'https://example.com/a',
      '',
      'https://example.com/b',
    ])).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('derives allowed hosts and validates candidate URLs', () => {
    const config: ExplorationConfig = {
      startUrls: ['https://example.com/dashboard'],
      maxSteps: 5,
      maxPages: 3,
    };

    expect(deriveAllowedHosts(config, 'https://example.com/dashboard')).toEqual(['example.com']);
    expect(isUrlAllowedByHosts('https://example.com/admin', ['example.com'])).toBe(true);
    expect(isUrlAllowedByHosts('https://evil.example.net/admin', ['example.com'])).toBe(false);
  });

  it('builds recover fallback plan after successful auth on login page', () => {
    const config: ExplorationConfig = {
      startUrls: [
        'https://example.com/login',
        'https://example.com/dashboard',
      ],
      maxSteps: 5,
      maxPages: 3,
    };

    const plan = buildFallbackBrainPlan(
      makePage({
        url: 'https://example.com/login',
        formCount: 1,
      }),
      config,
      ['https://example.com/dashboard'],
      true,
    );

    expect(plan.phase).toBe('recover');
    expect(plan.requiresLogin).toBe(false);
    expect(plan.candidateUrls).toContain('https://example.com/dashboard');
    expect(plan.avoidUrls).toContain('https://example.com/login');
  });

  it('builds bootstrap fallback plan when login is required', () => {
    const config: ExplorationConfig = {
      startUrls: ['https://example.com/dashboard'],
      maxSteps: 5,
      maxPages: 3,
    };

    const plan = buildFallbackBrainPlan(
      makePage({
        formCount: 1,
        domSummary: {
          headings: ['欢迎登录'],
          primaryButtons: ['登录'],
          navLinks: [],
          inputHints: ['用户名', '密码'],
          textSnippet: '请先登录继续',
        },
      }),
      config,
      [],
      false,
    );

    expect(plan.phase).toBe('bootstrap');
    expect(plan.requiresLogin).toBe(true);
    expect(plan.preferredActions).toEqual(['fill', 'click', 'done']);
  });
});
