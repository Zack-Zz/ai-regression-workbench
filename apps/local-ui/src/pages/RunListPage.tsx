import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, RunStatusBadge, Button, Table } from '../components/ui.js';
import type { RunSummary } from '../types.js';
import { fmtDatetime } from '../utils.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function RunListPage(): React.ReactElement {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const qs = [statusFilter && `status=${statusFilter}`, modeFilter && `runMode=${modeFilter}`].filter(Boolean).join('&');
  const { data, loading, error, reload } = useAsync(() => api.listRuns(qs || undefined), [qs]);
  useServerEvents(['run.created', 'run.updated'], () => reload());

  const rows: React.ReactNode[][] = (data?.items ?? []).map((r: RunSummary) => [
    <RunStatusBadge key="s" status={r.status} />,
    r.runMode,
    `${r.scopeType ?? ''}${r.scopeValue ? `:${r.scopeValue}` : ''}`,
    r.projectName ?? r.projectId?.slice(0, 8) ?? '—',
    r.siteName ?? r.siteId?.slice(0, 8) ?? '—',
    `✓${String(r.passed)} ✗${String(r.failed)} ↷${String(r.skipped)}`,
    fmtDatetime(r.startedAt),
    <Button key="v" onClick={() => { navigate(`/runs/${r.runId}`); }}>查看</Button>,
  ]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{t('nav.runs')}</h2>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }} style={{ padding: '4px 8px' }}>
          <option value="">全部状态</option>
          {['CREATED','RUNNING_TESTS','COMPLETED','FAILED','CANCELLED','PAUSED'].map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
        <select value={modeFilter} onChange={e => { setModeFilter(e.target.value); }} style={{ padding: '4px 8px' }}>
          <option value="">全部模式</option>
          <option value="regression">regression</option>
          <option value="exploration">exploration</option>
          <option value="hybrid">hybrid</option>
        </select>
        <Button onClick={reload}>{t('common.retry')}</Button>
      </div>
      {loading && <Loading />}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {data && <Table headers={[t('common.status'), t('run.mode'), t('run.scope'), '项目', '站点', '统计', t('run.startedAt'), t('common.actions')]} rows={rows} />}
    </div>
  );
}
