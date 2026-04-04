import type { ExplorationConfig } from '@zarb/shared-types';
import type { ApproxBudgetSnapshot } from '../runtime/budget.js';
import type { DomSnapshot } from '../playwright-tool-provider.js';

export type ExplorationBrainPhase = 'bootstrap' | 'post-login' | 'explore' | 'recover';

export interface ExplorationBrainPlan {
  phase: ExplorationBrainPhase;
  objective: string;
  reasoning: string;
  requiresLogin: boolean;
  loginReason: string;
  candidateUrls: string[];
  avoidUrls: string[];
  preferredActions: Array<'click' | 'fill' | 'navigate' | 'done'>;
}

export interface PageProbe {
  url: string;
  title: string;
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status: number }>;
  formCount: number;
  linkCount: number;
  domSummary?: {
    headings: string[];
    primaryButtons: string[];
    navLinks: string[];
    inputHints: string[];
    ctaCandidates?: string[];
    textSnippet?: string;
    noScriptWarningVisible?: boolean;
  };
  screenshot?: string;
}

export interface ExplorationStep {
  stepIndex: number;
  action: 'navigate' | 'click' | 'fill' | 'done';
  targetUrl?: string | undefined;
  selector?: string | undefined;
  value?: string | undefined;
  reasoning: string;
  llmError?: string;
}

export type ExplorationBudgetSnapshot = ApproxBudgetSnapshot;

export interface ExplorationResult {
  findingCount: number;
  stepsExecuted: number;
  pagesVisited: number;
  budget?: ExplorationBudgetSnapshot;
  llmError?: string;
}

export interface ExplorationPromptContext {
  page: PageProbe;
  config: ExplorationConfig;
  stepIndex: number;
  visited: string[];
  recentSteps: string[];
  recentFindings: string[];
  recentToolResults: string[];
  recentNetworkHighlights: string[];
  supportedActions: string;
  remainingSteps: number;
  remainingPages: number;
  compactCarryover?: string;
  brainPlan?: ExplorationBrainPlan;
  domSnapshot?: DomSnapshot;
}

export interface ExplorationPlanPromptContext {
  page: PageProbe;
  config: ExplorationConfig;
  visited: string[];
  stepIndex: number;
  remainingSteps: number;
  remainingPages: number;
  recentSteps: string[];
  recentFindings: string[];
  recentToolResults: string[];
  recentNetworkHighlights: string[];
  authEstablished: boolean;
  compactCarryover?: string;
}
