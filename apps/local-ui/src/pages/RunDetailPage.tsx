import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, usePoll, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, RunStatusBadge, TaskStatusBadge, Card, KV, Button, Table, StageResultsList } from '../components/ui.js';
import { StepLogPanel } from '../components/StepLog.js';
import { fmtDatetime } from '../utils.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function RunDetailPage(): React.ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const id = runId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getRun(id), [id]);
  const isActive = data ? !TERMINAL.has(data.summary.status) : false;
  const { data: taskData, reload: reloadTasks } = useAsync(() => api.listCodeTasks(`runId=${id}`), [id]);
  const { data: report, reload: reloadReport } = useAsync(() => api.getExecutionReport(id), [id]);
  const refreshAll = React.useCallback(() => {
    reload();
    reloadTasks();
    reloadReport();
  }, [reload, reloadTasks, reloadReport]);
  const { connected } = useServerEvents(['run.updated', 'run.step.updated'], () => { refreshAll(); }, (e) => !e.id || e.id === id, () => { refreshAll(); });
  usePoll(refreshAll, 2500, isActive);

  async function doAction(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); reload(); } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div>{t('common.notFound')}</div>;

  const { summary, testResults, findings, events, explorationConfig } = data;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Button onClick={() => { navigate('/runs'); }}>← {t('common.back')}</Button>
        <h2 style={{ margin: 0 }}>{summary.runId}</h2>
        <RunStatusBadge status={summary.status} />
        <div style={{ flex: 1 }} />
        {summary.status === 'PAUSED' && <Button variant="primary" onClick={() => { void doAction(() => api.resumeRun(id)); }}>{t('run.resume')}</Button>}
        {isActive && summary.status !== 'PAUSED' && <Button onClick={() => { void doAction(() => api.pauseRun(id)); }}>{t('run.pause')}</Button>}
        {!TERMINAL.has(summary.status) && <Button variant="danger" onClick={() => { void doAction(() => api.cancelRun(id)); }}>{t('run.cancel')}</Button>}
        <Button onClick={() => { navigate(`/runs/${id}/execution-report`); }}>{t('run.executionReport')}</Button>
      </div>

      <Card>
        <KV label={t('run.mode')} value={summary.runMode} />
        <KV label={t('run.scope')} value={`${summary.scopeType ?? ''}${summary.scopeValue ? `: ${summary.scopeValue}` : ''}`} />
        {summary.projectName && <KV label="项目" value={summary.projectName} />}
        {summary.siteName && <KV label="站点" value={summary.siteBaseUrl ? `${summary.siteName} — ${summary.siteBaseUrl}` : summary.siteName} />}
        {summary.credLabel && <KV label="身份" value={summary.credLabel} />}
        <KV label={t('run.startedAt')} value={fmtDatetime(summary.startedAt)} />
        {summary.endedAt && <KV label={t('run.endedAt')} value={fmtDatetime(summary.endedAt)} />}
        {summary.currentStage && <KV label={t('run.stage')} value={summary.currentStage} />}
        <KV label="统计" value={`✓${String(summary.passed)} ✗${String(summary.failed)} ↷${String(summary.skipped)} / ${String(summary.total)}`} />
        {summary.summary && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: summary.status === 'FAILED' ? '#fff1f0' : '#f6ffed', border: `1px solid ${summary.status === 'FAILED' ? '#ffa39e' : '#b7eb8f'}`, borderRadius: 4, fontSize: 13, color: '#333' }}>
            {t(`run.summary.${summary.summary}`)}
          </div>
        )}
      </Card>

      {report && (
        <>
          <Card title="执行摘要">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
              <MetricCard label="总用例" value={String(report.summary.total)} />
              <MetricCard label="通过" value={String(report.summary.passed)} tone="ok" />
              <MetricCard label="失败" value={String(report.summary.failed)} tone={report.summary.failed > 0 ? 'error' : 'neutral'} />
              <MetricCard label="UI 操作" value={String(report.totals.uiActionCount)} />
              <MetricCard label="接口调用" value={String(report.totals.apiCallCount)} />
              <MetricCard label="失败接口" value={String(report.totals.failedApiCount)} tone={report.totals.failedApiCount > 0 ? 'warn' : 'neutral'} />
            </div>
            {report.fatalReason && (
              <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.8rem', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 6, color: '#be123c', fontSize: '0.9em' }}>
                {report.fatalReason}
              </div>
            )}
            {report.warnings && report.warnings.length > 0 && (
              <div style={{ marginTop: '0.75rem', color: '#b45309', fontSize: '0.9em' }}>
                {report.warnings.join('；')}
              </div>
            )}
            {report.recommendations && report.recommendations.length > 0 && (
              <div style={{ marginTop: '0.75rem', color: '#1d4ed8', fontSize: '0.9em' }}>
                {report.recommendations.join('；')}
              </div>
            )}
          </Card>

          {report.stageResults.length > 0 && (
            <Card title="阶段结果">
              <StageResultsList stages={report.stageResults} currentStage={summary.currentStage} live={isActive || connected} />
            </Card>
          )}
        </>
      )}

      {explorationConfig && (
        <Card title={t('run.explorationConfig')}>
          <KV label={t('run.startUrls')} value={explorationConfig.startUrls.join(', ')} />
          {explorationConfig.maxSteps !== undefined && <KV label={t('run.maxSteps')} value={String(explorationConfig.maxSteps)} />}
          {explorationConfig.maxPages !== undefined && <KV label={t('run.maxPages')} value={String(explorationConfig.maxPages)} />}
          {explorationConfig.focusAreas && explorationConfig.focusAreas.length > 0 && <KV label={t('run.focusAreas')} value={explorationConfig.focusAreas.join(', ')} />}
          {explorationConfig.allowedHosts && explorationConfig.allowedHosts.length > 0 && <KV label={t('run.allowedHosts')} value={explorationConfig.allowedHosts.join(', ')} />}
        </Card>
      )}

      {testResults.length > 0 && (
        <Card title={`测试结果 (${String(testResults.length)})`}>
          <Table
            headers={['Testcase', t('common.status'), t('common.duration'), t('common.error'), '查看']}
            rows={testResults.map(r => [
              r.testcaseId,
              <span key="s" style={{ color: r.status === 'passed' ? '#2a7' : r.status === 'failed' ? '#c33' : '#888' }}>{r.status}</span>,
              r.durationMs !== undefined ? `${String(r.durationMs)}ms` : '-',
              r.errorMessage ?? '-',
              <button
                key="open"
                onClick={() => {
                  navigate(r.status === 'failed'
                    ? `/runs/${id}/testcases/${r.testcaseId}/failure-report`
                    : `/runs/${id}/testcases/${r.testcaseId}/execution-profile`);
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline' }}
              >
                {r.status === 'failed' ? '失败诊断' : '执行详情'}
              </button>,
            ])}
          />
        </Card>
      )}

      {findings && findings.length > 0 && (
        <Card title={`Findings (${String(findings.length)})`}>
          {findings.map(f => (
            <div key={f.id} style={{ padding: '0.4rem 0', borderBottom: '1px solid #eee', fontSize: '0.9em' }}>
              <span style={{ color: f.severity === 'critical' ? '#c33' : f.severity === 'high' ? '#f60' : '#888', fontWeight: 600, marginRight: 8 }}>{f.severity}</span>
              <span style={{ marginRight: 8 }}>[{f.category}]</span>
              {f.summary}
            </div>
          ))}
        </Card>
      )}

      {taskData && taskData.items.length > 0 && (
        <Card title={`${t('nav.codeTasks')} (${String(taskData.items.length)})`}>
          <Table
            headers={['Task ID', t('common.status'), 'Goal']}
            rows={taskData.items.map(task => [
              <button key="id" onClick={() => { navigate(`/code-tasks/${task.taskId}`); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline', fontFamily: 'monospace' }}>
                {task.taskId}
              </button>,
              <TaskStatusBadge key="s" status={task.status} />,
              task.goal,
            ])}
          />
        </Card>
      )}

      {events.length > 0 && (
        <Card title={t('run.events')}>
          <div style={{ maxHeight: 300, overflowY: 'auto', fontSize: '0.8em' }}>
            {events.map(e => (
              <div key={e.eventId} style={{ padding: '3px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: '0.5rem' }}>
                <span style={{ color: '#888', minWidth: 140 }}>{fmtDatetime(e.createdAt)}</span>
                <span style={{ color: '#36c' }}>{e.eventType}</span>
                <span style={{ color: '#555' }}>{e.entityType}:{e.entityId}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(summary.runMode === 'exploration' || summary.runMode === 'hybrid') && (
        <StepLogPanel runId={id} {...(summary.summary !== undefined ? { runSummary: summary.summary } : {})} />
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
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
