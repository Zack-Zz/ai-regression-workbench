import { HARNESS_TEMPLATE_VERSIONS, renderHarnessTemplate } from '../prompt-loader.js';
import type {
  ExplorationBrainPlan,
  ExplorationPlanPromptContext,
  ExplorationPromptContext,
  PageProbe,
} from '../exploration-agent.js';
import type { DomSnapshot } from '../playwright-tool-provider.js';
import type { ExplorationConfig } from '@zarb/shared-types';

export function buildExplorationDecisionPrompt(ctx: ExplorationPromptContext): string {
  const focusDirectives = summarizeFocusAreas(ctx.config).map((item) => `- ${item}`);
  const domSummary = ctx.page.domSummary
    ? [
      `Headings: ${ctx.page.domSummary.headings.join(' | ') || 'none'}`,
      `Primary buttons: ${ctx.page.domSummary.primaryButtons.join(' | ') || 'none'}`,
      `Nav links: ${ctx.page.domSummary.navLinks.join(' | ') || 'none'}`,
      `Input hints: ${ctx.page.domSummary.inputHints.join(' | ') || 'none'}`,
      `CTA candidates: ${ctx.page.domSummary.ctaCandidates?.join(' | ') || 'none'}`,
      `Text snippet: ${ctx.page.domSummary.textSnippet ?? 'none'}`,
    ].join('\n')
    : 'No page summary available.';
  return renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.explorationDecision, {
    startUrls: ctx.config.startUrls.join(', '),
    allowedHosts: (ctx.config.allowedHosts ?? []).join(', ') || 'derived from start URL',
    stepIndex: String(ctx.stepIndex),
    remainingBudget: `${String(ctx.remainingSteps)} steps, ${String(ctx.remainingPages)} pages`,
    focusAreas: listOrFallback(focusDirectives, '- general exploration'),
    currentPage: `${ctx.page.url} (title: "${ctx.page.title}")`,
    observedCounts: `forms=${String(ctx.page.formCount)}, links=${String(ctx.page.linkCount)}, consoleErrors=${String(ctx.page.consoleErrors.length)}, networkErrors=${String(ctx.page.networkErrors.length)}`,
    consoleErrors: ctx.page.consoleErrors.slice(0, 3).join(' | ') || 'none',
    networkErrors: ctx.page.networkErrors.slice(0, 3).map((item) => `${item.status} ${item.url}`).join(' | ') || 'none',
    availableControls: `${summarizeDomSnapshot(ctx.domSnapshot)}\n${domSummary}`,
    visitedPages: ctx.visited.slice(-8).join(', ') || 'none',
    recentSteps: ctx.recentSteps.length > 0 ? ctx.recentSteps.join(' | ') : 'none',
    recentFindings: ctx.recentFindings.length > 0 ? ctx.recentFindings.join(' | ') : 'none',
    recentToolResults: ctx.recentToolResults.length > 0 ? ctx.recentToolResults.join(' | ') : 'none',
    recentNetworkHighlights: ctx.recentNetworkHighlights.length > 0 ? ctx.recentNetworkHighlights.join(' | ') : 'none',
    brainPlan: summarizeBrainPlan(ctx.brainPlan),
    supportedActions: ctx.supportedActions,
  });
}

export function buildExplorationPlanPrompt(ctx: ExplorationPlanPromptContext): string {
  const focusDirectives = summarizeFocusAreas(ctx.config).map((item) => `- ${item}`);
  const loginDetected = pageLooksLikeLogin(ctx.page) || hasAuthNetworkError(ctx.page);
  return renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.explorationPlan, {
    startUrls: ctx.config.startUrls.join(', '),
    allowedHosts: (ctx.config.allowedHosts ?? []).join(', ') || 'derived from start URL',
    currentPage: `${ctx.page.url} (title: "${ctx.page.title}")`,
    observedCounts: `forms=${String(ctx.page.formCount)}, links=${String(ctx.page.linkCount)}, consoleErrors=${String(ctx.page.consoleErrors.length)}, networkErrors=${String(ctx.page.networkErrors.length)}`,
    noScriptSignal: includesNoScriptBanner(ctx.page) ? 'yes' : 'no',
    loginDetected: loginDetected ? 'yes' : 'no',
    authEstablished: ctx.authEstablished ? 'yes' : 'no',
    remainingBudget: `${String(ctx.remainingSteps)} steps, ${String(ctx.remainingPages)} pages`,
    focusAreas: listOrFallback(focusDirectives, '- general exploration'),
    visitedPages: ctx.visited.slice(-12).join(', ') || 'none',
    recentSteps: ctx.recentSteps.length > 0 ? ctx.recentSteps.join(' | ') : 'none',
    recentFindings: ctx.recentFindings.length > 0 ? ctx.recentFindings.join(' | ') : 'none',
    recentToolResults: ctx.recentToolResults.length > 0 ? ctx.recentToolResults.join(' | ') : 'none',
    recentNetworkHighlights: ctx.recentNetworkHighlights.length > 0 ? ctx.recentNetworkHighlights.join(' | ') : 'none',
    stepIndex: String(ctx.stepIndex),
  });
}

