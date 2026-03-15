import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Button } from './ui.js';

type SelectorType = 'suite' | 'scenario' | 'tag' | 'testcase';

export function QuickRunPanel(): React.ReactElement {
  const navigate = useNavigate();
  const [mode, setMode] = useState<import('../types.js').RunMode>('regression');
  const [selectorType, setSelectorType] = useState<SelectorType>('suite');
  const [selectorValue, setSelectorValue] = useState('');
  const [startUrls, setStartUrls] = useState('');
  const [maxSteps, setMaxSteps] = useState(80);
  const [maxPages, setMaxPages] = useState(20);
  const [allowedHosts, setAllowedHosts] = useState('');
  const [focusAreas, setFocusAreas] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = useAsync(() => api.getSettings(), []);

  const needsSelector = mode === 'regression' || mode === 'hybrid';
  const needsExploration = mode === 'exploration' || mode === 'hybrid';

  const workspace = settings.data?.values.workspace;
  const testAssets = settings.data?.values.testAssets;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const input: import('../types.js').StartRunInput = { runMode: mode };
      if (needsSelector) {
        input.selector = {
          ...(selectorType === 'suite' ? { suite: selectorValue } : {}),
          ...(selectorType === 'scenario' ? { scenarioId: selectorValue } : {}),
          ...(selectorType === 'tag' ? { tag: selectorValue } : {}),
          ...(selectorType === 'testcase' ? { testcaseId: selectorValue } : {}),
        };
      }
      if (needsExploration) {
        input.exploration = {
          startUrls: startUrls.split('\n').map(s => s.trim()).filter(Boolean),
          maxSteps,
          maxPages,
        };
        if (allowedHosts) input.exploration.allowedHosts = allowedHosts.split(',').map(s => s.trim()).filter(Boolean);
        if (focusAreas) input.exploration.focusAreas = focusAreas.split('\n').map(s => s.trim()).filter(Boolean);
      }
      const result = await api.startRun(input);
      if (result.run) navigate(`/runs/${result.run.runId}`);
      else navigate('/runs');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {error && <ErrorBanner message={error} />}

      {/* Preflight context */}
      {settings.loading && <Loading />}
      {workspace && (
        <div style={{ padding: '0.5rem 0.75rem', background: '#f5f5f5', borderRadius: 4, fontSize: '0.85em', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <span><strong>目标目录：</strong><code>{workspace.targetProjectPath || '(未配置)'}</code></span>
          {testAssets?.sharedRoot && <span><strong>共享测试目录：</strong><code>{testAssets.sharedRoot}</code></span>}
          <span><strong>权限级别：</strong>{workspace.allowOutsideToolWorkspace ? <span style={{ color: '#f90' }}>允许工作区外写入</span> : <span style={{ color: '#2a7' }}>仅工作区内</span>}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
          {t('run.mode')}
          <select value={mode} onChange={e => { setMode(e.target.value as import('../types.js').RunMode); }} style={{ padding: '4px 8px' }}>
            <option value="regression">regression</option>
            <option value="exploration">exploration</option>
            <option value="hybrid">hybrid</option>
          </select>
        </label>
        {needsSelector && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
              {t('run.selectorType')}
              <select value={selectorType} onChange={e => { setSelectorType(e.target.value as SelectorType); }} style={{ padding: '4px 8px' }}>
                <option value="suite">suite</option>
                <option value="scenario">scenario</option>
                <option value="tag">tag</option>
                <option value="testcase">testcase</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em', flex: 1, minWidth: 160 }}>
              {t('run.selectorValue')}
              <input value={selectorValue} onChange={e => { setSelectorValue(e.target.value); }} required style={{ padding: '4px 8px' }} />
            </label>
          </>
        )}
      </div>
      {needsExploration && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
            {t('run.startUrls')} (每行一个)
            <textarea value={startUrls} onChange={e => { setStartUrls(e.target.value); }} rows={3} required style={{ padding: '4px 8px', resize: 'vertical' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
            {t('run.focusAreas')} (每行一个，可选)
            <textarea value={focusAreas} onChange={e => { setFocusAreas(e.target.value); }} rows={2} style={{ padding: '4px 8px', resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
              {t('run.maxSteps')}
              <input type="number" value={maxSteps} onChange={e => { setMaxSteps(Number(e.target.value)); }} min={1} style={{ padding: '4px 8px', width: 80 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
              {t('run.maxPages')}
              <input type="number" value={maxPages} onChange={e => { setMaxPages(Number(e.target.value)); }} min={1} style={{ padding: '4px 8px', width: 80 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em', flex: 1, minWidth: 160 }}>
              {t('run.allowedHosts')} (逗号分隔)
              <input value={allowedHosts} onChange={e => { setAllowedHosts(e.target.value); }} style={{ padding: '4px 8px' }} />
            </label>
          </div>
        </div>
      )}
      <div>
        <Button variant="primary" disabled={loading}>{loading ? t('common.loading') : t('run.start')}</Button>
      </div>
    </form>
  );
}
