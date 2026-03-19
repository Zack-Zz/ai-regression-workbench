import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, usePoll, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Card, KV, Button, Table, StageResultsList } from '../components/ui.js';
import type { SSEEvent } from '../types.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function ExecutionReportPage(): React.ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const id = runId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getExecutionReport(id), [id]);
  const isActive = data ? !TERMINAL.has(data.status) : false;
  const handleRunEvent = React.useCallback((event: SSEEvent) => {
    if (event.type === 'run.updated' || event.type === 'run.step.updated') reload();
  }, [reload]);
  const { connected } = useServerEvents(
    ['run.updated', 'run.step.updated'],
    handleRunEvent,
    (e) => e.id === id,
    () => { reload(); },
  );
  usePoll(reload, 2500, isActive && !connected);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div>{t('common.notFound')}</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Button onClick={() => { navigate(`/runs/${id}`); }}>← {t('common.back')}</Button>
        <h2 style={{ margin: 0 }}>{t('run.executionReport')}</h2>
      </div>

      <Card title="概览">
        <KV label={t('run.mode')} value={data.runMode} />
        <KV label={t('common.status')} value={data.status} />
        {data.currentStage && <KV label={t('run.stage')} value={data.currentStage} />}
        <KV label={t('run.startedAt')} value={data.startedAt} />
        {data.endedAt && <KV label={t('run.endedAt')} value={data.endedAt} />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
          <MetricCard label="总用例" value={String(data.summary.total)} />
          <MetricCard label="通过" value={String(data.summary.passed)} tone="ok" />
          <MetricCard label="失败" value={String(data.summary.failed)} tone={data.summary.failed > 0 ? 'error' : 'neutral'} />
          <MetricCard label="跳过" value={String(data.summary.skipped)} />
          <MetricCard label="流程步骤" value={String(data.totals.flowStepCount)} />
          <MetricCard label="UI 操作" value={String(data.totals.uiActionCount)} />
          <MetricCard label="接口调用" value={String(data.totals.apiCallCount)} />
          <MetricCard label="失败接口" value={String(data.totals.failedApiCount)} tone={data.totals.failedApiCount > 0 ? 'warn' : 'neutral'} />
        </div>
        {data.fatalReason && (
          <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.8rem', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 6, color: '#be123c', fontSize: '0.9em' }}>
            {t(`run.summary.${data.fatalReason}`)}
          </div>
        )}
      </Card>

      {data.stageResults.length > 0 && (
        <Card title="阶段结果">
          <StageResultsList stages={data.stageResults} currentStage={data.currentStage} live={isActive || connected} />
        </Card>
      )}

      {data.degradedSteps.length > 0 && (
        <Card title="降级步骤">
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em' }}>
            {data.degradedSteps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </Card>
      )}

      {data.flowSummaries.length > 0 && (
        <Card title="流程链路摘要">
          <Table
            headers={['Flow ID', '步骤', 'UI 操作', '接口', '失败接口', '耗时']}
            rows={data.flowSummaries.map((flow) => [
              flow.flowId,
              String(flow.stepCount),
              String(flow.uiActionCount),
              String(flow.apiCallCount),
              String(flow.failedApiCount),
              flow.durationMs !== undefined ? `${String(flow.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {data.codeTaskSummaries.length > 0 && (
        <Card title={`关联代码任务 (${String(data.codeTaskSummaries.length)})`}>
          <Table
            headers={['Task', 'Testcase', '状态', '更新时间']}
            rows={data.codeTaskSummaries.map((task) => [
              <button key="task" onClick={() => { navigate(`/code-tasks/${task.taskId}`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline', fontFamily: 'monospace' }}>
                {task.taskId}
              </button>,
              task.testcaseId ?? '-',
              task.status,
              task.updatedAt,
            ])}
          />
        </Card>
      )}

      {data.testcaseProfiles.length > 0 && (
        <Card title={`Testcase Profiles (${String(data.testcaseProfiles.length)})`}>
          <Table
            headers={['Testcase', '查看', '入口']}
            rows={data.testcaseProfiles.map((profile) => [
              profile.testcaseId,
              <button key="open" onClick={() => { navigate(`/runs/${id}/testcases/${profile.testcaseId}/execution-profile`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline' }}>
                执行详情
              </button>,
              <span key="path" style={{ fontSize: '0.8em', wordBreak: 'break-all' }}>{`/runs/${id}/testcases/${profile.testcaseId}/execution-profile`}</span>,
            ])}
          />
        </Card>
      )}

      {data.artifactLinks.length > 0 && (
        <Card title={`产物链接 (${String(data.artifactLinks.length)})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {data.artifactLinks.map((link, index) => (
              <a key={`${link}-${index}`} href={link} target="_blank" rel="noreferrer" style={{ color: '#36c', textDecoration: 'underline', wordBreak: 'break-all', fontSize: '0.9em' }}>
                {link}
              </a>
            ))}
          </div>
        </Card>
      )}

      {data.failureReports.length > 0 && (
        <Card title={t('run.failureReports')}>
          {data.failureReports.map((failure) => (
            <div key={failure.testcaseId} style={{ padding: '0.4rem 0', borderBottom: '1px solid #eee', display: 'flex', gap: '1rem', fontSize: '0.9em' }}>
              <button onClick={() => { navigate(`/runs/${id}/testcases/${failure.testcaseId}/failure-report`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline' }}>
                {failure.testcaseId}
              </button>
              <span style={{ color: '#c33' }}>{failure.errorMessage ?? ''}</span>
            </div>
          ))}
        </Card>
      )}

      {data.warnings && data.warnings.length > 0 && (
        <Card title="警告">
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em', color: '#f60' }}>
            {data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </Card>
      )}

      {data.recommendations && data.recommendations.length > 0 && (
        <Card title="建议动作">
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em', color: '#1d4ed8' }}>
            {data.recommendations.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MetricCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'ok' | 'warn' | 'error' }): React.ReactElement {
  const color = tone === 'ok' ? '#047857' : tone === 'warn' ? '#b45309' : tone === 'error' ? '#b91c1c' : '#111827';
  const bg = tone === 'ok' ? '#ecfdf5' : tone === 'warn' ? '#fffbeb' : tone === 'error' ? '#fef2f2' : '#f9fafb';
  const border = tone === 'ok' ? '#a7f3d0' : tone === 'warn' ? '#fde68a' : tone === 'error' ? '#fecaca' : '#e5e7eb';
  return (
    <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 6, padding: '0.75rem' }}>
      <div style={{ fontSize: '0.8em', color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
