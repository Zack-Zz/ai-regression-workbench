import type { ExplorationConfig } from '@zarb/shared-types';
import type { SiteCredentialRow } from '@zarb/storage';
import { HARNESS_TEMPLATE_VERSIONS, renderHarnessTemplate } from '../prompt-loader.js';
import { isLoginUrl } from '../playwright-tool-provider.js';
import type { DomSnapshot } from '../playwright-tool-provider.js';
import type { HarnessSessionManager } from '../runtime/session-manager.js';
import type { StepLogger } from '@zarb/logger';
import type { ExplorationBrowserAdapter } from './browser-adapter.js';

interface AuthProvider {
  complete(prompt: string, options?: {
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
    scene?: 'explorationDecision' | 'explorationLogin';
  }): Promise<string>;
  readonly model: string | undefined;
}

const LOGIN_DECIDE_SYSTEM_PROMPT = 'You are a login decision agent. Return only structured JSON for the next login action.';

const LOGIN_DECIDE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'decide_login_action',
    description: 'Choose the next login action.',
    parameters: {
      type: 'object',
      properties: {
        isLoginPage: { type: 'boolean' },
        action: { type: 'string', enum: ['fill', 'click', 'done'] },
        selector: { type: 'string' },
        value: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['isLoginPage', 'action', 'reasoning'],
      additionalProperties: false,
    },
    strict: true,
  },
};

const SLIDER_HANDLE_SELECTORS = [
  '.verify-move-block',
  '.verify-move',
  '.verify-move-btn',
  '.verify-slider-btn',
  '.geetest_slider_button',
  '.nc_iconfont.btn_slide',
  '[class*="verify"] [class*="move-block"]',
  '[class*="verify"] [class*="move"]',
  '[class*="verify"] [class*="drag"]',
  '[class*="slider"][class*="button"]',
  '[class*="slider"][class*="handle"]',
  '[class*="slider"][class*="btn"]',
];

const SLIDER_TRACK_SELECTORS = [
  '.verify-bar-area',
  '.verify-slider',
  '.geetest_slider',
  '.nc_scale',
  '.verify-con',
  '.verify-content',
  '[class*="slider"][class*="track"]',
  '[class*="verify"][class*="content"]',
];

interface SliderGeometry {
  handleBox: { x: number; y: number; width: number; height: number };
  startX: number;
  startY: number;
  travelWidth: number;
}

interface SliderGapDetection {
  gapX: number;
  score: number;
  confidence: number;
  scanY: number;
}

export function estimateSliderDragDistance(input: {
  gapX: number;
  originalWidth: number;
  sliderWidth: number;
  travelWidth: number;
}): number {
  const originalWidth = Number(input.originalWidth);
  const sliderWidth = Number(input.sliderWidth);
  const travelWidth = Number(input.travelWidth);
  const gapX = Number(input.gapX);
  if (!Number.isFinite(originalWidth) || !Number.isFinite(sliderWidth) || !Number.isFinite(travelWidth) || !Number.isFinite(gapX)) return 0;
  if (originalWidth <= 1 || travelWidth <= 0) return 0;
  const movableImageWidth = Math.max(1, originalWidth - Math.max(0, sliderWidth));
  const ratio = clamp(gapX / movableImageWidth, 0, 1);
  return clamp(ratio * travelWidth, 0, travelWidth);
}

export function isCaptchaChallengeError(errorMessage: string): boolean {
  const hasCaptchaKeyword = /(拖动滑块|滑块|验证码|captcha|recaptcha|hcaptcha|turnstile|geetest|verify-content)/i.test(errorMessage);
  if (hasCaptchaKeyword) return true;
  return /intercepts pointer events/i.test(errorMessage) && /(verify|slider|captcha|login|登录)/i.test(errorMessage);
}

export function looksLoggedInBySnapshot(snapshot: DomSnapshot): boolean {
  const hasPasswordInput = snapshot.inputs.some((inp) => inp.type === 'password');
  return !isLoginUrl(snapshot.url) && !hasPasswordInput;
}

