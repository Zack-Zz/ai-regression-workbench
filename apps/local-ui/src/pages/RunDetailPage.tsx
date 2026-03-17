import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, RunStatusBadge, TaskStatusBadge, Card, KV, Button, Table } from '../components/ui.js';
import type { StepLogEntry, NetworkLogEntry } from '../types.js';
import { fmtDatetime, fmtTime } from '../utils.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function RunDetailPage(): React.ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const id = runId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getRun(id), [id]);
  const { data: taskData } = useAsync(() => api.listCodeTasks(`runId=${id}`), [id]);
  useServerEvents(['run.updated', 'run.step.updated'], () => reload(), (e) => !e.id || e.id === id, () => { void reload(); });
  const isActive = data ? !TERMINAL.has(data.summary.status) : false;

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
            headers={['Testcase', t('common.status'), t('common.duration'), t('common.error')]}
            rows={testResults.map(r => [
              <button key="tc" onClick={() => { navigate(`/runs/${id}/testcases/${r.testcaseId}/failure-report`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline' }}>{r.testcaseId}</button>,
              <span key="s" style={{ color: r.status === 'passed' ? '#2a7' : r.status === 'failed' ? '#c33' : '#888' }}>{r.status}</span>,
              r.durationMs !== undefined ? `${String(r.durationMs)}ms` : '-',
              r.errorMessage ?? '-',
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
        <ExplorationSessionPanel runId={id} />
      )}
    </div>
  );
}

function ExplorationSessionPanel({ runId }: { runId: string }): React.ReactElement {
  const { data: steps, loading } = useAsync(() => api.getRunSteps(runId), [runId]);
  const { data: network } = useAsync(() => api.getRunNetwork(runId), [runId]);
  const [networkModal, setNetworkModal] = React.useState(false);

  if (loading) return <Loading />;
  if (!steps || steps.length === 0) return <></>;

  return (
    <Card title={t('exploration.steps.title')}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
        {network && network.length > 0 && (
          <Button onClick={() => { setNetworkModal(true); }}>
            {t('exploration.steps.network')} ({network.length}{t('exploration.steps.networkCount') ? ` ${t('exploration.steps.networkCount')}` : ''})
          </Button>
        )}
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: '0.82em', fontFamily: 'monospace' }}>
        {steps
          .filter((s, i) => {
            if (s.status !== 'pending') return true;
            if (s.actionId) return !steps.some(t => t.actionId === s.actionId && t.status !== 'pending');
            return !(i + 1 < steps.length && steps[i + 1]?.action === s.action && steps[i + 1]?.component === s.component);
          })
          .map((s, i) => <StepRow key={i} step={s} />)}
      </div>
      {networkModal && network && (
        <NetworkModal entries={network} onClose={() => { setNetworkModal(false); }} />
      )}
    </Card>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

const ACTION_LABELS: Record<string, { labelKey: string; toolKey: string }> = {
  'explore.start':  { labelKey: 'step.action.explore.start', toolKey: 'step.tool.ExplorationAgent' },
  'explore.done':   { labelKey: 'step.action.explore.done',  toolKey: 'step.tool.ExplorationAgent' },
  'navigate':       { labelKey: 'step.action.navigate',      toolKey: 'step.tool.playwright' },
  'llm.decide':     { labelKey: 'step.action.llm.decide',    toolKey: 'step.tool.AIProvider' },
  'findings':       { labelKey: 'step.action.findings',      toolKey: 'step.tool.FindingRepository' },
};

function StepDetailModal({ step, onClose }: { step: StepLogEntry; onClose: () => void }): React.ReactElement {
  const color = step.status === 'ok' ? '#2a7' : step.status === 'error' ? '#c33' : step.status === 'warn' ? '#f90' : step.status === 'pending' ? '#4080c0' : '#888';
  const actionMeta = ACTION_LABELS[step.action];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 8, width: '90vw', maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid #eee', gap: '0.75rem' }}>
          <span style={{ fontWeight: 600, flex: 1 }}>{step.component} · {step.action}</span>
          <span style={{ color, fontWeight: 500 }}>{step.status}</span>
          {step.durationMs !== undefined && <span style={{ color: '#888', fontSize: '0.85em' }}>{fmtDuration(step.durationMs)}</span>}
          <Button onClick={onClose}>✕</Button>
        </div>
        <div style={{ overflowY: 'auto', padding: '1rem', fontSize: '0.85em', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '1rem', color: '#888', fontSize: '0.9em' }}>
            <span>{fmtDatetime(step.ts)}</span>
            {step.detail && <span style={{ color: '#555' }}>{step.detail}</span>}
          </div>
          {actionMeta && (
            <section>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: '#333' }}>{t(actionMeta.labelKey)}</span>
                <span style={{ background: '#f0f4ff', color: '#4060c0', borderRadius: 4, padding: '2px 8px', fontSize: '0.9em', fontFamily: 'monospace' }}>
                  {step.tool ?? t(actionMeta.toolKey)}
                </span>
                {step.model && (
                  <span style={{ background: '#f0fff4', color: '#2a7a4a', borderRadius: 4, padding: '2px 8px', fontSize: '0.9em', fontFamily: 'monospace' }}>
                    {step.model}
                  </span>
                )}
              </div>
            </section>
          )}
          {step.pageState && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>{t('step.modal.pageState')}</div>
              <div style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', lineHeight: 1.8 }}>
                <div><span style={{ color: '#888' }}>{t('step.modal.pageState.url')}　</span>{step.pageState.url}</div>
                <div><span style={{ color: '#888' }}>{t('step.modal.pageState.title')}　</span>{step.pageState.title || '—'}</div>
                <div><span style={{ color: '#888' }}>{t('step.modal.pageState.forms')}　</span>{step.pageState.formCount}　<span style={{ color: '#888' }}>{t('step.modal.pageState.links')}　</span>{step.pageState.linkCount}</div>
                {step.pageState.consoleErrors > 0 && <div style={{ color: '#c33' }}>{t('step.modal.pageState.consoleErrors')}　{step.pageState.consoleErrors}{t('step.modal.pageState.count') ? `　${t('step.modal.pageState.count')}` : ''}</div>}
                {step.pageState.networkErrors > 0 && <div style={{ color: '#c33' }}>{t('step.modal.pageState.networkErrors')}　{step.pageState.networkErrors}{t('step.modal.pageState.count') ? `　${t('step.modal.pageState.count')}` : ''}</div>}
              </div>
            </section>
          )}
          {step.toolInput !== undefined && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>{t('step.modal.toolInput')}</div>
              <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', margin: 0, overflowX: 'auto', fontSize: '0.9em' }}>{JSON.stringify(step.toolInput, null, 2)}</pre>
            </section>
          )}
          {step.toolOutput !== undefined && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>{t('step.modal.toolOutput')}</div>
              <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', margin: 0, overflowX: 'auto', fontSize: '0.9em' }}>{JSON.stringify(step.toolOutput, null, 2)}</pre>
            </section>
          )}
          {step.reason && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>{t('step.modal.reason')}</div>
              <div style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', color: '#444', fontStyle: 'italic', lineHeight: 1.6 }}>{step.reason}</div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function StepRow({ step }: { step: StepLogEntry }): React.ReactElement {
  const [modal, setModal] = React.useState(false);
  const color = step.status === 'ok' ? '#2a7' : step.status === 'error' ? '#c33' : step.status === 'warn' ? '#f90' : step.status === 'pending' ? '#4080c0' : '#888';
  const hasDetail = step.toolInput !== undefined || step.toolOutput !== undefined || step.pageState !== undefined || step.reason;
  return (
    <>
      <div onClick={() => { if (hasDetail) setModal(true); }}
        style={{ display: 'flex', gap: '0.75rem', padding: '3px 0', borderBottom: '1px solid #f5f5f5', cursor: hasDetail ? 'pointer' : 'default' }}>
        <span style={{ color: '#aaa', minWidth: 80 }}>{fmtTime(step.ts)}</span>
        <span style={{ color: '#555', minWidth: 120 }}>{step.component}</span>
        <span style={{ color: '#333', minWidth: 120 }}>{ACTION_LABELS[step.action] ? t(ACTION_LABELS[step.action]!.labelKey) : step.action}</span>
        <span style={{ color, minWidth: 40 }}>{step.status}</span>
        {step.durationMs !== undefined && <span style={{ color: '#888', minWidth: 60 }}>{fmtDuration(step.durationMs)}</span>}
        {step.detail && <span style={{ color: '#666', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.detail}</span>}
        {hasDetail && <span style={{ color: '#aaa', fontSize: '0.85em' }}>⋯</span>}
      </div>
      {modal && <StepDetailModal step={step} onClose={() => { setModal(false); }} />}
    </>
  );
}

function CopyPrettyBlock({ label, value, isJson }: { label: string; value: string; isJson?: boolean }): React.ReactElement {
  const [pretty, setPretty] = React.useState(false);
  const display = React.useMemo(() => {
    if (!pretty || !isJson) return value;
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }, [pretty, value, isJson]);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: '0.9em' }}>{label}</span>
        {isJson && <button onClick={() => { setPretty(p => !p); }} style={{ fontSize: '0.75em', padding: '1px 6px', borderRadius: 3, border: '1px solid #ddd', cursor: 'pointer', background: pretty ? '#e8f0fe' : '#fff' }}>{t('network.modal.pretty')}</button>}
        <button onClick={() => { void navigator.clipboard.writeText(value); }} style={{ fontSize: '0.75em', padding: '1px 6px', borderRadius: 3, border: '1px solid #ddd', cursor: 'pointer', background: '#fff' }}>{t('network.modal.copy')}</button>
      </div>
      <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '6px 8px', margin: 0, overflowX: 'auto', fontSize: '0.85em', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflowY: 'auto' }}>{display}</pre>
    </div>
  );
}

