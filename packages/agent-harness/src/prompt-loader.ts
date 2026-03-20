import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_PROMPTS_DIR = join(new URL('.', import.meta.url).pathname, '..', 'prompts');

let promptsDir = DEFAULT_PROMPTS_DIR;

export function setHarnessPromptsDir(dir: string): void {
  promptsDir = dir;
}

export function resetHarnessPromptsDir(): void {
  promptsDir = DEFAULT_PROMPTS_DIR;
}

export function loadHarnessTemplate(key: string): string {
  const atIdx = key.lastIndexOf('@');
  if (atIdx === -1) throw new Error(`Invalid template key (missing @version): ${key}`);
  const name = key.slice(0, atIdx);
  const version = key.slice(atIdx + 1);
  const slashIdx = name.lastIndexOf('/');
  const category = slashIdx !== -1 ? name.slice(0, slashIdx) : name;
  const basename = slashIdx !== -1 ? name.slice(slashIdx + 1) : name;
  const filePath = join(promptsDir, category, `${basename}@${version}.txt`);
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`Harness prompt template not found: ${key} (looked at ${filePath})`);
  }
}

export function renderHarnessTemplate(key: string, vars: Record<string, string>): string {
  let tpl = loadHarnessTemplate(key);
  for (const [k, v] of Object.entries(vars)) {
    tpl = tpl.replaceAll(`{{${k}}}`, v);
  }
  return tpl;
}

export const HARNESS_TEMPLATE_VERSIONS = {
  explorationPlan: 'exploration-plan/default@v1',
  explorationDecision: 'exploration-decision/default@v1',
  explorationLogin: 'exploration-login/default@v1',
} as const;
