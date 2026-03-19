import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, RunStatusBadge, TaskStatusBadge, Card, Button } from '../components/ui.js';
import { QuickRunPanel } from '../components/QuickRunPanel.js';
import type { CodeTaskSummary, RunSummary } from '../types.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function HomePage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.listRuns('limit=5'), []);
  const { data: pendingTasks } = useAsync(() => api.listCodeTasks('status=PENDING_APPROVAL&limit=10'), []);
  const { data: reviewTasks } = useAsync(() => api.listCodeTasks('status=SUCCEEDED&limit=10'), []);
  const { data: commitTasks } = useAsync(() => api.listCodeTasks('status=COMMIT_PENDING&limit=10'), []);
  const { data: projects } = useAsync(() => api.listProjects(), []);
  useServerEvents(['run.created', 'run.updated'], () => reload());

  return (
    <div>
      <Card title={t('run.start')}>
        <QuickRunPanel />
      </Card>
      <Card title="工作台概览">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
          <SummaryStat label="项目数" value={String(projects?.length ?? 0)} />
          <SummaryStat label="待批准" value={String(pendingTasks?.items.length ?? 0)} />
          <SummaryStat label="待审查" value={String(reviewTasks?.items.length ?? 0)} />
          <SummaryStat label="待提交" value={String(commitTasks?.items.length ?? 0)} />
        </div>
      </Card>
      <Card title="待处理动作">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <ActionSection
            title="待批准"
            items={pendingTasks?.items ?? []}
            emptyText="当前没有待批准的代码任务"
            onOpen={(taskId) => { navigate(`/code-tasks/${taskId}`); }}
          />
          <ActionSection
            title="待审查"
            items={reviewTasks?.items ?? []}
            emptyText="当前没有待审查的代码任务"
            onOpen={(taskId) => { navigate(`/code-tasks/${taskId}`); }}
          />
          <ActionSection
            title="待提交"
            items={commitTasks?.items ?? []}
            emptyText="当前没有待提交的代码任务"
            onOpen={(taskId) => { navigate(`/code-tasks/${taskId}`); }}
          />
        </div>
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

function SummaryStat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.75rem', background: '#fafafa' }}>
      <div style={{ fontSize: '0.8em', color: '#666' }}>{label}</div>
      <div style={{ fontSize: '1.4em', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function ActionSection({ title, items, emptyText, onOpen }: {
  title: string;
  items: CodeTaskSummary[];
  emptyText: string;
  onOpen: (taskId: string) => void;
}): React.ReactElement {
  return (
    <div>
      <div style={{ fontSize: '0.9em', fontWeight: 700, marginBottom: '0.5rem' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {items.length === 0 && <span style={{ color: '#888', fontSize: '0.9em' }}>{emptyText}</span>}
        {items.map(task => (
          <div key={`${title}-${task.taskId}`} onClick={() => { onOpen(task.taskId); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer' }}>
            <TaskStatusBadge status={task.status} />
            <span style={{ flex: 1, fontSize: '0.85em' }}>{task.goal}</span>
            <span style={{ fontSize: '0.75em', color: '#666' }}>{task.target}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunRow({ run, onClick }: { run: RunSummary; onClick: () => void }): React.ReactElement {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem', border: '1px solid #eee', borderRadius: 4, cursor: 'pointer' }}>
      <RunStatusBadge status={run.status} />
      <span style={{ fontSize: '0.85em', color: '#555' }}>{run.runMode}</span>
      <span style={{ fontSize: '0.85em', flex: 1 }}>{run.scopeType}{run.scopeValue ? `: ${run.scopeValue}` : ''}</span>
      {(run.projectName ?? run.projectId) && <span style={{ fontSize: '0.8em', color: '#666', background: '#f5f5f5', padding: '1px 5px', borderRadius: 3 }}>{run.projectName ?? run.projectId!.slice(0, 8)}</span>}
      {(run.siteName ?? run.siteId) && <span style={{ fontSize: '0.8em', color: '#666', background: '#eef5ff', padding: '1px 5px', borderRadius: 3 }}>{run.siteName ?? run.siteId!.slice(0, 8)}</span>}
      <span style={{ fontSize: '0.8em', color: '#888' }}>{run.startedAt.slice(0, 16).replace('T', ' ')}</span>
      <span style={{ fontSize: '0.85em' }}>✓{run.passed} ✗{run.failed}</span>
    </div>
  );
}
