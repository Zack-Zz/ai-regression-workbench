import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, RunStatusBadge, TaskStatusBadge, Card, KV, Button, Table } from '../components/ui.js';
import type { StepLogEntry, NetworkLogEntry } from '../types.js';

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function RunDetailPage(): React.ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const id = runId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getRun(id), [id]);
  const { data: taskData } = useAsync(() => api.listCodeTasks(`runId=${id}`), [id]);
  useServerEvents(['run.updated', 'run.step.updated'], () => reload(), (e) => !e.id || e.id === id);
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
        <KV label={t('run.startedAt')} value={summary.startedAt} />
        {summary.endedAt && <KV label={t('run.endedAt')} value={summary.endedAt} />}
        {summary.currentStage && <KV label={t('run.stage')} value={summary.currentStage} />}
        <KV label="统计" value={`✓${String(summary.passed)} ✗${String(summary.failed)} ↷${String(summary.skipped)} / ${String(summary.total)}`} />
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
            headers={['Testcase', t('common.status'), '耗时', '错误']}
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
                <span style={{ color: '#888', minWidth: 140 }}>{e.createdAt.slice(0, 19).replace('T', ' ')}</span>
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
    <Card title="探索步骤日志">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
        {network && network.length > 0 && (
          <Button onClick={() => { setNetworkModal(true); }}>
            网络请求 ({network.length})
          </Button>
        )}
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: '0.82em', fontFamily: 'monospace' }}>
        {steps.map((s, i) => <StepRow key={i} step={s} />)}
      </div>
      {networkModal && network && (
        <NetworkModal entries={network} onClose={() => { setNetworkModal(false); }} />
      )}
    </Card>
  );
}

function StepDetailModal({ step, onClose }: { step: StepLogEntry; onClose: () => void }): React.ReactElement {
  const color = step.status === 'ok' ? '#2a7' : step.status === 'error' ? '#c33' : step.status === 'warn' ? '#f90' : '#888';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 8, width: '90vw', maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid #eee', gap: '0.75rem' }}>
          <span style={{ fontWeight: 600, flex: 1 }}>{step.component} · {step.action}</span>
          <span style={{ color, fontWeight: 500 }}>{step.status}</span>
          {step.durationMs !== undefined && <span style={{ color: '#888', fontSize: '0.85em' }}>{step.durationMs}ms</span>}
          <Button onClick={onClose}>✕</Button>
        </div>
        <div style={{ overflowY: 'auto', padding: '1rem', fontSize: '0.85em', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '1rem', color: '#888', fontSize: '0.9em' }}>
            <span>{step.ts}</span>
            {step.detail && <span style={{ color: '#555' }}>{step.detail}</span>}
          </div>
          {step.pageState && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>页面状态</div>
              <div style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', lineHeight: 1.8 }}>
                <div><span style={{ color: '#888' }}>URL　</span>{step.pageState.url}</div>
                <div><span style={{ color: '#888' }}>标题　</span>{step.pageState.title || '—'}</div>
                <div><span style={{ color: '#888' }}>表单　</span>{step.pageState.formCount}　<span style={{ color: '#888' }}>链接　</span>{step.pageState.linkCount}</div>
                {step.pageState.consoleErrors > 0 && <div style={{ color: '#c33' }}>Console 错误　{step.pageState.consoleErrors} 条</div>}
                {step.pageState.networkErrors > 0 && <div style={{ color: '#c33' }}>网络错误　{step.pageState.networkErrors} 条</div>}
              </div>
            </section>
          )}
          {step.toolInput !== undefined && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>工具入参</div>
              <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', margin: 0, overflowX: 'auto', fontSize: '0.9em' }}>{JSON.stringify(step.toolInput, null, 2)}</pre>
            </section>
          )}
          {step.toolOutput !== undefined && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>工具出参</div>
              <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', margin: 0, overflowX: 'auto', fontSize: '0.9em' }}>{JSON.stringify(step.toolOutput, null, 2)}</pre>
            </section>
          )}
          {step.reason && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>决策原因</div>
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
  const color = step.status === 'ok' ? '#2a7' : step.status === 'error' ? '#c33' : step.status === 'warn' ? '#f90' : '#888';
  const hasDetail = step.toolInput !== undefined || step.toolOutput !== undefined || step.pageState !== undefined || step.reason;
  return (
    <>
      <div onClick={() => { if (hasDetail) setModal(true); }}
        style={{ display: 'flex', gap: '0.75rem', padding: '3px 0', borderBottom: '1px solid #f5f5f5', cursor: hasDetail ? 'pointer' : 'default' }}>
        <span style={{ color: '#aaa', minWidth: 80 }}>{step.ts.slice(11, 19)}</span>
        <span style={{ color: '#555', minWidth: 120 }}>{step.component}</span>
        <span style={{ color: '#333', minWidth: 120 }}>{step.action}</span>
        <span style={{ color, minWidth: 40 }}>{step.status}</span>
        {step.durationMs !== undefined && <span style={{ color: '#888', minWidth: 60 }}>{step.durationMs}ms</span>}
        {step.detail && <span style={{ color: '#666', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.detail}</span>}
        {hasDetail && <span style={{ color: '#aaa', fontSize: '0.85em' }}>⋯</span>}
      </div>
      {modal && <StepDetailModal step={step} onClose={() => { setModal(false); }} />}
    </>
  );
}

function NetworkModal({ entries, onClose }: { entries: NetworkLogEntry[]; onClose: () => void }): React.ReactElement {
  const [selected, setSelected] = React.useState<NetworkLogEntry | null>(null);
  const errors = entries.filter(e => e.status >= 400 || e.error);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 8, width: '90vw', maxWidth: 900, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid #eee' }}>
          <span style={{ fontWeight: 600, flex: 1 }}>网络请求 ({entries.length} 条，{errors.length} 个错误)</span>
          <Button onClick={onClose}>✕</Button>
        </div>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', fontSize: '0.8em', fontFamily: 'monospace' }}>
            {entries.map((e, i) => {
              const isErr = e.status >= 400 || !!e.error;
              return (
                <div key={i} onClick={() => { setSelected(e); }}
                  style={{ display: 'flex', gap: '0.5rem', padding: '4px 8px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                    background: selected === e ? '#e8f0fe' : isErr ? '#fff5f5' : 'transparent' }}>
                  <span style={{ color: isErr ? '#c33' : '#2a7', minWidth: 36, fontWeight: 600 }}>{e.status || '—'}</span>
                  <span style={{ color: '#555', minWidth: 40 }}>{e.method}</span>
                  <span style={{ color: '#888', minWidth: 50 }}>{e.durationMs}ms</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#333' }}>{e.url}</span>
                </div>
              );
            })}
          </div>
          {/* Detail panel */}
          {selected && (
            <div style={{ width: 320, borderLeft: '1px solid #eee', padding: '0.75rem', overflowY: 'auto', fontSize: '0.82em' }}>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>请求详情</div>
              <KV label="URL" value={selected.url} />
              <KV label="Method" value={selected.method} />
              <KV label="Status" value={String(selected.status)} />
              <KV label="Duration" value={`${selected.durationMs}ms`} />
              <KV label="Type" value={selected.resourceType} />
              <KV label="Time" value={selected.ts} />
              {selected.error && <KV label="Error" value={selected.error} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