export class ExplorationAuthFlow {
  constructor(
    private readonly provider: AuthProvider,
    private readonly sessionManager: HarnessSessionManager,
    private readonly browserAdapter: ExplorationBrowserAdapter,
  ) {}

  async runAiLogin(
    startUrl: string,
    cred: SiteCredentialRow,
    config: ExplorationConfig,
    stepLogger: StepLogger,
    sessionId: string,
    dataRoot: string,
  ): Promise<string | undefined> {
    const pw = this.browserAdapter;
    const MAX_LOGIN_STEPS = 10;
    const MAX_SAME_ACTION_STREAK = 2;
    const loginUrl = cred.login_url ?? startUrl;
    const t0 = Date.now();
    const loginActionId = `login-ai-${String(t0)}`;
    const aiInput = { strategy: 'ai', url: loginUrl };
    const recentLoginActions: string[] = [];
    let lastDecisionSig = '';
    let sameDecisionStreak = 0;

    stepLogger.log({ component: 'ExplorationAgent', action: 'login.start', status: 'pending', detail: `strategy=ai url=${loginUrl}`, toolInput: aiInput, actionId: loginActionId, tool: 'playwright' });

    const loginNavigateActionId = `login-nav-${String(t0)}`;
    try {
      const page = pw.getPage();
      stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', status: 'pending', detail: loginUrl, toolInput: { url: loginUrl }, actionId: loginNavigateActionId, tool: 'playwright' });
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', status: 'ok', detail: loginUrl, durationMs: Date.now() - t0, toolInput: { url: loginUrl }, actionId: loginNavigateActionId, tool: 'playwright' });
    } catch (e) {
      stepLogger.log({ component: 'ExplorationAgent', action: 'navigate', status: 'error', detail: String(e), durationMs: Date.now() - t0, toolInput: { url: loginUrl }, toolOutput: { error: String(e) }, actionId: loginNavigateActionId, tool: 'playwright' });
      stepLogger.log({ component: 'ExplorationAgent', action: 'login.start', status: 'error', detail: String(e), durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { error: String(e) }, actionId: loginActionId, tool: 'playwright' });
      return 'LOGIN_AI_FAILED';
    }

    for (let i = 0; i < MAX_LOGIN_STEPS; i++) {
      const snapshot = await pw.collectDomSnapshot();
      if (looksLoggedInBySnapshot(snapshot) && i > 0) {
        stepLogger.log({ component: 'ExplorationAgent', action: 'login.verify', status: 'ok', detail: 'login indicators cleared in live snapshot', durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { url: snapshot.url, title: snapshot.title }, actionId: loginActionId, tool: 'playwright' });
        return undefined;
      }

      const promptContextSummary = `login url=${snapshot.url} inputs=${String(snapshot.inputs.length)} buttons=${String(snapshot.buttons.length)} forms=${String(snapshot.forms.length)}`;
      const inputFillState = snapshot.inputs.map((input) => `${input.selector}:${input.filled ? 'filled' : 'empty'}`).join(' | ') || 'none';
      const actionHistory = recentLoginActions.join(' | ') || 'none';
      const prompt = renderHarnessTemplate(HARNESS_TEMPLATE_VERSIONS.explorationLogin, {
        currentPage: `${snapshot.url} (title: "${snapshot.title}")`,
        inputs: JSON.stringify(snapshot.inputs.map(({ type, name, placeholder, label, selector, filled }) => ({ type, name, placeholder, label, selector, filled }))),
        inputFillState,
        buttons: JSON.stringify(snapshot.buttons.map(({ text, type, selector }) => ({ text, type, selector }))),
        forms: JSON.stringify(snapshot.forms),
        actionHistory,
        username: cred.username ?? '',
      });

      let raw = '';
      const llmStart = Date.now();
      const llmActionId = `login-llm-${String(i)}-${String(llmStart)}`;
      stepLogger.log({
        component: 'ExplorationAgent',
        action: 'llm.decide',
        status: 'pending',
        detail: `login step ${String(i + 1)}`,
        toolInput: { currentUrl: snapshot.url, inputs: snapshot.inputs.length, buttons: snapshot.buttons.length, forms: snapshot.forms.length },
        actionId: llmActionId,
        promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
        promptContextSummary,
        ...(this.provider.model ? { model: this.provider.model } : {}),
      });
      try {
        raw = await this.provider.complete(prompt, {
          scene: 'explorationLogin',
          systemPrompt: LOGIN_DECIDE_SYSTEM_PROMPT,
          responseFormat: { type: 'json_object' },
          tools: [LOGIN_DECIDE_TOOL],
          toolChoice: 'required',
          temperature: 0,
          maxTokens: 320,
          retry: { maxAttempts: 2, retryOnEmpty: true },
        });
      } catch (e) {
        this.sessionManager.appendPromptSample(sessionId, {
          sessionId,
          stepIndex: i,
          timestamp: new Date().toISOString(),
          phase: 'exploration-login',
          templateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
          prompt,
          response: String(e),
          promptContextSummary,
          sampledBy: 'forced',
        }, dataRoot);
        stepLogger.log({ component: 'ExplorationAgent', action: 'login.failed', status: 'error', detail: `LLM call failed: ${String(e)}`, durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { error: String(e) }, actionId: loginActionId, tool: 'playwright', promptTemplateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin, promptContextSummary });
        return 'LOGIN_AI_FAILED';
      }

      const sampledBy = getPromptSampleReason(i);
      if (sampledBy) {
        this.sessionManager.appendPromptSample(sessionId, {
          sessionId,
          stepIndex: i,
          timestamp: new Date().toISOString(),
          phase: 'exploration-login',
          templateVersion: HARNESS_TEMPLATE_VERSIONS.explorationLogin,
          prompt,
          response: raw,
          promptContextSummary,
          sampledBy,
        }, dataRoot);
      }

      let decision = parseJson<{ isLoginPage?: boolean; action?: string; selector?: string; value?: string; reasoning?: string }>(raw, {});
      const decisionSig = `${decision.action ?? 'unknown'}::${decision.selector ?? ''}::${decision.value ?? ''}`;
      if (decisionSig === lastDecisionSig) sameDecisionStreak++;
      else sameDecisionStreak = 0;
      lastDecisionSig = decisionSig;

      if (sameDecisionStreak >= MAX_SAME_ACTION_STREAK) {
        const passwordInput = snapshot.inputs.find((input) => input.type === 'password');
        if (passwordInput && decision.selector !== passwordInput.selector) {
          decision = { ...decision, action: 'fill', selector: passwordInput.selector, value: '__PASSWORD__', reasoning: decision.reasoning ?? 'fallback: avoid repeated username fill' };
        } else {
          const submit = snapshot.buttons[0];
          if (submit?.selector) decision = { ...decision, action: 'click', selector: submit.selector, reasoning: decision.reasoning ?? 'fallback: avoid repeated fill loop' };
        }
      }

      if (!decision.isLoginPage) return undefined;

      if (decision.action === 'done') {
        const liveSnapshot = await pw.collectDomSnapshot().catch(() => snapshot);
        const stillLooksLikeLogin = isLoginUrl(liveSnapshot.url) || liveSnapshot.inputs.some((inp) => inp.type === 'password');
        if (stillLooksLikeLogin) {
          await pw.getPage().waitForTimeout(600);
          continue;
        }
        return undefined;
      }

      if (decision.action === 'fill' && decision.selector) {
        const isPassword = decision.value === '__PASSWORD__';
        const actualValue = isPassword ? (cred.password ?? '') : (decision.value ?? '');
        try {
          const page = pw.getPage();
          const liveBeforeFill = await pw.collectDomSnapshot().catch(() => snapshot);
          if (looksLoggedInBySnapshot(liveBeforeFill)) return undefined;
          const fillSelectorCount = await page.locator(decision.selector).count().catch(() => 0);
          if (fillSelectorCount === 0) {
            await page.waitForTimeout(300);
            continue;
          }
          await page.fill(decision.selector, actualValue, { timeout: 10_000 });
          pushRecent(recentLoginActions, `fill ${decision.selector} value=${isPassword ? '[REDACTED]' : (decision.value ?? '')}`, 10);
        } catch {
          return 'LOGIN_AI_FAILED';
        }
      } else if (decision.action === 'click' && decision.selector) {
        const clickStart = Date.now();
        try {
          const page = pw.getPage();
          const liveBeforeClick = await pw.collectDomSnapshot().catch(() => snapshot);
          if (looksLoggedInBySnapshot(liveBeforeClick)) return undefined;
          const clickSelectorCount = await page.locator(decision.selector).count().catch(() => 0);
          if (clickSelectorCount === 0) {
            await page.waitForTimeout(300);
            continue;
          }
          const beforeUrl = page.url();
          await page.click(decision.selector, { timeout: 10_000 });
          await Promise.race([
            page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 4_000 }).catch(() => undefined),
            page.waitForTimeout(450),
          ]);
          pushRecent(recentLoginActions, `click ${decision.selector}`, 10);
          const liveAfterClick = await pw.collectDomSnapshot().catch(() => snapshot);
          if (looksLoggedInBySnapshot(liveAfterClick)) return undefined;

          const captchaVisible = await this.hasVisibleSliderCaptcha(page).catch(() => false);
          if (captchaVisible) {
            const captchaResult = await this.handleCaptchaLoginChallenge(pw, decision.selector, stepLogger, loginActionId, config, t0, aiInput);
            if (captchaResult === 'resolved') return undefined;
            if (captchaResult === 'retry') {
              pushRecent(recentLoginActions, 'captcha auto-solved, retry login', 10);
              continue;
            }
            return 'LOGIN_CAPTCHA_REQUIRED';
          }
        } catch (e) {
          const clickError = String(e);
          if (isCaptchaChallengeError(clickError)) {
            const captchaResult = await this.handleCaptchaLoginChallenge(pw, decision.selector, stepLogger, loginActionId, config, t0, aiInput);
            if (captchaResult === 'resolved') return undefined;
            if (captchaResult === 'retry') {
              pushRecent(recentLoginActions, 'captcha auto-solved, retry login', 10);
              continue;
            }
            return 'LOGIN_CAPTCHA_REQUIRED';
          }
          const liveAfterError = await pw.collectDomSnapshot().catch(() => undefined);
          if (liveAfterError && looksLoggedInBySnapshot(liveAfterError)) return undefined;
          stepLogger.log({ component: 'ExplorationAgent', action: 'login.click', status: 'error', detail: clickError, durationMs: Date.now() - clickStart, toolInput: { selector: decision.selector }, toolOutput: { error: clickError }, tool: 'playwright' });
          return 'LOGIN_AI_FAILED';
        }
      }
    }

    stepLogger.log({ component: 'ExplorationAgent', action: 'login.failed', status: 'error', detail: 'exceeded max login steps', durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { maxSteps: 10 }, actionId: loginActionId, tool: 'playwright' });
    return 'LOGIN_AI_STEP_EXCEEDED';
  }

  private async findSliderGeometry(page: ReturnType<ExplorationBrowserAdapter['getPage']>): Promise<SliderGeometry | undefined> {
    await page.waitForTimeout(300);
    for (const handleSelector of SLIDER_HANDLE_SELECTORS) {
      const handle = page.locator(handleSelector).first();
      const handleVisible = await handle.isVisible({ timeout: 800 }).catch(() => false);
      if (!handleVisible) continue;
      const handleBox = await handle.boundingBox();
      if (!handleBox || handleBox.width < 10 || handleBox.height < 10 || handleBox.width > 120 || handleBox.height > 120) continue;
      for (const trackSelector of SLIDER_TRACK_SELECTORS) {
        const track = page.locator(trackSelector).first();
        const trackVisible = await track.isVisible({ timeout: 200 }).catch(() => false);
        if (!trackVisible) continue;
        const box = await track.boundingBox();
        if (!box || box.width <= handleBox.width + 40) continue;
        const startX = handleBox.x + handleBox.width / 2;
        const startY = handleBox.y + handleBox.height / 2;
        const travelWidth = Math.max(24, Math.min(box.x + box.width - Math.max(6, handleBox.width / 2), startX + Math.max(24, box.width - Math.max(12, handleBox.width) - 8)) - startX);
        return { handleBox, startX, startY, travelWidth };
      }
    }
    return undefined;
  }

  private async dragWithDistance(page: ReturnType<ExplorationBrowserAdapter['getPage']>, geometry: SliderGeometry, distance: number, effectiveTimeMs: number): Promise<void> {
    const clampedDistance = clamp(distance, 20, geometry.travelWidth);
    const totalMs = clamp(effectiveTimeMs + 140 + Math.floor(Math.random() * 220), 320, 2_400);
    const steps = Math.max(20, Math.min(90, Math.round(totalMs / 18)));
    const avgDelay = totalMs / steps;
    await page.mouse.move(geometry.startX, geometry.startY, { steps: 4 });
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const accel = progress < 0.78 ? 1 - Math.pow(1 - progress, 2.15) : 0.94 + (progress - 0.78) * 0.28;
      const x = geometry.startX + clampedDistance * Math.min(1, accel);
      const wobble = Math.sin(progress * Math.PI * 1.6) * 0.8 + (Math.random() - 0.5) * 0.45;
      await page.mouse.move(x, geometry.startY + wobble, { steps: 1 });
      await page.waitForTimeout(Math.max(4, Math.round(avgDelay + (Math.random() - 0.5) * 5)));
    }
    await page.waitForTimeout(50 + Math.floor(Math.random() * 70));
    await page.mouse.up();
  }

  private async detectSliderGapX(page: ReturnType<ExplorationBrowserAdapter['getPage']>, challenge: Awaited<ReturnType<ExplorationBrowserAdapter['getLatestVerificationChallenge']>> extends infer T ? NonNullable<T> : never): Promise<SliderGapDetection | undefined> {
    return page.evaluate(async (payload) => {
      const g = globalThis as unknown as {
        document: {
          createElement: (name: string) => {
            width: number;
            height: number;
            getContext: (kind: string) => {
              drawImage: (...args: unknown[]) => void;
              getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
            } | null;
          };
        };
        Image: new () => {
          src: string;
          crossOrigin?: string;
          naturalWidth?: number;
          naturalHeight?: number;
          width?: number;
          height?: number;
          decode?: () => Promise<void>;
          onload?: () => void;
          onerror?: () => void;
        };
      };
      const normalizeImageSrc = (raw: string): string => {
        if (!raw) return raw;
        if (raw.startsWith('data:image/')) return raw;
        if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw;
        const compact = raw.replace(/\s+/g, '');
        if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 128) return `data:image/png;base64,${compact}`;
        return raw;
      };
      const waitImageLoad = (image: {
        complete?: boolean;
        naturalWidth?: number;
        onload?: () => void;
        onerror?: () => void;
      }): Promise<void> => new Promise((resolve, reject) => {
        if (image.complete && Number(image.naturalWidth ?? 0) > 0) {
          resolve();
          return;
        }
        const done = (): void => { resolve(); };
        const failed = (): void => { reject(new Error('image load failed')); };
        image.onload = done;
        image.onerror = failed;
      });
      const loadImage = async (src: string): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> => {
        const normalizedSrc = normalizeImageSrc(src);
        if (!normalizedSrc) return null;
        const image = new g.Image();
        image.crossOrigin = 'anonymous';
        image.src = normalizedSrc;
        try {
          if (typeof image.decode === 'function') {
            await image.decode();
          } else {
            await waitImageLoad(image);
          }
        } catch {
          try {
            await waitImageLoad(image);
          } catch {
            return null;
          }
        }
        const width = Number(image.naturalWidth ?? image.width ?? 0);
        const height = Number(image.naturalHeight ?? image.height ?? 0);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
        const canvas = g.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        try {
          ctx.drawImage(image as unknown as object, 0, 0, width, height);
          return { width, height, data: ctx.getImageData(0, 0, width, height).data };
        } catch {
          return null;
        }
      };
      const back = await loadImage(payload.backImage);
      const slider = await loadImage(payload.slidingImage);
      if (!back || !slider || back.width < 60 || back.height < 30 || slider.width < 12 || slider.height < 12) return undefined;
      const alphaThreshold = 28;
      const contourPoints: Array<{ x: number; y: number }> = [];
      for (let y = 1; y < slider.height - 1; y++) {
        for (let x = 1; x < slider.width - 1; x++) {
          const idx = (y * slider.width + x) * 4 + 3;
          const alpha = slider.data[idx] ?? 0;
          if (alpha < alphaThreshold) continue;
          const left = slider.data[(y * slider.width + (x - 1)) * 4 + 3] ?? 0;
          const right = slider.data[(y * slider.width + (x + 1)) * 4 + 3] ?? 0;
          const up = slider.data[((y - 1) * slider.width + x) * 4 + 3] ?? 0;
          const down = slider.data[((y + 1) * slider.width + x) * 4 + 3] ?? 0;
          if (left < alphaThreshold || right < alphaThreshold || up < alphaThreshold || down < alphaThreshold) {
            if (((x + y) & 1) === 0) contourPoints.push({ x, y });
          }
        }
      }
      if (contourPoints.length < 30) return undefined;
      const gray = new Float32Array(back.width * back.height);
      for (let y = 0; y < back.height; y++) {
        for (let x = 0; x < back.width; x++) {
          const idx = (y * back.width + x) * 4;
          const r = back.data[idx] ?? 0;
          const gch = back.data[idx + 1] ?? 0;
          const b = back.data[idx + 2] ?? 0;
          gray[y * back.width + x] = 0.299 * r + 0.587 * gch + 0.114 * b;
        }
      }
      const edge = new Float32Array(back.width * back.height);
      for (let y = 1; y < back.height - 1; y++) {
        for (let x = 1; x < back.width - 1; x++) {
          const idx = y * back.width + x;
          const gx =
            -(gray[idx - back.width - 1] ?? 0) - 2 * (gray[idx - 1] ?? 0) - (gray[idx + back.width - 1] ?? 0) +
            (gray[idx - back.width + 1] ?? 0) + 2 * (gray[idx + 1] ?? 0) + (gray[idx + back.width + 1] ?? 0);
          const gy =
            (gray[idx - back.width - 1] ?? 0) + 2 * (gray[idx - back.width] ?? 0) + (gray[idx - back.width + 1] ?? 0) -
            (gray[idx + back.width - 1] ?? 0) - 2 * (gray[idx + back.width] ?? 0) - (gray[idx + back.width + 1] ?? 0);
          edge[idx] = Math.abs(gx) + Math.abs(gy);
        }
      }
      const maxX = back.width - slider.width;
      if (maxX < 0) return undefined;
      const randomY = Number(payload.randomY);
      const preferredY = Number.isFinite(randomY) ? Math.round(randomY) : 0;
      let minY = Math.max(0, preferredY - 10);
      let maxY = Math.min(back.height - slider.height, preferredY + 10);
      if (minY > maxY) {
        minY = 0;
        maxY = Math.max(0, back.height - slider.height);
      }
      let bestX = -1;
      let bestY = minY;
      let bestScore = Number.NEGATIVE_INFINITY;
      let secondBest = Number.NEGATIVE_INFINITY;
      for (let y = minY; y <= maxY; y++) {
        for (let x = 0; x <= maxX; x++) {
          let score = 0;
          for (const point of contourPoints) {
            score += edge[(y + point.y) * back.width + (x + point.x)] ?? 0;
          }
          const normalized = score / contourPoints.length;
          if (normalized > bestScore) {
            secondBest = bestScore;
            bestScore = normalized;
            bestX = x;
            bestY = y;
          } else if (normalized > secondBest) {
            secondBest = normalized;
          }
        }
      }
      if (bestX < 0 || !Number.isFinite(bestScore)) return undefined;
      if (bestScore < 40) return undefined;
      const confidence = bestScore / Math.max(1, secondBest);
      if (!Number.isFinite(confidence) || confidence < 1.01) return undefined;
      return { gapX: bestX, score: bestScore, confidence, scanY: bestY };
    }, { backImage: challenge.backImage, slidingImage: challenge.slidingImage, randomY: challenge.randomY });
  }

  private async dragSliderPrecisely(page: ReturnType<ExplorationBrowserAdapter['getPage']>, pw: ExplorationBrowserAdapter): Promise<boolean> {
    const challenge = await pw.getLatestVerificationChallenge(1_600);
    if (!challenge) return false;
    const geometry = await this.findSliderGeometry(page);
    if (!geometry) return false;
    const detection = await this.detectSliderGapX(page, challenge).catch(() => undefined);
    if (!detection) return false;
    const targetDistance = clamp(
      estimateSliderDragDistance({
        gapX: detection.gapX,
        originalWidth: challenge.originalWidth,
        sliderWidth: challenge.sliderWidth,
        travelWidth: geometry.travelWidth,
      }) + Math.max(1, Math.min(6, geometry.handleBox.width * 0.08)),
      20,
      geometry.travelWidth,
    );
    await this.dragWithDistance(page, geometry, targetDistance, challenge.effectiveTime);
    return true;
  }

  private async dragSliderOnce(page: ReturnType<ExplorationBrowserAdapter['getPage']>): Promise<boolean> {
    const geometry = await this.findSliderGeometry(page);
    if (geometry) {
      await this.dragWithDistance(page, geometry, Math.max(36, geometry.travelWidth - 3), 760);
      return true;
    }
    return false;
  }

  private async hasVisibleSliderCaptcha(page: ReturnType<ExplorationBrowserAdapter['getPage']>): Promise<boolean> {
    for (const selector of [...SLIDER_HANDLE_SELECTORS, ...SLIDER_TRACK_SELECTORS]) {
      const visible = await page.locator(selector).first().isVisible({ timeout: 200 }).catch(() => false);
      if (visible) return true;
    }
    return page.getByText(/拖动滑块|滑块|验证码|captcha|geetest|verify/i).first().isVisible({ timeout: 250 }).catch(() => false);
  }

  private async tryAutoSolveSliderCaptcha(pw: ExplorationBrowserAdapter, submitSelector: string, config?: ExplorationConfig): Promise<'resolved' | 'retry' | 'failed'> {
    if (!isAutoSliderEnabled(config)) return 'failed';
    const page = pw.getPage();
    const attempts = getAutoSliderAttempts(config);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let dragged = await this.dragSliderPrecisely(page, pw).catch(() => false);
      if (!dragged) dragged = await this.dragSliderOnce(page).catch(() => false);
      if (!dragged) continue;
      await page.waitForTimeout(600);
      const blockingPromptVisible = await page.getByText(/拖动滑块解锁|请按住滑块|drag the slider|slide to verify/i).first().isVisible({ timeout: 250 }).catch(() => false);
      if (blockingPromptVisible) continue;
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12_000 }).catch(() => undefined),
          page.click(submitSelector, { timeout: 8_000 }),
        ]);
      } catch (e) {
        if (isCaptchaChallengeError(String(e))) continue;
      }
      const snapshot = await pw.collectDomSnapshot().catch(() => undefined);
      const hasPasswordInput = snapshot?.inputs.some(inp => inp.type === 'password') ?? true;
      if (!hasPasswordInput || (snapshot && !isLoginUrl(snapshot.url))) return 'resolved';
      return 'retry';
    }
    return 'failed';
  }

  private async handleCaptchaLoginChallenge(
    pw: ExplorationBrowserAdapter,
    submitSelector: string,
    stepLogger: StepLogger,
    loginActionId: string,
    config: ExplorationConfig,
    t0: number,
    aiInput: { strategy: string; url: string },
  ): Promise<'resolved' | 'retry' | 'failed'> {
    const autoResult = await this.tryAutoSolveSliderCaptcha(pw, submitSelector, config);
    if (autoResult === 'resolved') {
      stepLogger.log({ component: 'ExplorationAgent', action: 'login.verify', status: 'ok', detail: 'auto slider login completed', durationMs: Date.now() - t0, toolInput: aiInput, toolOutput: { mode: 'auto-slider' }, actionId: loginActionId, tool: 'playwright' });
      return 'resolved';
    }
    if (autoResult === 'retry') return 'retry';
    if (pw.isHeaded() && isManualLoginEnabled(config)) {
      const manualOk = await this.waitForManualLoginCompletion(pw, getManualLoginTimeoutMs(config));
      if (manualOk) return 'resolved';
    }
    return 'failed';
  }

  private async waitForManualLoginCompletion(pw: ExplorationBrowserAdapter, timeoutMs: number): Promise<boolean> {
    const page = pw.getPage();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await pw.collectDomSnapshot().catch(() => undefined);
      if (snapshot && (looksLoggedInBySnapshot(snapshot) || !isLoginUrl(snapshot.url))) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  }
}

