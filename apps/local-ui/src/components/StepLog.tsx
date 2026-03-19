import React from 'react';
import { api } from '../api.js';
import { useAsync, useServerEvents } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, Card, KV, Button } from './ui.js';
import type { StepLogEntry, NetworkLogEntry, PromptSampleEntry } from '../types.js';
import { fmtDatetime, fmtTime } from '../utils.js';

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

export const ACTION_LABELS: Record<string, { labelKey: string; toolKey: string }> = {
  'explore.start':  { labelKey: 'step.action.explore.start',  toolKey: 'step.tool.ExplorationAgent' },
  'explore.done':   { labelKey: 'step.action.explore.done',   toolKey: 'step.tool.ExplorationAgent' },
  'navigate':       { labelKey: 'step.action.navigate',       toolKey: 'step.tool.playwright' },
  'click':          { labelKey: 'step.action.click',          toolKey: 'step.tool.playwright' },
  'fill':           { labelKey: 'step.action.fill',           toolKey: 'step.tool.playwright' },
  'llm.decide':     { labelKey: 'step.action.llm.decide',     toolKey: 'step.tool.AIProvider' },
  'findings':       { labelKey: 'step.action.findings',       toolKey: 'step.tool.FindingRepository' },
  'state.capture':  { labelKey: 'step.action.state.capture',  toolKey: 'step.tool.playwright' },
  'login.start':    { labelKey: 'step.action.login.start',    toolKey: 'step.tool.playwright' },
  'login.fill':     { labelKey: 'step.action.login.fill',     toolKey: 'step.tool.playwright' },
  'login.click':    { labelKey: 'step.action.login.click',    toolKey: 'step.tool.playwright' },
  'login.verify':   { labelKey: 'step.action.login.verify',   toolKey: 'step.tool.playwright' },
  'login.retry':    { labelKey: 'step.action.login.retry',    toolKey: 'step.tool.playwright' },
  'login.failed':   { labelKey: 'step.action.login.failed',   toolKey: 'step.tool.playwright' },
};

/** Filter out superseded pending steps. */
export function filterSteps(steps: StepLogEntry[]): StepLogEntry[] {
  return steps.filter((s, i) => {
    if (s.status !== 'pending') return true;
    if (s.actionId) return !steps.some(t => t.actionId === s.actionId && t.status !== 'pending');
    return !(i + 1 < steps.length && steps[i + 1]?.action === s.action && steps[i + 1]?.component === s.component);
  });
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : null;
}

function describePromptTemplate(template?: string): string {
  if (!template) return '—';
  if (template === 'exploration-login/default@v1') return `${template} (${t('step.modal.llm.template.systemLogin')})`;
  if (template === 'exploration-decision/default@v1') return `${template} (${t('step.modal.llm.template.systemDecision')})`;
  return `${template} (${t('step.modal.llm.template.systemKey')})`;
}

function parsePromptSummary(summary?: string): Array<{ key: string; value: string }> {
  if (!summary) return [];
  return summary
    .split(/\s+/)
    .map((segment) => {
      const idx = segment.indexOf('=');
      if (idx === -1) return null;
      const key = segment.slice(0, idx);
      const value = segment.slice(idx + 1);
      return { key, value };
    })
    .filter((item): item is { key: string; value: string } => item !== null);
}

function promptSummaryLabel(key: string): string {
  const labels: Record<string, string> = {
    remainingSteps: 'step.modal.promptSummary.remainingSteps',
    remainingPages: 'step.modal.promptSummary.remainingPages',
    visited: 'step.modal.promptSummary.visited',
    recentSteps: 'step.modal.promptSummary.recentSteps',
    recentFindings: 'step.modal.promptSummary.recentFindings',
    recentToolResults: 'step.modal.promptSummary.recentToolResults',
    recentNetwork: 'step.modal.promptSummary.recentNetwork',
    actions: 'step.modal.promptSummary.actions',
    focusAreas: 'step.modal.promptSummary.focusAreas',
    url: 'step.modal.promptSummary.url',
    currentUrl: 'step.modal.promptSummary.currentUrl',
    inputs: 'step.modal.promptSummary.inputs',
    buttons: 'step.modal.promptSummary.buttons',
    forms: 'step.modal.promptSummary.forms',
  };
  return labels[key] ? t(labels[key]!) : key;
}

