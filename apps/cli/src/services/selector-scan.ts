/**
 * Scans a local repo for Playwright test selectors and upserts them into the cache.
 *
 * Extracts:
 *   suite     — describe('name', ...) blocks
 *   scenario  — // @zarb-scenario-id: value  annotations
 *   testcase  — // @zarb-testcase-id: value  annotations
 *   tag       — test.tag('value') or @tag:value annotations
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { SelectorCacheRepository, SelectorType } from '@zarb/storage';

const DESCRIBE_RE = /describe\s*\(\s*['"`]([^'"`]+)['"`]/g;
const SCENARIO_RE = /\/\/\s*@zarb-scenario-id:\s*(\S+)/g;
const TESTCASE_RE = /\/\/\s*@zarb-testcase-id:\s*(\S+)/g;
const TAG_INLINE_RE = /test\.tag\s*\(\s*['"`]([^'"`]+)['"`]/g;
const TAG_ANNOT_RE = /\/\/\s*@tag:\s*(\S+)/g;

function* walkSpec(dir: string): Generator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory() && entry !== 'node_modules') yield* walkSpec(full);
      else if (stat.isFile() && (extname(entry) === '.ts' || extname(entry) === '.js') && entry.includes('.spec')) yield full;
    } catch { /* skip unreadable */ }
  }
}

function extractAll(content: string, re: RegExp): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) results.push(m[1]);
  }
  return results;
}

export function scanAndCache(
  repoPath: string,
  siteId: string,
  repoId: string,
  cache: SelectorCacheRepository,
): { scanned: number; upserted: number } {
  let scanned = 0;
  let upserted = 0;

  for (const file of walkSpec(repoPath)) {
    scanned++;
    let content: string;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }

    const pairs: Array<[SelectorType, string]> = [
      ...extractAll(content, DESCRIBE_RE).map(v => ['suite', v] as [SelectorType, string]),
      ...extractAll(content, SCENARIO_RE).map(v => ['scenario', v] as [SelectorType, string]),
      ...extractAll(content, TESTCASE_RE).map(v => ['testcase', v] as [SelectorType, string]),
      ...extractAll(content, TAG_INLINE_RE).map(v => ['tag', v] as [SelectorType, string]),
      ...extractAll(content, TAG_ANNOT_RE).map(v => ['tag', v] as [SelectorType, string]),
    ];

    for (const [type, value] of pairs) {
      cache.upsert(siteId, repoId, type, value, 'scan');
      upserted++;
    }
  }

  return { scanned, upserted };
}
