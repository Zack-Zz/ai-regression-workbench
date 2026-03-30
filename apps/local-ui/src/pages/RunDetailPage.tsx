import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, usePoll, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, RunStatusBadge, TaskStatusBadge, Card, KV, Button, Table, StageResultsList } from '../components/ui.js';
import { StepLogPanel } from '../components/StepLog.js';
import { fmtDatetime } from '../utils.js';
import type { SSEEvent } from '../types.js';

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

  const handleRunEvent = React.useCallback((event: SSEEvent) => {
    if (event.type === 'run.step.updated') {
      reload();
      reloadReport();
      return;
    }
    refreshAll();
  }, [reload, reloadReport, refreshAll]);

  const { connected } = useServerEvents(
    ['run.updated', 'run.step.updated'],
    handleRunEvent,
    (e) => e.id === id,
    () => {
      reload();
      reloadReport();
    },
  );
  usePoll(refreshAll, 2500, isActive && !connected);

  async function doAction(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); refreshAll(); } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div>{t('common.notFound')}</div>;

  const { summary, testResults, findings, events, explorationConfig } = data;
  const displayStage = report?.currentStage ?? summary.currentStage;
  const showTopSummaryBanner = Boolean(summary.summary && (!report?.fatalReason || report.fatalReason !== summary.summary));

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
        {summary.projectName && <KV label={t('runDetail.project')} value={summary.projectName} />}
        {summary.siteName && <KV label={t('runDetail.site')} value={summary.siteBaseUrl ? `${summary.siteName} — ${summary.siteBaseUrl}` : summary.siteName} />}
        {summary.credLabel && <KV label={t('runDetail.identity')} value={summary.credLabel} />}
        <KV label={t('run.startedAt')} value={fmtDatetime(summary.startedAt)} />
        {summary.endedAt && <KV label={t('run.endedAt')} value={fmtDatetime(summary.endedAt)} />}
        {displayStage && <KV label={t('run.stage')} value={displayStage} />}
        <KV label={t('runDetail.stats')} value={`✓${String(summary.passed)} ✗${String(summary.failed)} ↷${String(summary.skipped)} / ${String(summary.total)}`} />
        {showTopSummaryBanner && summary.summary && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: summary.status === 'FAILED' ? '#fff1f0' : '#f6ffed', border: `1px solid ${summary.status === 'FAILED' ? '#ffa39e' : '#b7eb8f'}`, borderRadius: 4, fontSize: 13, color: '#333' }}>
            {t(`run.summary.${summary.summary}`)}
          </div>
        )}
      </Card>

      {report && (
        <>
          <Card title={t('runDetail.executionSummary')}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
              <MetricCard label={t('executionReport.totalCases')} value={String(report.summary.total)} />
              <MetricCard label={t('executionReport.passed')} value={String(report.summary.passed)} tone="ok" />
              <MetricCard label={t('executionReport.failed')} value={String(report.summary.failed)} tone={report.summary.failed > 0 ? 'error' : 'neutral'} />
              <MetricCard label={t('executionReport.uiActions')} value={String(report.totals.uiActionCount)} />
              <MetricCard label={t('executionReport.apiCalls')} value={String(report.totals.apiCallCount)} />
              <MetricCard label={t('executionReport.failedApis')} value={String(report.totals.failedApiCount)} tone={report.totals.failedApiCount > 0 ? 'warn' : 'neutral'} />
            </div>
            {report.fatalReason && (
              <div style={{ marginTop: '0.75rem', padding: '0.65rem 0.8rem', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 6, color: '#be123c', fontSize: '0.9em' }}>
                {t(`run.summary.${report.fatalReason}`)}
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
            <Card title={t('executionReport.stageResults')}>
              <StageResultsList stages={report.stageResults} currentStage={displayStage} live={isActive || connected} />
            </Card>
          )}
        </>
      )}

      {explorationConfig && (
        <Card title={t('run.explorationConfig')}>
          <KV label={t('run.startUrls')} value={explorationConfig.startUrls.join(', ')} />
          {explorationConfig.maxSteps !== undefined && <KV label={t('run.maxSteps')} value={String(explorationConfig.maxSteps)} />}
          {explorationConfig.maxPages !== undefined && <KV label={t('run.maxPages')} value={String(explorationConfig.maxPages)} />}
          {explorationConfig.browserMode && <KV label={t('run.browserMode')} value={explorationConfig.browserMode === 'headed' ? t('run.browserMode.headed') : t('run.browserMode.headless')} />}
          {explorationConfig.captchaAutoSolve !== undefined && <KV label={t('run.captchaAutoSolve')} value={explorationConfig.captchaAutoSolve ? t('common.enabled') : t('common.disabled')} />}
          {explorationConfig.captchaAutoSolveAttempts !== undefined && <KV label={t('run.captchaAutoSolveAttempts')} value={String(explorationConfig.captchaAutoSolveAttempts)} />}
          {explorationConfig.manualInterventionOnCaptcha !== undefined && <KV label={t('run.manualInterventionOnCaptcha')} value={explorationConfig.manualInterventionOnCaptcha ? t('common.enabled') : t('common.disabled')} />}
          {explorationConfig.manualLoginTimeoutMs !== undefined && <KV label={t('run.manualLoginTimeoutSec')} value={String(Math.floor(explorationConfig.manualLoginTimeoutMs / 1000))} />}
          {explorationConfig.focusAreas && explorationConfig.focusAreas.length > 0 && <KV label={t('run.focusAreas')} value={explorationConfig.focusAreas.join(', ')} />}
          {explorationConfig.allowedHosts && explorationConfig.allowedHosts.length > 0 && <KV label={t('run.allowedHosts')} value={explorationConfig.allowedHosts.join(', ')} />}
        </Card>
      )}

      {testResults.length > 0 && (
        <Card title={t('runDetail.testResults', { count: testResults.length })}>
          <Table
            headers={[t('executionReport.testcase'), t('common.status'), t('common.duration'), t('common.error'), t('runDetail.view')]}
            rows={testResults.map(r => [
              r.testcaseId,
              <span key="s" style={{ color: r.status === 'passed' ? '#2a7' : r.status === 'failed' ? '#c33' : '#888' }}>{t(`runDetail.testStatus.${r.status}`)}</span>,
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
                {r.status === 'failed' ? t('runDetail.failureDiagnosis') : t('runDetail.executionDetail')}
              </button>,
            ])}
          />
        </Card>
      )}

      {findings && findings.length > 0 && (
        <Card title={t('runDetail.findings', { count: findings.length })}>
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
            headers={[t('runDetail.taskId'), t('common.status'), t('runDetail.goal')]}
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