function getPromptSampleReason(stepIndex: number, force = false): 'first-step' | 'interval' | 'forced' | null {
  if (force) return 'forced';
  if (stepIndex === 0) return 'first-step';
  if (stepIndex > 0) return 'interval';
  return null;
}

function pushRecent(list: string[], value: string, limit = 8): void {
  list.push(value);
  while (list.length > limit) list.shift();
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const match = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(raw);
    return match ? JSON.parse(match[0]) as T : fallback;
  } catch {
    return fallback;
  }
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function isManualLoginEnabled(config?: ExplorationConfig): boolean {
  if (config?.manualInterventionOnCaptcha !== undefined) return config.manualInterventionOnCaptcha;
  return parseBooleanFlag(process.env['ZARB_MANUAL_LOGIN']) ?? true;
}

function getManualLoginTimeoutMs(config?: ExplorationConfig): number {
  if (config?.manualLoginTimeoutMs !== undefined) {
    const configured = Number(config.manualLoginTimeoutMs);
    if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  }
  const raw = process.env['ZARB_MANUAL_LOGIN_TIMEOUT_MS'];
  const parsed = raw ? Number(raw) : 180_000;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 180_000;
}

function isAutoSliderEnabled(config?: ExplorationConfig): boolean {
  if (config?.captchaAutoSolve !== undefined) return config.captchaAutoSolve;
  return parseBooleanFlag(process.env['ZARB_SLIDER_AUTO']) ?? true;
}

function getAutoSliderAttempts(config?: ExplorationConfig): number {
  if (config?.captchaAutoSolveAttempts !== undefined) {
    const configured = Number(config.captchaAutoSolveAttempts);
    if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.min(3, Math.floor(configured)));
  }
  const raw = process.env['ZARB_SLIDER_AUTO_ATTEMPTS'];
  const parsed = raw ? Number(raw) : 2;
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.min(3, Math.floor(parsed))) : 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