export function summarizePromptContext(ctx: ExplorationPromptContext): string {
  const fields = [
    `remainingSteps=${String(ctx.remainingSteps)}`,
    `remainingPages=${String(ctx.remainingPages)}`,
    `visited=${String(ctx.visited.length)}`,
    `recentSteps=${String(ctx.recentSteps.length)}`,
    `recentFindings=${String(ctx.recentFindings.length)}`,
    `recentToolResults=${String(ctx.recentToolResults.length)}`,
    `recentNetwork=${String(ctx.recentNetworkHighlights.length)}`,
    `actions=${ctx.supportedActions.replace(/"/g, '')}`,
    `focusAreas=${(ctx.config.focusAreas ?? []).join('|') || 'general'}`,
  ];
  if (ctx.brainPlan) {
    fields.push(`brainPhase=${ctx.brainPlan.phase}`);
    fields.push(`brainLogin=${ctx.brainPlan.requiresLogin ? 'yes' : 'no'}`);
    fields.push(`brainCandidates=${String(ctx.brainPlan.candidateUrls.length)}`);
    fields.push(`brainAvoid=${String(ctx.brainPlan.avoidUrls.length)}`);
  }
  return fields.join(' ');
}

function summarizeFocusAreas(config: ExplorationConfig): string[] {
  const focusAreas = config.focusAreas ?? ['navigation', 'forms', 'console-errors', 'network-errors'];
  const directives: string[] = [];
  if (focusAreas.includes('navigation')) directives.push('prioritize meaningful user flows and page transitions');
  if (focusAreas.includes('forms')) directives.push('exercise visible forms, search boxes, filters, and submission paths');
  if (focusAreas.includes('auth')) directives.push('watch for auth walls, session expiry, and redirects to login');
  if (focusAreas.includes('console-errors')) directives.push('capture client-side exceptions and broken page behavior');
  if (focusAreas.includes('network-errors')) directives.push('surface failed APIs, bad status codes, and degraded responses');
  if (focusAreas.includes('smoke')) directives.push('cover key happy paths before going deep');
  return directives;
}

function summarizeDomSnapshot(domSnapshot?: DomSnapshot): string {
  if (!domSnapshot) return 'No structured DOM snapshot available.';
  const inputs = domSnapshot.inputs.slice(0, 8).map((input) =>
    `${input.selector} [type=${input.type}${input.name ? `, name=${input.name}` : ''}${input.label ? `, label=${input.label}` : ''}${input.placeholder ? `, placeholder=${input.placeholder}` : ''}]`
  );
  const buttons = domSnapshot.buttons.slice(0, 8).map((button) =>
    `${button.selector} [text=${button.text || '—'}${button.type ? `, type=${button.type}` : ''}]`
  );
  const forms = domSnapshot.forms.slice(0, 5).map((form, index) =>
    `form#${String(index + 1)} [action=${form.action ?? '—'}, method=${form.method ?? '—'}, inputs=${String(form.inputCount)}]`
  );
  const clickables = (domSnapshot.clickables ?? []).slice(0, 14).map((item) =>
    `${item.selector} [text=${item.text}${item.role ? `, role=${item.role}` : ''}${item.area ? `, area=${item.area}` : ''}]`
  );
  return [
    `Inputs: ${inputs.length > 0 ? inputs.join(' | ') : 'none'}`,
    `Buttons: ${buttons.length > 0 ? buttons.join(' | ') : 'none'}`,
    `Forms: ${forms.length > 0 ? forms.join(' | ') : 'none'}`,
    `Clickables: ${clickables.length > 0 ? clickables.join(' | ') : 'none'}`,
  ].join('\n');
}

function listOrFallback(items: string[], fallback: string): string {
  return items.length > 0 ? items.join('\n') : fallback;
}

function summarizeBrainPlan(plan?: ExplorationBrainPlan): string {
  if (!plan) return 'none';
  return [
    `phase=${plan.phase}`,
    `objective=${plan.objective}`,
    `requiresLogin=${plan.requiresLogin ? 'yes' : 'no'}`,
    `loginReason=${plan.loginReason || 'none'}`,
    `candidateUrls=${plan.candidateUrls.join(', ') || 'none'}`,
    `avoidUrls=${plan.avoidUrls.join(', ') || 'none'}`,
    `preferredActions=${plan.preferredActions.join('|') || 'none'}`,
  ].join('\n');
}

function hasAuthNetworkError(page: PageProbe): boolean {
  return page.networkErrors.some((entry) => entry.status === 401 || entry.status === 403);
}

function includesNoScriptBanner(page: PageProbe): boolean {
  if (page.domSummary?.noScriptWarningVisible) return true;
  const snippet = page.domSummary?.textSnippet ?? '';
  return /doesn'?t work properly without javascript enabled/i.test(snippet);
}

function pageLooksLikeLogin(page: PageProbe): boolean {
  const title = page.title ?? '';
  const hints = page.domSummary?.inputHints.join(' ') ?? '';
  const snippet = page.domSummary?.textSnippet ?? '';
  const loginCue = `${title} ${hints} ${snippet}`;
  const hasLoginKeyword = /(登录|sign[ -]?in|log[ -]?in|password|密码|username|用户名|账号|账号登录|验证码|captcha)/i.test(loginCue);
  return (page.url.includes('/login') || page.url.includes('/signin') || page.url.includes('/auth')) || (page.formCount > 0 && hasLoginKeyword);
}
