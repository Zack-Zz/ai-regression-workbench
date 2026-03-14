import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PromptLoader — loads versioned prompt templates from the `prompts/` directory.
 * Templates are stored as `prompts/<name>/<version>.txt`.
 * Derived from ai-engine-design.md §5.1.
 */

// Default prompts directory: sibling of this file's package root
const DEFAULT_PROMPTS_DIR = join(new URL('.', import.meta.url).pathname, '..', 'prompts');

let promptsDir = DEFAULT_PROMPTS_DIR;

/** Override the prompts directory (useful for tests). */
export function setPromptsDir(dir: string): void {
  promptsDir = dir;
}

/** Reset to the default prompts directory. */
export function resetPromptsDir(): void {
  promptsDir = DEFAULT_PROMPTS_DIR;
}

/**
 * Load a template by key (`<name>@<version>`).
 * Reads from `<promptsDir>/<name>/<version>.txt`.
 */
export function loadTemplate(key: string): string {
  const atIdx = key.lastIndexOf('@');
  if (atIdx === -1) throw new Error(`Invalid template key (missing @version): ${key}`);
  const name = key.slice(0, atIdx);          // e.g. "failure-analysis/default"
  const version = key.slice(atIdx + 1);      // e.g. "v1"
  // name may contain a slash: split into category/basename
  const slashIdx = name.lastIndexOf('/');
  const category = slashIdx !== -1 ? name.slice(0, slashIdx) : name;
  const basename = slashIdx !== -1 ? name.slice(slashIdx + 1) : name;
  const filePath = join(promptsDir, category, `${basename}@${version}.txt`);
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`Prompt template not found: ${key} (looked at ${filePath})`);
  }
}

export function renderTemplate(key: string, vars: Record<string, string>): string {
  let tpl = loadTemplate(key);
  for (const [k, v] of Object.entries(vars)) {
    tpl = tpl.replaceAll(`{{${k}}}`, v);
  }
  return tpl;
}

export const TEMPLATE_VERSIONS = {
  failureAnalysis: 'failure-analysis/default@v1',
  codeTaskDraft: 'code-task-draft/default@v1',
  testDraft: 'test-draft/default@v1',
  findingSummary: 'finding-summary/default@v1',
} as const;
