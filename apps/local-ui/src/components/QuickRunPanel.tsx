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
          <span><strong>{t('run.workspace.targetPath')}：</strong><code>{workspace.targetProjectPath || t('run.workspace.notConfigured')}</code></span>
          {testAssets?.sharedRoot && <span><strong>{t('run.workspace.sharedRoot')}：</strong><code>{testAssets.sharedRoot}</code></span>}
          <span><strong>{t('run.workspace.permission')}：</strong>{workspace.allowOutsideToolWorkspace ? <span style={{ color: '#f90' }}>{t('run.workspace.allowOutside')}</span> : <span style={{ color: '#2a7' }}>{t('run.workspace.insideOnly')}</span>}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
          {t('run.mode')}
          <select value={mode} onChange={e => { setMode(e.target.value as import('../types.js').RunMode); }} style={{ padding: '4px 8px' }}>
            <option value="regression">{t('run.mode.regression')}</option>
            <option value="exploration">{t('run.mode.exploration')}</option>
            <option value="hybrid">{t('run.mode.hybrid')}</option>
          </select>
          <span style={{ color: '#888', fontSize: '0.9em' }}>{t(`run.mode.hint.${mode}`)}</span>
        </label>
        {needsSelector && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
              {t('run.selectorType')}
              <select value={selectorType} onChange={e => { setSelectorType(e.target.value as SelectorType); }} style={{ padding: '4px 8px' }}>
                <option value="suite">suite — {t('run.selectorType.suite')}</option>
                <option value="scenario">scenario — {t('run.selectorType.scenario')}</option>
                <option value="tag">tag — {t('run.selectorType.tag')}</option>
                <option value="testcase">testcase — {t('run.selectorType.testcase')}</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em', flex: 1, minWidth: 160 }}>
              {t('run.selectorValue')}
              <input
                value={selectorValue}
                onChange={e => { setSelectorValue(e.target.value); }}
                required
                placeholder={t(`run.selectorValue.placeholder.${selectorType}`)}
                style={{ padding: '4px 8px' }}
              />
              <span style={{ color: '#888', fontSize: '0.9em' }}>{t(`run.selectorType.hint.${selectorType}`)}</span>
            </label>
          </>
        )}
      </div>
      {needsExploration && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
            {t('run.startUrls')} ({t('run.startUrls.hint')})
            <textarea value={startUrls} onChange={e => { setStartUrls(e.target.value); }} rows={3} required style={{ padding: '4px 8px', resize: 'vertical' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em' }}>
            {t('run.focusAreas')} ({t('run.focusAreas.hint')})
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
              {t('run.allowedHosts')} ({t('run.allowedHosts.hint')})
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
