import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Button } from './ui.js';

type SelectorType = 'suite' | 'scenario' | 'tag' | 'testcase';

const sel = (style: React.CSSProperties): React.CSSProperties => ({ padding: '4px 8px', ...style });
const label = (extra?: React.CSSProperties): React.CSSProperties => ({ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em', ...extra });

export function QuickRunPanel(): React.ReactElement {
  const navigate = useNavigate();

  // Step 1: project / site
  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [repoId, setRepoId] = useState('');

  // Step 2: mode + selector
  const [mode, setMode] = useState<import('../types.js').RunMode>('regression');
  const [selectorType, setSelectorType] = useState<SelectorType>('suite');
  const [selectorValue, setSelectorValue] = useState('');

  // Step 3: exploration config (auto-populated from site.baseUrl)
  const [startUrls, setStartUrls] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [maxSteps, setMaxSteps] = useState(80);
  const [maxPages, setMaxPages] = useState(20);
  const [allowedHosts, setAllowedHosts] = useState('');
  const [focusAreas, setFocusAreas] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: projects, loading: projLoading } = useAsync(() => api.listProjects(), []);
  const { data: sites } = useAsync(
    () => projectId ? api.listSites(projectId) : Promise.resolve([]),
    [projectId],
  );
  const { data: creds } = useAsync(
    () => (projectId && siteId) ? api.listCredentials(projectId, siteId) : Promise.resolve([]),
    [projectId, siteId],
  );
  const { data: repos } = useAsync(
    () => projectId ? api.listRepos(projectId) : Promise.resolve([]),
    [projectId],
  );

  // Load selector cache — only needs projectId; repoId is optional for finer scope
  const { data: selectors, reload: reloadSelectors } = useAsync(
    () => {
      if (!projectId) return Promise.resolve([]);
      if (repoId) return api.listSelectorsForRepo(projectId, repoId, selectorType);
      if (repos && repos.length > 0) return Promise.resolve([]);
      return api.listSelectorsForProject(projectId, selectorType);
    },
    [projectId, repoId, selectorType, repos],
  );
  const [scanning, setScanning] = React.useState(false);

  async function handleScan(): Promise<void> {
    if (!projectId || !repoId) return;
    setScanning(true);
    try { await api.scanSelectorsForRepo(projectId, repoId); reloadSelectors(); }
    finally { setScanning(false); }
  }

  // When site changes, pre-fill startUrls and allowedHosts from baseUrl
  React.useEffect(() => {
    if (!siteId || !sites) return;
    const site = sites.find(s => s.id === siteId);
    if (!site) return;
    setStartUrls(site.baseUrl);
    try {
      const host = new URL(site.baseUrl).hostname;
      setAllowedHosts(host);
    } catch { /* ignore invalid URL */ }
  }, [siteId, sites]);

  React.useEffect(() => {
    if (!siteId || !creds || creds.length === 0) {
      setCredentialId('');
      return;
    }
    const preferred = creds.find(c => c.isDefault) ?? creds[0];
    setCredentialId(preferred?.id ?? '');
  }, [siteId, creds]);

  // When project changes, reset dependent selections
  React.useEffect(() => {
    setSiteId('');
    setRepoId('');
    setSelectorValue('');
  }, [projectId]);

  const needsSelector = mode === 'regression' || mode === 'hybrid';
  const needsExploration = mode === 'exploration' || mode === 'hybrid';

  const selectedRepo = repos?.find(r => r.id === repoId);
  const projectPath = selectedRepo?.path ?? '';
  const requiresRepoSelection = Boolean(projectId && repos && repos.length > 0);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const input: import('../types.js').StartRunInput = { runMode: mode };
      if (projectId) input.projectId = projectId;
      if (repoId) input.repoId = repoId;
      if (siteId) input.siteId = siteId;
      if (projectPath) input.projectPath = projectPath;
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
        if (credentialId) input.exploration.credentialId = credentialId;
        if (allowedHosts) input.exploration.allowedHosts = allowedHosts.split(',').map(s => s.trim()).filter(Boolean);
        if (focusAreas) input.exploration.focusAreas = focusAreas.split('\n').map(s => s.trim()).filter(Boolean);
      }
      if (credentialId) input.credentialId = credentialId;
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

      {/* Row 1: Project + Site */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={label({ minWidth: 160 })}>
          项目
          {projLoading ? <Loading /> : (
            <select value={projectId} onChange={e => { setProjectId(e.target.value); }} style={sel({})}>
              <option value="">— 不指定 —</option>
              {projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </label>
        {projectId && (
          <label style={label({ minWidth: 160 })}>
            站点
            <select value={siteId} onChange={e => { setSiteId(e.target.value); }} style={sel({})}>
              <option value="">— 不指定 —</option>
              {sites?.map(s => <option key={s.id} value={s.id}>{s.name} ({s.baseUrl})</option>)}
            </select>
          </label>
        )}
        {siteId && creds && creds.length > 0 && (
          <label style={label({ minWidth: 140 })}>
            认证凭据
            <select value={credentialId} onChange={e => { setCredentialId(e.target.value); }} style={sel({})}>
              <option value="">— 不使用 —</option>
              {creds.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        )}
        {projectId && (
          <label style={label({ minWidth: 180 })}>
            代码仓库
            <select value={repoId} onChange={e => { setRepoId(e.target.value); setSelectorValue(''); }} style={sel({})} required={requiresRepoSelection}>
              <option value="">— 选择仓库 —</option>
              {repos?.map(r => <option key={r.id} value={r.id}>{r.name} ({r.path})</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Row 2: Mode + Selector */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <label style={label()}>
          {t('run.mode')}
          <select value={mode} onChange={e => { setMode(e.target.value as import('../types.js').RunMode); }} style={sel({})}>
            <option value="regression">{t('run.mode.regression')}</option>
            <option value="exploration">{t('run.mode.exploration')}</option>
            <option value="hybrid">{t('run.mode.hybrid')}</option>
          </select>
          <span style={{ color: '#888', fontSize: '0.9em' }}>{t(`run.mode.hint.${mode}`)}</span>
        </label>
        {needsSelector && (
          <>
            <label style={label()}>
              {t('run.selectorType')}
              <select value={selectorType} onChange={e => { setSelectorType(e.target.value as SelectorType); }} style={sel({})}>
                <option value="suite">{t('run.selectorType.suite')}</option>
                <option value="scenario">{t('run.selectorType.scenario')}</option>
                <option value="tag">{t('run.selectorType.tag')}</option>
                <option value="testcase">{t('run.selectorType.testcase')}</option>
              </select>
            </label>
            <label style={label({ flex: 1, minWidth: 160 })}>
              {t('run.selectorValue')}
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {selectors && selectors.length > 0 ? (
                  <select value={selectorValue} onChange={e => { setSelectorValue(e.target.value); }} required style={sel({ flex: 1 })}>
                    <option value="">— 选择 —</option>
                    {selectors.map(s => <option key={s.id} value={s.value}>{s.value}</option>)}
                  </select>
                ) : (
                  <input value={selectorValue} onChange={e => { setSelectorValue(e.target.value); }} required
                    placeholder={t(`run.selectorValue.placeholder.${selectorType}`)} style={sel({ flex: 1 })} />
                )}
                {projectId && repoId && (
                  <button type="button" onClick={() => { void handleScan(); }} disabled={scanning}
                    title="扫描仓库更新选择器缓存"
                    style={{ padding: '4px 8px', fontSize: '0.8em', cursor: scanning ? 'not-allowed' : 'pointer', border: '1px solid #ccc', borderRadius: 4, background: '#f5f5f5' }}>
                    {scanning ? '…' : '↻'}
                  </button>
                )}
              </div>
            </label>
          </>
        )}
      </div>

      {/* Row 3: Exploration config */}
      {needsExploration && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={label()}>
            {t('run.startUrls')} ({t('run.startUrls.hint')})
            <textarea value={startUrls} onChange={e => { setStartUrls(e.target.value); }} rows={3} required style={{ padding: '4px 8px', resize: 'vertical' }} />
          </label>
          <label style={label()}>
            {t('run.focusAreas')} ({t('run.focusAreas.hint')})
            <textarea value={focusAreas} onChange={e => { setFocusAreas(e.target.value); }} rows={2} style={{ padding: '4px 8px', resize: 'vertical' }} />
          </label>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={label()}>
              {t('run.maxSteps')}
              <input type="number" value={maxSteps} onChange={e => { setMaxSteps(Number(e.target.value)); }} min={1} style={sel({ width: 80 })} />
            </label>
            <label style={label()}>
              {t('run.maxPages')}
              <input type="number" value={maxPages} onChange={e => { setMaxPages(Number(e.target.value)); }} min={1} style={sel({ width: 80 })} />
            </label>
            <label style={label({ flex: 1, minWidth: 160 })}>
              {t('run.allowedHosts')} ({t('run.allowedHosts.hint')})
              <input value={allowedHosts} onChange={e => { setAllowedHosts(e.target.value); }} style={sel({})} />
            </label>
          </div>
        </div>
      )}

      {(projectId || repoId || projectPath) && (
        <div style={{ padding: '0.6rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa', fontSize: '0.85em', color: '#444' }}>
          <div><strong>目标工作区</strong></div>
          <div>项目：{projects?.find(p => p.id === projectId)?.name ?? '—'}</div>
          <div>站点：{sites?.find(s => s.id === siteId)?.name ?? '—'}</div>
          <div>凭据：{creds?.find(c => c.id === credentialId)?.label ?? '—'}</div>
          <div>仓库：{selectedRepo?.name ?? (requiresRepoSelection ? '未选择' : '—')}</div>
          <div style={{ wordBreak: 'break-all' }}>路径：{projectPath || '—'}</div>
          {projectId && sites && sites.length > 0 && !siteId && (
            <div style={{ color: '#b45309', marginTop: '0.35rem' }}>当前项目已配置站点，建议选择站点后再启动运行。</div>
          )}
        </div>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={loading || (requiresRepoSelection && !repoId)}>{loading ? t('common.loading') : t('run.start')}</Button>
      </div>
    </form>
  );
}
