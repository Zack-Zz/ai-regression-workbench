import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, usePoll } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, RunStatusBadge, TaskStatusBadge, Card, Button } from '../components/ui.js';
import { QuickRunPanel } from '../components/QuickRunPanel.js';
import type { RunSummary } from '../types.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function HomePage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.listRuns('limit=5'), []);
  const { data: pendingTasks } = useAsync(() => api.listCodeTasks('status=PENDING_APPROVAL&limit=10'), []);
  const hasActive = data?.items.some(r => !TERMINAL.has(r.status)) ?? false;
  usePoll(reload, 5000, hasActive);

  return (
    <div>
      <Card title={t('run.start')}>
        <QuickRunPanel />
      </Card>
      {pendingTasks && pendingTasks.items.length > 0 && (
        <Card title={`待审批任务 (${String(pendingTasks.items.length)})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {pendingTasks.items.map(task => (
              <div key={task.taskId} onClick={() => { navigate(`/code-tasks/${task.taskId}`); }}
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem', border: '1px solid #ffc107', borderRadius: 4, cursor: 'pointer', background: '#fffbf0' }}>
                <TaskStatusBadge status={task.status} />
                <span style={{ fontSize: '0.85em', flex: 1 }}>{task.goal}</span>
                <span style={{ fontSize: '0.8em', color: '#888', fontFamily: 'monospace' }}>{task.taskId}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title={t('nav.runs')}>
        {loading && <Loading />}
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {data.items.map(r => <RunRow key={r.runId} run={r} onClick={() => { navigate(`/runs/${r.runId}`); }} />)}
            {data.items.length === 0 && <span style={{ color: '#888', fontSize: '0.9em' }}>暂无运行记录</span>}
            <Button onClick={() => { navigate('/runs'); }}>{t('nav.runs')} →</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function RunRow({ run, onClick }: { run: RunSummary; onClick: () => void }): React.ReactElement {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem', border: '1px solid #eee', borderRadius: 4, cursor: 'pointer' }}>
      <RunStatusBadge status={run.status} />
      <span style={{ fontSize: '0.85em', color: '#555' }}>{run.runMode}</span>
      <span style={{ fontSize: '0.85em', flex: 1 }}>{run.scopeType}{run.scopeValue ? `: ${run.scopeValue}` : ''}</span>
      <span style={{ fontSize: '0.8em', color: '#888' }}>{run.startedAt.slice(0, 16).replace('T', ' ')}</span>
      <span style={{ fontSize: '0.85em' }}>✓{run.passed} ✗{run.failed}</span>
    </div>
  );
}
