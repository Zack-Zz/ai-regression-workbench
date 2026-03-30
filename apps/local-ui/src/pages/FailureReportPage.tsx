import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Card, KV, Button, Table, ImagePreviewModal } from '../components/ui.js';

export function FailureReportPage(): React.ReactElement {
  const { runId, testcaseId } = useParams<{ runId: string; testcaseId: string }>();
  const navigate = useNavigate();
  const rid = runId ?? '';
  const tid = testcaseId ?? '';

  const report = useAsync(() => api.getFailureReport(rid, tid), [rid, tid]);
  const analysis = useAsync(() => api.getAnalysis(rid, tid), [rid, tid]);
  const drafts = useAsync(() => api.listDrafts(rid, tid), [rid, tid]);
  const profile = useAsync(() => api.getExecutionProfile(rid, tid), [rid, tid]);
  const diagnostics = useAsync(() => api.getDiagnostics(rid, tid), [rid, tid]);
  const trace = useAsync(() => api.getTrace(rid, tid), [rid, tid]);
  const logs = useAsync(() => api.getLogs(rid, tid), [rid, tid]);
  const [previewImage, setPreviewImage] = React.useState<string | null>(null);

  async function retryAnalysis(): Promise<void> {
    try { await api.retryAnalysis(rid, tid); analysis.reload(); } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); }
  }

  async function promote(draftId: string): Promise<void> {
    try {
      const res = await api.promoteDraft(rid, tid, draftId);
      if (res.taskId) { navigate(`/code-tasks/${res.taskId}`); }
      drafts.reload();
    } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); }
  }

  if (report.loading) return <Loading />;
  if (report.error) return <ErrorBanner message={report.error} onRetry={report.reload} />;
  if (!report.data) return <div>{t('common.notFound')}</div>;

  const r = report.data;
  const screenshotUrl = r.artifacts.screenshotPath ? api.getFailureArtifactUrl(rid, tid, 'screenshot') : null;
  const videoUrl = r.artifacts.videoPath ? api.getFailureArtifactUrl(rid, tid, 'video') : null;
  const traceUrl = r.artifacts.tracePath ? api.getFailureArtifactUrl(rid, tid, 'trace') : null;
  const htmlReportUrl = r.artifacts.htmlReportPath ? api.getFailureArtifactUrl(rid, tid, 'html-report') : null;
  const networkUrl = r.artifacts.networkLogPath ? api.getFailureArtifactUrl(rid, tid, 'network') : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Button onClick={() => { navigate(`/runs/${rid}`); }}>← {t('common.back')}</Button>
        <h2 style={{ margin: 0 }}>{r.testcaseName}</h2>
      </div>

      <Card title={t('failureReport.failureInfo')}>
        <KV label={t('failureReport.testcase')} value={r.testcaseId} />
        {r.errorType && <KV label={t('failureReport.errorType')} value={r.errorType} />}
        {r.errorMessage && <KV label={t('failureReport.errorMessage')} value={<span style={{ color: '#c33' }}>{r.errorMessage}</span>} />}
      </Card>

      {Object.values(r.artifacts).some(Boolean) && (
        <Card title={t('failureReport.artifacts')}>
          {screenshotUrl && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ color: '#666', minWidth: 140, fontSize: '0.9em', marginBottom: '0.5rem' }}>{t('failureReport.screenshot')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <button
                  onClick={() => { setPreviewImage(screenshotUrl); }}
                  style={{ alignSelf: 'flex-start', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 0, cursor: 'zoom-in', overflow: 'hidden' }}
                >
                  <img src={screenshotUrl} alt={`${r.testcaseName} screenshot`} style={{ display: 'block', width: 'min(420px, 100%)', maxWidth: '100%', maxHeight: 240, objectFit: 'cover', background: '#f8fafc' }} />
                </button>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <a href={screenshotUrl} target="_blank" rel="noreferrer">{t('failureReport.viewOriginal')}</a>
                  <button onClick={() => { setPreviewImage(screenshotUrl); }} style={{ border: 'none', background: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>{t('failureReport.preview')}</button>
                </div>
              </div>
            </div>
          )}
          {videoUrl && <KV label={t('failureReport.video')} value={<a href={videoUrl} target="_blank" rel="noreferrer">{t('common.view')}</a>} />}
          {traceUrl && <KV label="Trace" value={<a href={traceUrl} target="_blank" rel="noreferrer">{t('common.download')}</a>} />}
          {htmlReportUrl && <KV label={t('failureReport.htmlReport')} value={<a href={htmlReportUrl} target="_blank" rel="noreferrer">{t('common.view')}</a>} />}
          {networkUrl && <KV label={t('failureReport.networkLog')} value={<a href={networkUrl} target="_blank" rel="noreferrer">{t('common.view')}</a>} />}
        </Card>
      )}

      <Card title={t('failureReport.relatedContext')}>
        <KV label={t('failureReport.traceIds')} value={r.correlationContext.traceIds.join(', ') || '-'} />
        <KV label={t('failureReport.requestIds')} value={r.correlationContext.requestIds.join(', ') || '-'} />
        <KV label={t('failureReport.sessionIds')} value={r.correlationContext.sessionIds.join(', ') || '-'} />
      </Card>

      <Card title={t('failureReport.diagnostics')}>
        {diagnostics.loading && <Loading />}
        {diagnostics.error && <ErrorBanner message={diagnostics.error} />}
        {!diagnostics.loading && diagnostics.data && diagnostics.data.diagnosticFetches.length === 0 && (
          <span style={{ color: '#888', fontSize: '0.9em' }}>{t('failureReport.noDiagnostics')}</span>
        )}
        {diagnostics.data && diagnostics.data.diagnosticFetches.length > 0 && (
          <Table
            headers={[t('common.type'), t('common.status'), t('failureReport.provider'), t('common.time'), t('failureReport.rawLink')]}
            rows={diagnostics.data.diagnosticFetches.map((fetch) => [
              fetch.type,
              <span key="status" style={{ color: fetch.status === 'succeeded' ? '#2a7' : fetch.status === 'degraded' ? '#b45309' : fetch.status === 'pending' ? '#6b7280' : '#c33' }}>{fetch.status}</span>,
              fetch.provider ?? '-',
              fetch.createdAt,
              fetch.rawLink ? <a key="link" href={fetch.rawLink} target="_blank" rel="noreferrer">{t('common.view')}</a> : '-',
            ])}
          />
        )}
      </Card>

      <Card title={t('failureReport.traceSummary')}>
        {trace.loading && <Loading />}
        {trace.error && <ErrorBanner message={trace.error} />}
        {!trace.loading && !trace.data && <span style={{ color: '#888', fontSize: '0.9em' }}>{t('failureReport.noTrace')}</span>}
        {trace.data && trace.data.unavailableReason && (
          <div style={{ color: '#b45309', fontSize: '0.9em', padding: '0.5rem', background: '#fffbeb', borderRadius: 4, border: '1px solid #fde68a' }}>
            ⚠ {trace.data.unavailableReason}
          </div>
        )}
        {trace.data && !trace.data.unavailableReason && (
          <>
            <KV label={t('failureReport.traceId')} value={trace.data.summary.traceId} />
            <KV label={t('failureReport.hasError')} value={trace.data.summary.hasError ? t('failureReport.yes') : t('failureReport.no')} />
            {trace.data.summary.rawLink && <KV label={t('failureReport.rawLink')} value={<a href={trace.data.summary.rawLink} target="_blank" rel="noreferrer">{t('common.view')}</a>} />}
            {trace.data.summary.errorSpans.length > 0 && <KV label={t('failureReport.errorSpanCount')} value={String(trace.data.summary.errorSpans.length)} />}
          </>
        )}
      </Card>

      <Card title={t('failureReport.logSummary')}>
        {logs.loading && <Loading />}
        {logs.error && <ErrorBanner message={logs.error} />}
        {!logs.loading && !logs.data && <span style={{ color: '#888', fontSize: '0.9em' }}>{t('failureReport.noLogs')}</span>}
        {logs.data && logs.data.unavailableReason && (
          <div style={{ color: '#b45309', fontSize: '0.9em', padding: '0.5rem', background: '#fffbeb', borderRadius: 4, border: '1px solid #fde68a' }}>
            ⚠ {logs.data.unavailableReason}
          </div>
        )}
        {logs.data && !logs.data.unavailableReason && (
          <>
            <KV label={t('failureReport.matched')} value={logs.data.summary.matched ? t('failureReport.yes') : t('failureReport.no')} />
            {logs.data.summary.rawLink && <KV label={t('failureReport.rawLink')} value={<a href={logs.data.summary.rawLink} target="_blank" rel="noreferrer">{t('common.view')}</a>} />}
            {logs.data.summary.highlights.length > 0 && (
              <div>
                <div style={{ color: '#666', fontSize: '0.85em', marginBottom: 4 }}>{t('failureReport.highlights')}</div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em' }}>
                  {logs.data.summary.highlights.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title={t('failureReport.aiAnalysis')}>
        {analysis.loading && <Loading />}
        {analysis.error && <ErrorBanner message={analysis.error} />}
        {!analysis.loading && !analysis.data && (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ color: '#888', fontSize: '0.9em' }}>{t('failureReport.noAnalysis')}</span>
            <Button onClick={() => { void retryAnalysis(); }}>{t('failureReport.triggerAnalysis')}</Button>
          </div>
        )}
        {analysis.data && (
          <>
            {analysis.data.summary && <KV label={t('failureReport.summary')} value={analysis.data.summary} />}
            {analysis.data.probableCause && <KV label={t('failureReport.probableCause')} value={analysis.data.probableCause} />}
            {analysis.data.suspectedLayer && <KV label={t('failureReport.suspectedLayer')} value={analysis.data.suspectedLayer} />}
            {analysis.data.confidence !== undefined && <KV label={t('failureReport.confidence')} value={`${String(analysis.data.confidence)}%`} />}
            {analysis.data.suggestions && analysis.data.suggestions.length > 0 && (
              <div>
                <div style={{ color: '#666', fontSize: '0.85em', marginBottom: 4 }}>{t('failureReport.suggestions')}</div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em' }}>
                  {analysis.data.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            <div style={{ marginTop: '0.5rem' }}>
              <Button onClick={() => { void retryAnalysis(); }}>{t('failureReport.retryAnalysis')}</Button>
            </div>
          </>
        )}
      </Card>

      {drafts.data && drafts.data.length > 0 && (
        <Card title={t('failureReport.aiDrafts', { count: drafts.data.length })}>
          {drafts.data.map(d => (
            <div key={d.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{d.goal}</div>
                <div style={{ fontSize: '0.85em', color: '#888' }}>{d.target} · {d.created_at.slice(0, 16).replace('T', ' ')}</div>
              </div>
              <Button variant="primary" onClick={() => { void promote(d.id); }}>{t('failureReport.createCodeTask')}</Button>
            </div>
          ))}
        </Card>
      )}

      <Card title={t('failureReport.executionProfile')}>
        {profile.loading && <Loading />}
        {profile.error && <ErrorBanner message={profile.error} />}
        {profile.data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <MiniStat label={t('executionReport.flowSteps')} value={String(profile.data.summary.flowStepCount)} />
            <MiniStat label={t('executionReport.uiActions')} value={String(profile.data.summary.uiActionCount)} />
            <MiniStat label={t('executionReport.apiCalls')} value={String(profile.data.summary.apiCallCount)} />
            <MiniStat label={t('executionReport.failedApis')} value={String(profile.data.summary.failedApiCount)} tone={profile.data.summary.failedApiCount > 0 ? 'warn' : 'neutral'} />
          </div>
        )}
        {!profile.loading && !profile.data && <span style={{ color: '#888', fontSize: '0.9em' }}>{t('failureReport.noExecutionProfile')}</span>}
      </Card>

      {profile.data && profile.data.flowSteps.length > 0 && (
        <Card title={t('testcaseExecution.flowSteps', { count: profile.data.flowSteps.length })}>
          <Table
            headers={[t('testcaseExecution.step'), t('testcaseExecution.flow'), t('common.status'), t('run.startedAt'), t('common.duration')]}
            rows={profile.data.flowSteps.map((step) => [
              step.stepName,
              step.flowId,
              <span key="success" style={{ color: step.success ? '#2a7' : '#c33' }}>{step.success ? t('testcaseExecution.success') : t('testcaseExecution.failed')}</span>,
              step.startedAt,
              step.durationMs !== undefined ? `${String(step.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {profile.data && profile.data.uiActions.length > 0 && (
        <Card title={t('testcaseExecution.uiActions', { count: profile.data.uiActions.length })}>
          <Table
            headers={[t('common.type'), t('common.status'), t('testcaseExecution.page'), t('run.startedAt'), t('common.duration')]}
            rows={profile.data.uiActions.map((action) => [
              action.actionType,
              <span key="success" style={{ color: action.success ? '#2a7' : '#c33' }}>{action.success ? t('testcaseExecution.success') : t('testcaseExecution.failed')}</span>,
              <span key="page" style={{ fontSize: '0.8em', wordBreak: 'break-all' }}>{action.pageUrl ?? '-'}</span>,
              action.startedAt,
              action.durationMs !== undefined ? `${String(action.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {profile.data && profile.data.apiCalls.length > 0 && (
        <Card title={t('testcaseExecution.apiCalls', { count: profile.data.apiCalls.length })}>
          <Table
            headers={[t('common.method'), t('common.url'), t('common.status'), t('common.duration'), t('failureReport.responseSummaryOrError')]}
            rows={profile.data.apiCalls.map(c => [
              c.method ?? '-',
              <span key="u" style={{ fontSize: '0.8em', wordBreak: 'break-all' }}>{c.url}</span>,
              <span key="s" style={{ color: c.success ? '#2a7' : '#c33' }}>{c.statusCode ?? '-'}</span>,
              c.durationMs !== undefined ? `${String(c.durationMs)}ms` : '-',
              <span key="summary" style={{ fontSize: '0.8em', wordBreak: 'break-word' }}>{c.responseSummary ?? c.errorMessage ?? '-'}</span>,
            ])}
          />
        </Card>
      )}

      {previewImage && <ImagePreviewModal src={previewImage} title={t('failureReport.screenshotPreview', { name: r.testcaseName })} onClose={() => { setPreviewImage(null); }} />}
    </div>
  );
}

function MiniStat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warn' }): React.ReactElement {
  const bg = tone === 'warn' ? '#fffbeb' : '#f9fafb';
  const border = tone === 'warn' ? '#fde68a' : '#e5e7eb';
  const color = tone === 'warn' ? '#b45309' : '#111827';
  return (
    <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 6, padding: '0.75rem' }}>
      <div style={{ fontSize: '0.8em', color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
