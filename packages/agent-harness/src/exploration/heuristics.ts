import type { ExplorationConfig } from '@zarb/shared-types';
import { isLoginUrl } from '../playwright-tool-provider.js';
import type { ExplorationBrainPlan, PageProbe } from './types.js';

export function hasAuthNetworkError(page: PageProbe): boolean {
  return page.networkErrors.some((entry) => entry.status === 401 || entry.status === 403);
}

export function normalizeAbsoluteUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function dedupeUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of urls) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function deriveAllowedHosts(config: ExplorationConfig, fallbackUrl: string): string[] {
  if (config.allowedHosts && config.allowedHosts.length > 0) return config.allowedHosts;
  try {
    return [new URL(fallbackUrl).hostname];
  } catch {
    return [];
  }
}

export function isUrlAllowedByHosts(url: string, allowedHosts: string[]): boolean {
  try {
    const host = new URL(url).hostname;
    if (allowedHosts.length === 0) return true;
    return allowedHosts.includes(host);
  } catch {
    return false;
  }
}

export function includesNoScriptBanner(page: PageProbe): boolean {
  if (page.domSummary?.noScriptWarningVisible) return true;
  const snippet = page.domSummary?.textSnippet ?? '';
  return /doesn'?t work properly without javascript enabled/i.test(snippet);
}

export function pageLooksLikeLogin(page: PageProbe): boolean {
  if (isLoginUrl(page.url)) return true;
  const title = page.title ?? '';
  const hints = page.domSummary?.inputHints.join(' ') ?? '';
  const snippet = page.domSummary?.textSnippet ?? '';
  const loginCue = `${title} ${hints} ${snippet}`;
  const hasLoginKeyword = /(登录|sign[ -]?in|log[ -]?in|password|密码|username|用户名|账号|账号登录|验证码|captcha)/i.test(loginCue);
  return page.formCount > 0 && hasLoginKeyword;
}

export function buildFallbackBrainPlan(
  page: PageProbe,
  config: ExplorationConfig,
  visited: string[],
  authEstablished: boolean,
): ExplorationBrainPlan {
  const hasAuthError = hasAuthNetworkError(page);
  const loginDetected = pageLooksLikeLogin(page) || hasAuthError;
  const defaultObjective = 'Expand coverage by interacting with visible controls before navigating.';
  const startCandidates = config.startUrls
    .map((url) => normalizeAbsoluteUrl(url, page.url))
    .filter((url): url is string => !!url);
  const visitedNonLogin = visited.filter((url) => !isLoginUrl(url));
  const loginUrls = startCandidates.filter((url) => isLoginUrl(url));
  const lastVisitedNonLogin = visitedNonLogin.length > 0 ? visitedNonLogin[visitedNonLogin.length - 1]! : '';
  const preferredActions: Array<'click' | 'fill' | 'navigate' | 'done'> =
    page.formCount > 0 || page.linkCount > 0 ? ['click', 'fill', 'navigate', 'done'] : ['navigate', 'click', 'fill', 'done'];

  if (authEstablished && isLoginUrl(page.url) && !hasAuthError) {
    return {
      phase: 'recover',
      objective: 'Leave login page after successful authentication and continue post-login exploration.',
      reasoning: 'Authenticated session should not restart login without explicit auth failure.',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: dedupeUrls([lastVisitedNonLogin, ...startCandidates.filter((url) => !isLoginUrl(url))]),
      avoidUrls: dedupeUrls(loginUrls),
      preferredActions: ['navigate', 'click', 'fill', 'done'],
    };
  }

  if (!authEstablished && loginDetected) {
    return {
      phase: 'bootstrap',
      objective: 'Complete login first, then proceed with authenticated exploration.',
      reasoning: hasAuthError
        ? 'Auth-related network errors indicate session is not authorized.'
        : 'Current page appears to be a login gate.',
      requiresLogin: true,
      loginReason: hasAuthError ? 'network auth error (401/403)' : 'login page detected',
      candidateUrls: dedupeUrls([page.url, ...startCandidates]),
      avoidUrls: [],
      preferredActions: ['fill', 'click', 'done'],
    };
  }

  if (includesNoScriptBanner(page)) {
    return {
      phase: authEstablished ? 'recover' : 'bootstrap',
      objective: 'Recover from non-interactive page and enter a route with real interactive controls.',
      reasoning: 'No-script banner indicates current route is not a useful exploration target.',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: dedupeUrls([...startCandidates.filter((url) => !isLoginUrl(url)), lastVisitedNonLogin]),
      avoidUrls: authEstablished ? dedupeUrls(loginUrls) : [],
      preferredActions: ['navigate', 'click', 'fill', 'done'],
    };
  }

  if (authEstablished && !isLoginUrl(page.url)) {
    return {
      phase: 'post-login',
      objective: 'Stay in authenticated area and explore meaningful user workflows.',
      reasoning: 'Session is authenticated and current page is in post-login scope.',
      requiresLogin: false,
      loginReason: '',
      candidateUrls: dedupeUrls([...startCandidates.filter((url) => !isLoginUrl(url)), ...visitedNonLogin.slice(-2)]),
      avoidUrls: dedupeUrls(loginUrls),
      preferredActions,
    };
  }

  return {
    phase: 'explore',
    objective: defaultObjective,
    reasoning: 'Default fallback when no stronger planning signal is available.',
    requiresLogin: false,
    loginReason: '',
    candidateUrls: dedupeUrls(startCandidates),
    avoidUrls: [],
    preferredActions,
  };
}
