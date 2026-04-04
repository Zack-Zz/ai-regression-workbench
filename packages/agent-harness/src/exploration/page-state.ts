import type { StepRecord } from '@zarb/logger';
import type { PageProbe } from './types.js';

export function buildPageSnapshot(pageState: PageProbe): NonNullable<StepRecord['pageState']> {
  return {
    url: pageState.url,
    title: pageState.title,
    formCount: pageState.formCount,
    linkCount: pageState.linkCount,
    consoleErrors: pageState.consoleErrors.length,
    networkErrors: pageState.networkErrors.length,
    ...(pageState.domSummary?.headings ? { headings: pageState.domSummary.headings } : {}),
    ...(pageState.domSummary?.primaryButtons ? { primaryButtons: pageState.domSummary.primaryButtons } : {}),
    ...(pageState.domSummary?.navLinks ? { navLinks: pageState.domSummary.navLinks } : {}),
    ...(pageState.domSummary?.ctaCandidates ? { ctaCandidates: pageState.domSummary.ctaCandidates } : {}),
    ...(pageState.domSummary?.inputHints ? { inputHints: pageState.domSummary.inputHints } : {}),
    ...(pageState.domSummary?.textSnippet ? { textSnippet: pageState.domSummary.textSnippet } : {}),
  };
}
