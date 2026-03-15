/**
 * Phase 10 — Preview drift smoke checks.
 * Verifies that docs/ui-preview HTML files contain key domain terms
 * that must stay aligned with the API contract and UI implementation.
 * If a term disappears from preview, it signals potential drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PREVIEW_DIR = join(new URL('.', import.meta.url).pathname, '../../../docs/ui-preview');

function readPreview(file: string): string {
  return readFileSync(join(PREVIEW_DIR, file), 'utf8');
}

describe('Preview drift: ui-preview HTML aligns with API contract', () => {
  it('all expected preview pages exist', () => {
    const files = readdirSync(PREVIEW_DIR).filter(f => f.endsWith('.html'));
    for (const page of ['index.html', 'run-list.html', 'run-detail.html', 'code-task-detail.html', 'settings.html', 'failure-report.html']) {
      expect(files).toContain(page);
    }
  });

  it('run-list preview contains run status terms from API contract', () => {
    const html = readPreview('run-list.html');
    // API contract defines these run statuses
    expect(html).toContain('COMPLETED');
    expect(html).toContain('regression');
    expect(html).toContain('exploration');
  });

  it('run-detail preview contains stage and findings terms', () => {
    const html = readPreview('run-detail.html');
    // RunDetail must expose findings and stage results
    expect(html).toContain('findings');
    expect(html.toLowerCase()).toContain('stage');
  });

  it('code-task-detail preview contains lifecycle status terms', () => {
    const html = readPreview('code-task-detail.html');
    // CodeTask lifecycle: PENDING_APPROVAL → APPROVED → ... → COMMIT_PENDING
    expect(html).toContain('PENDING_APPROVAL');
    expect(html).toContain('APPROVED');
  });

  it('settings preview contains key config section terms', () => {
    const html = readPreview('settings.html');
    // SettingsPage must show Storage, Workspace, Report sections
    expect(html).toContain('Storage');
    expect(html).toContain('Workspace');
    expect(html).toContain('Report');
  });

  it('failure-report preview contains correlation and artifact terms', () => {
    const html = readPreview('failure-report.html');
    // FailureReport must expose correlation context and artifacts
    expect(html.toLowerCase()).toMatch(/correlation|trace|artifact/);
  });
});
