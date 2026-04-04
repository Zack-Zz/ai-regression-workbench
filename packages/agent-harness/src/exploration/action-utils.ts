import type { ExplorationStep } from './types.js';

export function normalizeUrlForDecision(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function escapeSelectorText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function normalizeActionSelector(action: ExplorationStep['action'], selector: string): string {
  if (action !== 'click') return selector;
  if (selector.startsWith('link:')) {
    const text = selector.slice('link:'.length).trim();
    if (text) return `a:has-text("${escapeSelectorText(text)}")`;
  }
  if (selector.startsWith('button:')) {
    const text = selector.slice('button:'.length).trim();
    if (text) return `button:has-text("${escapeSelectorText(text)}")`;
  }
  return selector;
}
