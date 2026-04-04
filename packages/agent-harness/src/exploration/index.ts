export { ExplorationAgent } from '../exploration-agent.js';
export type { AIProvider as ExplorationAIProvider } from '../exploration-agent.js';
export type {
  PageProbe,
  ExplorationStep,
  ExplorationResult,
  ExplorationBrainPhase,
  ExplorationBrainPlan,
  ExplorationPromptContext,
  ExplorationPlanPromptContext,
} from './types.js';

export {
  HARNESS_TEMPLATE_VERSIONS,
  loadHarnessTemplate,
  renderHarnessTemplate,
  resetHarnessPromptsDir,
  setHarnessPromptsDir,
} from '../prompt-loader.js';

export { PlaywrightToolProvider } from '../playwright-tool-provider.js';
export type { PlaywrightToolProviderOptions } from '../playwright-tool-provider.js';
export {
  PlaywrightExplorationBrowserAdapter,
} from './browser-adapter.js';
export type { ExplorationBrowserAdapter } from './browser-adapter.js';
export {
  buildExplorationDecisionPrompt,
  buildExplorationPlanPrompt,
  summarizePromptContext,
} from './prompt-builder.js';
export { ExplorationFindingExtractor } from './finding-extractor.js';
export { ExplorationBrain, resolveAuthGateMode } from './brain.js';
export {
  ExplorationAuthFlow,
  estimateSliderDragDistance,
  isCaptchaChallengeError,
  looksLoggedInBySnapshot,
} from './auth-flow.js';