function tryParseJsonText(value: string): string | null {
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function renderSummaryValue(value: unknown): React.ReactElement {
  if (typeof value === 'string') {
    const pretty = tryParseJsonText(value);
    if (pretty) {
      return (
        <pre style={{ margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {pretty}
        </pre>
      );
    }
    return (
      <span style={{ fontFamily: 'monospace' }} title={value}>
        {value.length > 160 ? `${value.slice(0, 160)}…` : value}
      </span>
    );
  }
  if (value !== null && typeof value === 'object') {
    return (
      <pre style={{ margin: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span style={{ fontFamily: 'monospace' }}>{String(value)}</span>;
}

export function StepDetailModal({ step, onClose }: { step: StepLogEntry; onClose: () => void }): React.ReactElement {
  const color = step.status === 'ok' ? '#2a7' : step.status === 'error' ? '#c33' : step.status === 'warn' ? '#f90' : step.status === 'pending' ? '#4080c0' : '#888';
  const actionMeta = ACTION_LABELS[step.action];
  const isLlmDecision = step.action === 'llm.decide';
  const toolInputRecord = asRecord(step.toolInput);
  const toolOutputRecord = asRecord(step.toolOutput);
  const promptSummaryItems = parsePromptSummary(step.promptContextSummary);
  const showLlmRequestSummary = isLlmDecision && !!toolInputRecord;
  const showLlmResponseSummary = isLlmDecision && !!toolOutputRecord;
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
          {(step.promptTemplateVersion || step.promptContextSummary) && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>
                {isLlmDecision ? t('step.modal.llm.context') : t('step.modal.promptContext')}
              </div>
              <div style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', lineHeight: 1.8 }}>
                {step.promptTemplateVersion && (
                  <div>
                    <span style={{ color: '#888' }}>{t('step.modal.template')}　</span>
                    <span style={{ fontFamily: 'monospace' }}>{describePromptTemplate(step.promptTemplateVersion)}</span>
                  </div>
                )}
                {promptSummaryItems.length > 0 && promptSummaryItems.map((item, idx) => (
                  <div key={`${item.key}-${idx}`}>
                    <span style={{ color: '#888' }}>{promptSummaryLabel(item.key)}　</span>
                    <span style={{ fontFamily: 'monospace' }}>{item.value}</span>
                  </div>
                ))}
                {promptSummaryItems.length === 0 && step.promptContextSummary && (
                  <div><span style={{ color: '#888' }}>{t('step.modal.summary')}　</span><span style={{ fontFamily: 'monospace' }}>{step.promptContextSummary}</span></div>
                )}
              </div>
              {isLlmDecision && (
                <div style={{ marginTop: 6, color: '#666', fontSize: '0.82em' }}>
                  {t('step.modal.llm.fullPromptHint')}
                </div>
              )}
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
                {step.pageState.headings && step.pageState.headings.length > 0 && <div><span style={{ color: '#888' }}>Headings　</span>{step.pageState.headings.join(' | ')}</div>}
                {step.pageState.primaryButtons && step.pageState.primaryButtons.length > 0 && <div><span style={{ color: '#888' }}>Primary Buttons　</span>{step.pageState.primaryButtons.join(' | ')}</div>}
                {step.pageState.navLinks && step.pageState.navLinks.length > 0 && <div><span style={{ color: '#888' }}>Nav Links　</span>{step.pageState.navLinks.join(' | ')}</div>}
                {step.pageState.inputHints && step.pageState.inputHints.length > 0 && <div><span style={{ color: '#888' }}>Input Hints　</span>{step.pageState.inputHints.join(' | ')}</div>}
                {step.pageState.ctaCandidates && step.pageState.ctaCandidates.length > 0 && <div><span style={{ color: '#888' }}>CTA Candidates　</span>{step.pageState.ctaCandidates.join(' | ')}</div>}
                {step.pageState.textSnippet && <div><span style={{ color: '#888' }}>Text Snippet　</span>{step.pageState.textSnippet}</div>}
              </div>
            </section>
          )}
          {step.toolInput !== undefined && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>
                {isLlmDecision ? t('step.modal.llm.requestSummary') : t('step.modal.toolInput')}
              </div>
              {showLlmRequestSummary && (
                <div style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', marginBottom: 8, lineHeight: 1.8 }}>
                  {Object.entries(toolInputRecord).map(([k, v]) => (
                    <div key={k}>
                      <span style={{ color: '#888' }}>{promptSummaryLabel(k)}　</span>
                      {renderSummaryValue(v)}
                    </div>
                  ))}
                </div>
              )}
              {!showLlmRequestSummary && (
                <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', margin: 0, overflowX: 'auto', fontSize: '0.9em' }}>{JSON.stringify(step.toolInput, null, 2)}</pre>
              )}
              {showLlmRequestSummary && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', color: '#666' }}>{t('step.modal.llm.rawRequest')}</summary>
                  <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', marginTop: 6, overflowX: 'auto', fontSize: '0.9em' }}>{JSON.stringify(step.toolInput, null, 2)}</pre>
                </details>
              )}
            </section>
          )}
          {step.toolOutput !== undefined && (
            <section>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#444' }}>
                {isLlmDecision ? t('step.modal.llm.responseSummary') : t('step.modal.toolOutput')}
              </div>
              {showLlmResponseSummary && (
                <div style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', marginBottom: 8, lineHeight: 1.8 }}>
                  {Object.entries(toolOutputRecord).slice(0, 6).map(([k, v]) => (
                    <div key={k}>
                      <span style={{ color: '#888' }}>{k}　</span>
                      {renderSummaryValue(v)}
                    </div>
                  ))}
                </div>
              )}
              {!showLlmResponseSummary && (
                <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', margin: 0, overflowX: 'auto', fontSize: '0.9em' }}>{JSON.stringify(step.toolOutput, null, 2)}</pre>
              )}
              {showLlmResponseSummary && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', color: '#666' }}>{t('step.modal.llm.rawResponse')}</summary>
                  <pre style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 12px', marginTop: 6, overflowX: 'auto', fontSize: '0.9em' }}>{JSON.stringify(step.toolOutput, null, 2)}</pre>
                </details>
              )}
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

export function StepRow({ step }: { step: StepLogEntry }): React.ReactElement {
  const [modal, setModal] = React.useState(false);
  const color = step.status === 'ok' ? '#2a7' : step.status === 'error' ? '#c33' : step.status === 'warn' ? '#f90' : step.status === 'pending' ? '#4080c0' : '#888';
  const hasDetail = step.toolInput !== undefined || step.toolOutput !== undefined || step.pageState !== undefined || step.reason || step.promptTemplateVersion || step.promptContextSummary;
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

export function NetworkModal({ entries, onClose }: { entries: NetworkLogEntry[]; onClose: () => void }): React.ReactElement {
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

function PromptSamplesModal({ entries, onClose }: { entries: PromptSampleEntry[]; onClose: () => void }): React.ReactElement {
  const [selected, setSelected] = React.useState<PromptSampleEntry | null>(entries[0] ?? null);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 8, width: '92vw', maxWidth: 1200, height: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid #eee', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, flex: 1 }}>{t('prompt.modal.title')} ({entries.length})</span>
          <Button onClick={onClose}>✕</Button>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: 320, borderRight: '1px solid #eee', overflowY: 'auto', fontSize: '0.82em' }}>
            {entries.map((entry, i) => (
              <div key={i} onClick={() => { setSelected(entry); }}
                style={{ padding: '8px 10px', borderBottom: '1px solid #f3f3f3', cursor: 'pointer', background: selected === entry ? '#e8f0fe' : '#fff' }}>
                <div style={{ fontWeight: 600 }}>{entry.phase}</div>
                <div style={{ color: '#666' }}>{t('prompt.modal.step')} {entry.stepIndex} · {entry.sampledBy}</div>
                <div style={{ color: '#888', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.templateVersion}</div>
              </div>
            ))}
          </div>
          {selected && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1rem', color: '#666', fontSize: '0.9em', flexWrap: 'wrap' }}>
                <span>{fmtDatetime(selected.timestamp)}</span>
                <span>{selected.phase}</span>
                <span>{selected.sampledBy}</span>
                <span style={{ fontFamily: 'monospace' }}>{selected.templateVersion}</span>
              </div>
              {selected.promptContextSummary && (
                <div style={{ background: '#f8f8f8', borderRadius: 4, padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.9em' }}>
                  {selected.promptContextSummary}
                </div>
              )}
              {selected.metadata && (
                <CopyPrettyBlock label={t('prompt.modal.metadata')} value={JSON.stringify(selected.metadata, null, 2)} isJson />
              )}
              <CopyPrettyBlock label={t('prompt.modal.prompt')} value={selected.prompt} />
              {selected.response !== undefined && <CopyPrettyBlock label={t('prompt.modal.response')} value={selected.response} isJson={selected.response.trimStart().startsWith('{') || selected.response.trimStart().startsWith('[')} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Reusable step log panel. Fetches steps and network for a run and renders them.
 * Can be embedded in any page that has a runId.
 */
export function StepLogPanel({ runId, runSummary }: { runId: string; runSummary?: string }): React.ReactElement {
  const { data: steps, loading, reload: reloadSteps } = useAsync(() => api.getRunSteps(runId), [runId]);
  const { data: network, reload: reloadNetwork } = useAsync(() => api.getRunNetwork(runId), [runId]);
  const { data: promptSamples, reload: reloadPromptSamples } = useAsync(() => api.getRunPromptSamples(runId), [runId]);
  useServerEvents(
    ['run.step.updated', 'run.updated'],
    () => {
      reloadSteps();
      reloadNetwork();
      reloadPromptSamples();
    },
    (event) => event.id === runId,
    () => {
      reloadSteps();
      reloadNetwork();
      reloadPromptSamples();
    },
  );
  const [networkModal, setNetworkModal] = React.useState(false);
  const [promptModal, setPromptModal] = React.useState(false);

  if (loading && !steps) return <Loading />;
  if (!steps || steps.length === 0) {
    const reason = runSummary ? t(`run.summary.${runSummary}`) : null;
    return (
      <Card title={t('exploration.steps.title')}>
        <div style={{ color: '#888', fontSize: 13, padding: '8px 0' }}>
          {reason ?? t('exploration.steps.empty')}
        </div>
      </Card>
    );
  }

  return (
    <Card title={t('exploration.steps.title')}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
        {promptSamples && promptSamples.length > 0 && (
          <Button onClick={() => { setPromptModal(true); }}>
            {t('exploration.steps.promptSamples')} ({promptSamples.length})
          </Button>
        )}
        {network && network.length > 0 && (
          <Button onClick={() => { setNetworkModal(true); }}>
            {t('exploration.steps.network')} ({network.length}{t('exploration.steps.networkCount') ? ` ${t('exploration.steps.networkCount')}` : ''})
          </Button>
        )}
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: '0.82em', fontFamily: 'monospace' }}>
        {filterSteps(steps).map((s, i) => <StepRow key={i} step={s} />)}
      </div>
      {networkModal && network && (
        <NetworkModal entries={network} onClose={() => { setNetworkModal(false); }} />
      )}
      {promptModal && promptSamples && promptSamples.length > 0 && (
        <PromptSamplesModal entries={promptSamples} onClose={() => { setPromptModal(false); }} />
      )}
    </Card>
  );
}
