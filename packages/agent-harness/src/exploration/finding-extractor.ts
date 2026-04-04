import { randomUUID } from 'node:crypto';
import type { ExplorationConfig } from '@zarb/shared-types';
import type { SaveFindingInput } from '@zarb/storage';
import type { PageProbe } from './types.js';

export class ExplorationFindingExtractor {
  extract(runId: string, page: PageProbe, config: ExplorationConfig): SaveFindingInput[] {
    const results: SaveFindingInput[] = [];
    const now = new Date().toISOString();
    const focusAreas = config.focusAreas ?? ['console-errors', 'network-errors'];

    if (focusAreas.includes('console-errors')) {
      for (const err of page.consoleErrors.slice(0, 5)) {
        results.push({
          id: randomUUID(),
          runId,
          category: 'console-error',
          severity: 'medium',
          pageUrl: page.url,
          title: 'Console error',
          summary: err,
          createdAt: now,
        });
      }
    }

    if (focusAreas.includes('network-errors')) {
      for (const req of page.networkErrors.slice(0, 5)) {
        results.push({
          id: randomUUID(),
          runId,
          category: 'network-error',
          severity: req.status >= 500 ? 'high' : 'medium',
          pageUrl: page.url,
          title: `HTTP ${String(req.status)}`,
          summary: `${req.url} returned ${String(req.status)}`,
          createdAt: now,
        });
      }
    }

    return results;
  }

  buildDedupeKey(finding: Pick<SaveFindingInput, 'category' | 'severity' | 'pageUrl' | 'summary'>): string {
    return `${finding.category}:${finding.severity}:${finding.pageUrl ?? ''}:${finding.summary}`;
  }
}