function NetworkModal({ entries, onClose }: { entries: NetworkLogEntry[]; onClose: () => void }): React.ReactElement {
  const [selected, setSelected] = React.useState<NetworkLogEntry | null>(null);
  const [filter, setFilter] = React.useState<'all' | 'xhr' | 'fetch' | 'error'>('all');
  const [search, setSearch] = React.useState('');
  const [detailOpen, setDetailOpen] = React.useState(true);

  const filtered = entries.filter(e => {
    if (filter === 'xhr' && e.resourceType !== 'xhr') return false;
    if (filter === 'fetch' && e.resourceType !== 'fetch') return false;
    if (filter === 'error' && !(e.status >= 400 || e.error)) return false;
    if (search && !e.url.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const errors = entries.filter(e => e.status >= 400 || e.error);

  const filterBtn = (f: typeof filter, label: string): React.ReactElement => (
    <button onClick={() => { setFilter(f); }} style={{ padding: '2px 10px', borderRadius: 4, border: '1px solid #ddd', background: filter === f ? '#4060c0' : '#fff', color: filter === f ? '#fff' : '#333', cursor: 'pointer', fontSize: '0.85em' }}>{label}</button>
  );

  const isXhrLike = selected?.resourceType === 'xhr' || selected?.resourceType === 'fetch';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 8, width: '90vw', maxWidth: 1100, height: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid #eee', flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, flex: 1 }}>{t('network.modal.title')} ({filtered.length}/{entries.length}，{errors.length} {t('network.modal.errors')})</span>
          <input value={search} onChange={e => { setSearch(e.target.value); }} placeholder={t('network.modal.filterUrl')} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #ddd', fontSize: '0.85em', width: 180 }} />
          {filterBtn('all', 'All')}
          {filterBtn('xhr', 'XHR')}
          {filterBtn('fetch', 'Fetch')}
          {filterBtn('error', 'Error')}
          <Button onClick={onClose}>✕</Button>
        </div>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', fontSize: '0.8em', fontFamily: 'monospace', minWidth: 0 }}>
            {filtered.map((e, i) => {
              const isErr = e.status >= 400 || !!e.error;
              return (
                <div key={i} onClick={() => { setSelected(e); setDetailOpen(true); }}
                  style={{ display: 'flex', gap: '0.5rem', padding: '4px 8px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                    background: selected === e ? '#e8f0fe' : isErr ? '#fff5f5' : 'transparent' }}>
                  <span style={{ color: isErr ? '#c33' : '#2a7', minWidth: 36, fontWeight: 600 }}>{e.status || '—'}</span>
                  <span style={{ color: '#555', minWidth: 40 }}>{e.method}</span>
                  <span style={{ color: '#888', minWidth: 50 }}>{fmtDuration(e.durationMs)}</span>
                  <span style={{ color: '#aaa', minWidth: 36 }}>{e.resourceType}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#333' }}>{e.url}</span>
                </div>
              );
            })}
          </div>
          {/* Detail panel */}
          {selected && (
            <div style={{ width: detailOpen ? 400 : 32, borderLeft: '1px solid #eee', display: 'flex', flexDirection: 'column', flexShrink: 0, transition: 'width 0.15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid #eee', gap: 6, flexShrink: 0 }}>
                <button onClick={() => { setDetailOpen(o => !o); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1em', color: '#666' }}>{detailOpen ? '›' : '‹'}</button>
                {detailOpen && <span style={{ fontWeight: 600, fontSize: '0.85em' }}>{t('network.modal.detail')}</span>}
              </div>
              {detailOpen && (
                <div style={{ overflowY: 'auto', padding: '0.75rem', fontSize: '0.82em', display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1, minHeight: 0 }}>
                  <KV label="URL" value={selected.url} />
                  <KV label={t('common.method')} value={selected.method} />
                  <KV label={t('common.status')} value={String(selected.status)} />
                  <KV label={t('common.duration')} value={fmtDuration(selected.durationMs)} />
                  <KV label={t('common.type')} value={selected.resourceType} />
                  <KV label={t('common.time')} value={fmtDatetime(selected.ts)} />
                  {selected.error && <KV label={t('common.error')} value={selected.error} />}
                  {isXhrLike && selected.requestHeaders && Object.keys(selected.requestHeaders).length > 0 && (
                    <CopyPrettyBlock label={t('network.modal.reqHeaders')} value={JSON.stringify(selected.requestHeaders, null, 2)} isJson />
                  )}
                  {isXhrLike && selected.requestBody && (
                    <CopyPrettyBlock label={t('network.modal.reqBody')} value={selected.requestBody} isJson={selected.requestBody.trimStart().startsWith('{') || selected.requestBody.trimStart().startsWith('[')} />
                  )}
                  {isXhrLike && selected.responseHeaders && Object.keys(selected.responseHeaders).length > 0 && (
                    <CopyPrettyBlock label={t('network.modal.resHeaders')} value={JSON.stringify(selected.responseHeaders, null, 2)} isJson />
                  )}
                  {isXhrLike && selected.responseBody && (
                    <CopyPrettyBlock label={t('network.modal.resBody')} value={selected.responseBody} isJson={selected.responseBody.trimStart().startsWith('{') || selected.responseBody.trimStart().startsWith('[')} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
