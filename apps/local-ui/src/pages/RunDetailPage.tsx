import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, usePoll, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, RunStatusBadge, TaskStatusBadge, Card, KV, Button, Table, StageResultsList } from '../components/ui.js';
import { StepLogPanel, fmtDuration } from '../components/StepLog.js';
import { fmtDatetime } from '../utils.js';
import type { AgentSession, AgentSessionReplay, SSEEvent } from '../types.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function RunDetailPage(): React.ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const id = runId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getRun(id), [id]);
  const [selectedSession, setSelectedSession] = React.useState<AgentSession | null>(null);
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

  const { summary, testResults, findings, events, sessions, explorationConfig } = data;
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

      {sessions && sessions.length > 0 && (
        <Card title={`Agent Sessions (${String(sessions.length)})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {sessions.map((session) => (
              <div key={session.sessionId} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 600 }}>{session.agentName}</div>
                  <div style={{ color: '#6b7280', fontSize: '0.85em', fontFamily: 'monospace' }}>{session.sessionId}</div>
                </div>
                <span style={{ fontSize: '0.85em', background: '#f3f4f6', borderRadius: 999, padding: '2px 8px' }}>{session.kind}</span>
                <span style={{ fontSize: '0.85em', background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '2px 8px' }}>{session.status}</span>
                <span style={{ color: '#6b7280', fontSize: '0.85em' }}>{fmtDatetime(session.startedAt)}</span>
                {session.endedAt && <span style={{ color: '#6b7280', fontSize: '0.85em' }}>{fmtDatetime(session.endedAt)}</span>}
                {session.summary && <span style={{ color: '#374151', fontSize: '0.9em', flex: 1 }}>{session.summary}</span>}
                <Button onClick={() => { setSelectedSession(session); }}>Open Replay</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(summary.runMode === 'exploration' || summary.runMode === 'hybrid') && (
        <StepLogPanel runId={id} {...(summary.summary !== undefined ? { runSummary: summary.summary } : {})} />
      )}

      {selectedSession && (
        <SessionReplayModal
          runId={id}
          session={selectedSession}
          onClose={() => { setSelectedSession(null); }}
        />
      )}
    </div>
  );
}

function SessionReplayModal({
  runId,
  session,
  onClose,
}: {
  runId: string;
  session: AgentSession;
  onClose: () => void;
}): React.ReactElement {
  const { data, loading, error } = useAsync(() => api.getRunSessionReplay(runId, session.sessionId), [runId, session.sessionId]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div style={{ background: '#fff', borderRadius: 8, width: '92vw', maxWidth: 1180, height: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{session.agentName}</div>
            <div style={{ color: '#6b7280', fontSize: '0.85em', fontFamily: 'monospace' }}>{session.sessionId}</div>
          </div>
          <span style={{ fontSize: '0.85em', background: '#f3f4f6', borderRadius: 999, padding: '2px 8px' }}>{session.kind}</span>
          <span style={{ fontSize: '0.85em', background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '2px 8px' }}>{session.status}</span>
          <Button onClick={onClose}>✕</Button>
        </div>
        <div style={{ overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {loading && <Loading />}
          {error && <ErrorBanner message={error} onRetry={onClose} />}
          {data && <SessionReplayContent replay={data} />}
        </div>
      </div>
    </div>
  );
}

function SessionReplayContent({ replay }: { replay: AgentSessionReplay }): React.ReactElement {
  return (
    <>
      <Card title="Session Context">
        <KV label="Started" value={fmtDatetime(replay.session.startedAt)} />
        {replay.session.endedAt && <KV label="Ended" value={fmtDatetime(replay.session.endedAt)} />}
        {replay.session.taskId && <KV label="Task" value={replay.session.taskId} />}
        {replay.session.summary && <KV label="Summary" value={replay.session.summary} />}
        {replay.contextRefs && (
          <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', marginTop: 12, overflowX: 'auto', fontSize: '0.85em' }}>
            {JSON.stringify(replay.contextRefs, null, 2)}
          </pre>
        )}
      </Card>

      <Card title={`Session Steps (${String(replay.steps.length)})`}>
        {replay.steps.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: '0.9em' }}>No session steps recorded.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {replay.steps.map((step, index) => (
              <div key={`${step.entryType}-${step.stepIndex}-${index}`} style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{step.entryType === 'checkpoint' ? 'Checkpoint' : `Step ${String(step.stepIndex)}`}</strong>
                  <span style={{ color: '#6b7280', fontSize: '0.85em' }}>{fmtDatetime(step.timestamp)}</span>
                  {step.checkpointId && <code>{step.checkpointId}</code>}
                </div>
                {step.description && <div style={{ marginTop: 4 }}>{step.description}</div>}
                {step.outcome && <div style={{ color: '#4b5563', fontSize: '0.9em', marginTop: 4 }}>{step.outcome}</div>}
                {step.summary && <div style={{ color: '#4b5563', fontSize: '0.9em', marginTop: 4 }}>{step.summary}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Tool Calls (${String(replay.toolCalls.length)})`}>
        {replay.toolCalls.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: '0.9em' }}>No tool calls recorded.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {replay.toolCalls.map((entry, index) => (
              <div key={`${entry.entryType}-${entry.toolName}-${entry.stepIndex}-${index}`} style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{entry.toolName}</strong>
                  <span style={{ fontSize: '0.85em', background: entry.entryType === 'approval' ? '#fff7ed' : '#f3f4f6', color: entry.entryType === 'approval' ? '#c2410c' : '#374151', borderRadius: 999, padding: '2px 8px' }}>
                    {entry.entryType}
                  </span>
                  <span style={{ fontSize: '0.85em', background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '2px 8px' }}>{entry.status}</span>
                  <code>step {String(entry.stepIndex)}</code>
                  {entry.durationMs !== undefined && <span style={{ color: '#6b7280', fontSize: '0.85em' }}>{fmtDuration(entry.durationMs)}</span>}
                  {entry.requestedAt && <span style={{ color: '#6b7280', fontSize: '0.85em' }}>{fmtDatetime(entry.requestedAt)}</span>}
                  {entry.grantedAt && <span style={{ color: '#6b7280', fontSize: '0.85em' }}>granted {fmtDatetime(entry.grantedAt)}</span>}
                </div>
                {entry.inputSummary && <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: '0.85em', color: '#374151' }}>in: {entry.inputSummary}</div>}
                {entry.resultSummary && <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: '0.85em', color: '#374151' }}>out: {entry.resultSummary}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Prompt Samples (${String(replay.promptSamples.length)})`}>
        {replay.promptSamples.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: '0.9em' }}>No prompt samples recorded.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {replay.promptSamples.map((sample, index) => (
              <details key={`${sample.phase}-${sample.stepIndex}-${index}`} style={{ borderBottom: '1px solid #f3f4f6', paddingBottom: '0.5rem' }}>
                <summary style={{ cursor: 'pointer' }}>
                  <strong>{sample.phase}</strong>
                  <span style={{ marginLeft: 8, color: '#6b7280', fontSize: '0.85em' }}>{fmtDatetime(sample.timestamp)}</span>
                  <span style={{ marginLeft: 8, color: '#6b7280', fontSize: '0.85em', fontFamily: 'monospace' }}>{sample.templateVersion}</span>
                </summary>
                {sample.promptContextSummary && (
                  <div style={{ marginTop: 8, background: '#f8f8f8', borderRadius: 4, padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.85em' }}>
                    {sample.promptContextSummary}
                  </div>
                )}
                <pre style={{ marginTop: 8, background: '#f8f8f8', borderRadius: 4, padding: '8px 10px', overflowX: 'auto', fontSize: '0.82em', whiteSpace: 'pre-wrap' }}>
                  {sample.prompt}
                </pre>
                {sample.response && (
                  <pre style={{ marginTop: 8, background: '#f8f8f8', borderRadius: 4, padding: '8px 10px', overflowX: 'auto', fontSize: '0.82em', whiteSpace: 'pre-wrap' }}>
                    {sample.response}
                  </pre>
                )}
              </details>
            ))}
          </div>
        )}
      </Card>
    </>
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
