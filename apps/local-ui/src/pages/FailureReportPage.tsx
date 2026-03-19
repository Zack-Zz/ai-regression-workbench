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

      <Card title="失败信息">
        <KV label="Testcase" value={r.testcaseId} />
        {r.errorType && <KV label="错误类型" value={r.errorType} />}
        {r.errorMessage && <KV label="错误信息" value={<span style={{ color: '#c33' }}>{r.errorMessage}</span>} />}
      </Card>

      {Object.values(r.artifacts).some(Boolean) && (
        <Card title="产物">
          {screenshotUrl && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ color: '#666', minWidth: 140, fontSize: '0.9em', marginBottom: '0.5rem' }}>截图</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <button
                  onClick={() => { setPreviewImage(screenshotUrl); }}
                  style={{ alignSelf: 'flex-start', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', padding: 0, cursor: 'zoom-in', overflow: 'hidden' }}
                >
                  <img src={screenshotUrl} alt={`${r.testcaseName} screenshot`} style={{ display: 'block', width: 'min(420px, 100%)', maxWidth: '100%', maxHeight: 240, objectFit: 'cover', background: '#f8fafc' }} />
                </button>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <a href={screenshotUrl} target="_blank" rel="noreferrer">查看原图</a>
                  <button onClick={() => { setPreviewImage(screenshotUrl); }} style={{ border: 'none', background: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>放大预览</button>
                </div>
              </div>
            </div>
          )}
          {videoUrl && <KV label="视频" value={<a href={videoUrl} target="_blank" rel="noreferrer">查看</a>} />}
          {traceUrl && <KV label="Trace" value={<a href={traceUrl} target="_blank" rel="noreferrer">下载</a>} />}
          {htmlReportUrl && <KV label="HTML Report" value={<a href={htmlReportUrl} target="_blank" rel="noreferrer">查看</a>} />}
          {networkUrl && <KV label="网络日志" value={<a href={networkUrl} target="_blank" rel="noreferrer">查看</a>} />}
        </Card>
      )}

      <Card title="关联上下文">
        <KV label="Trace IDs" value={r.correlationContext.traceIds.join(', ') || '-'} />
        <KV label="Request IDs" value={r.correlationContext.requestIds.join(', ') || '-'} />
        <KV label="Session IDs" value={r.correlationContext.sessionIds.join(', ') || '-'} />
      </Card>

      <Card title="诊断抓取">
        {diagnostics.loading && <Loading />}
        {diagnostics.error && <ErrorBanner message={diagnostics.error} />}
        {!diagnostics.loading && diagnostics.data && diagnostics.data.diagnosticFetches.length === 0 && (
          <span style={{ color: '#888', fontSize: '0.9em' }}>暂无诊断抓取记录</span>
        )}
        {diagnostics.data && diagnostics.data.diagnosticFetches.length > 0 && (
          <Table
            headers={['类型', '状态', 'Provider', '时间', '原始链接']}
            rows={diagnostics.data.diagnosticFetches.map((fetch) => [
              fetch.type,
              <span key="status" style={{ color: fetch.status === 'succeeded' ? '#2a7' : fetch.status === 'degraded' ? '#b45309' : fetch.status === 'pending' ? '#6b7280' : '#c33' }}>{fetch.status}</span>,
              fetch.provider ?? '-',
              fetch.createdAt,
              fetch.rawLink ? <a key="link" href={fetch.rawLink} target="_blank" rel="noreferrer">查看</a> : '-',
            ])}
          />
        )}
      </Card>

      <Card title="Trace 摘要">
        {trace.loading && <Loading />}
        {trace.error && <ErrorBanner message={trace.error} />}
        {!trace.loading && !trace.data && <span style={{ color: '#888', fontSize: '0.9em' }}>暂无 trace 数据</span>}
        {trace.data && trace.data.unavailableReason && (
          <div style={{ color: '#b45309', fontSize: '0.9em', padding: '0.5rem', background: '#fffbeb', borderRadius: 4, border: '1px solid #fde68a' }}>
            ⚠ {trace.data.unavailableReason}
          </div>
        )}
        {trace.data && !trace.data.unavailableReason && (
          <>
            <KV label="Trace ID" value={trace.data.summary.traceId} />
            <KV label="有错误" value={trace.data.summary.hasError ? '是' : '否'} />
            {trace.data.summary.rawLink && <KV label="原始链接" value={<a href={trace.data.summary.rawLink} target="_blank" rel="noreferrer">查看</a>} />}
            {trace.data.summary.errorSpans.length > 0 && <KV label="错误 Span 数" value={String(trace.data.summary.errorSpans.length)} />}
          </>
        )}
      </Card>

      <Card title="日志摘要">
        {logs.loading && <Loading />}
        {logs.error && <ErrorBanner message={logs.error} />}
        {!logs.loading && !logs.data && <span style={{ color: '#888', fontSize: '0.9em' }}>暂无日志数据</span>}
        {logs.data && logs.data.unavailableReason && (
          <div style={{ color: '#b45309', fontSize: '0.9em', padding: '0.5rem', background: '#fffbeb', borderRadius: 4, border: '1px solid #fde68a' }}>
            ⚠ {logs.data.unavailableReason}
          </div>
        )}
        {logs.data && !logs.data.unavailableReason && (
          <>
            <KV label="命中" value={logs.data.summary.matched ? '是' : '否'} />
            {logs.data.summary.rawLink && <KV label="原始链接" value={<a href={logs.data.summary.rawLink} target="_blank" rel="noreferrer">查看</a>} />}
            {logs.data.summary.highlights.length > 0 && (
              <div>
                <div style={{ color: '#666', fontSize: '0.85em', marginBottom: 4 }}>高亮</div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em' }}>
                  {logs.data.summary.highlights.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="AI 分析">
        {analysis.loading && <Loading />}
        {analysis.error && <ErrorBanner message={analysis.error} />}
        {!analysis.loading && !analysis.data && (
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ color: '#888', fontSize: '0.9em' }}>暂无分析结果</span>
            <Button onClick={() => { void retryAnalysis(); }}>触发分析</Button>
          </div>
        )}
        {analysis.data && (
          <>
            {analysis.data.summary && <KV label="摘要" value={analysis.data.summary} />}
            {analysis.data.probableCause && <KV label="可能原因" value={analysis.data.probableCause} />}
            {analysis.data.suspectedLayer && <KV label="疑似层" value={analysis.data.suspectedLayer} />}
            {analysis.data.confidence !== undefined && <KV label="置信度" value={`${String(analysis.data.confidence)}%`} />}
            {analysis.data.suggestions && analysis.data.suggestions.length > 0 && (
              <div>
                <div style={{ color: '#666', fontSize: '0.85em', marginBottom: 4 }}>建议</div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em' }}>
                  {analysis.data.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            <div style={{ marginTop: '0.5rem' }}>
              <Button onClick={() => { void retryAnalysis(); }}>重新分析</Button>
            </div>
          </>
        )}
      </Card>

      {drafts.data && drafts.data.length > 0 && (
        <Card title={`AI 修复建议 (${String(drafts.data.length)})`}>
          {drafts.data.map(d => (
            <div key={d.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{d.goal}</div>
                <div style={{ fontSize: '0.85em', color: '#888' }}>{d.target} · {d.created_at.slice(0, 16).replace('T', ' ')}</div>
              </div>
              <Button variant="primary" onClick={() => { void promote(d.id); }}>创建代码任务</Button>
            </div>
          ))}
        </Card>
      )}

      <Card title="执行画像">
        {profile.loading && <Loading />}
        {profile.error && <ErrorBanner message={profile.error} />}
        {profile.data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <MiniStat label="流程步骤" value={String(profile.data.summary.flowStepCount)} />
            <MiniStat label="UI 操作" value={String(profile.data.summary.uiActionCount)} />
            <MiniStat label="接口调用" value={String(profile.data.summary.apiCallCount)} />
            <MiniStat label="失败接口" value={String(profile.data.summary.failedApiCount)} tone={profile.data.summary.failedApiCount > 0 ? 'warn' : 'neutral'} />
          </div>
        )}
        {!profile.loading && !profile.data && <span style={{ color: '#888', fontSize: '0.9em' }}>暂无执行画像</span>}
      </Card>

      {profile.data && profile.data.flowSteps.length > 0 && (
        <Card title={`流程步骤 (${String(profile.data.flowSteps.length)})`}>
          <Table
            headers={['Step', 'Flow', '状态', '开始时间', '耗时']}
            rows={profile.data.flowSteps.map((step) => [
              step.stepName,
              step.flowId,
              <span key="success" style={{ color: step.success ? '#2a7' : '#c33' }}>{step.success ? 'success' : 'failed'}</span>,
              step.startedAt,
              step.durationMs !== undefined ? `${String(step.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {profile.data && profile.data.uiActions.length > 0 && (
        <Card title={`UI 操作 (${String(profile.data.uiActions.length)})`}>
          <Table
            headers={['Type', '状态', '页面', '开始时间', '耗时']}
            rows={profile.data.uiActions.map((action) => [
              action.actionType,
              <span key="success" style={{ color: action.success ? '#2a7' : '#c33' }}>{action.success ? 'success' : 'failed'}</span>,
              <span key="page" style={{ fontSize: '0.8em', wordBreak: 'break-all' }}>{action.pageUrl ?? '-'}</span>,
              action.startedAt,
              action.durationMs !== undefined ? `${String(action.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {profile.data && profile.data.apiCalls.length > 0 && (
        <Card title={`接口调用 (${String(profile.data.apiCalls.length)})`}>
          <Table
            headers={['Method', 'URL', 'Status', '耗时', '响应摘要 / 错误']}
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

      {previewImage && <ImagePreviewModal src={previewImage} title={`${r.testcaseName} 截图预览`} onClose={() => { setPreviewImage(null); }} />}
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
