import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Button } from './ui.js';

type SelectorType = 'suite' | 'scenario' | 'tag' | 'testcase';

export function QuickRunPanel(): React.ReactElement {
  const navigate = useNavigate();

  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [repoId, setRepoId] = useState('');

  const [mode, setMode] = useState<import('../types.js').RunMode>('regression');
  const [selectorType, setSelectorType] = useState<SelectorType>('suite');
  const [selectorValue, setSelectorValue] = useState('');

  const [startUrls, setStartUrls] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [browserMode, setBrowserMode] = useState<'headless' | 'headed'>('headless');
  const [captchaAutoSolve, setCaptchaAutoSolve] = useState(true);
  const [captchaAutoSolveAttempts, setCaptchaAutoSolveAttempts] = useState(2);
  const [manualInterventionOnCaptcha, setManualInterventionOnCaptcha] = useState(true);
  const [manualLoginTimeoutSec, setManualLoginTimeoutSec] = useState(180);
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
    try {
      await api.scanSelectorsForRepo(projectId, repoId);
      reloadSelectors();
    } finally {
      setScanning(false);
    }
  }

  React.useEffect(() => {
    if (!siteId || !sites) return;
    const site = sites.find((value) => value.id === siteId);
    if (!site) return;

    setStartUrls(site.baseUrl);

    try {
      const host = new URL(site.baseUrl).hostname;
      setAllowedHosts(host);
    } catch {
      // Ignore invalid URLs and keep any manual input.
    }
  }, [siteId, sites]);

  React.useEffect(() => {
    if (!siteId || !creds || creds.length === 0) {
      setCredentialId('');
      return;
    }
    const preferred = creds.find((value) => value.isDefault) ?? creds[0];
    setCredentialId(preferred?.id ?? '');
  }, [siteId, creds]);

  React.useEffect(() => {
    setSiteId('');
    setRepoId('');
    setSelectorValue('');
  }, [projectId]);

  const needsSelector = mode === 'regression' || mode === 'hybrid';
  const needsExploration = mode === 'exploration' || mode === 'hybrid';

  const selectedProject = projects?.find((project) => project.id === projectId);
  const selectedSite = sites?.find((site) => site.id === siteId);
  const selectedCredential = creds?.find((credential) => credential.id === credentialId);
  const selectedRepo = repos?.find((repo) => repo.id === repoId);
  const projectPath = selectedRepo?.path ?? '';
  const requiresRepoSelection = Boolean(projectId && repos && repos.length > 0);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
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
          startUrls: startUrls.split('\n').map((value) => value.trim()).filter(Boolean),
          maxSteps,
          maxPages,
          browserMode,
          captchaAutoSolve,
          captchaAutoSolveAttempts,
          manualInterventionOnCaptcha,
          manualLoginTimeoutMs: manualLoginTimeoutSec * 1000,
        };
        if (credentialId) input.exploration.credentialId = credentialId;
        if (allowedHosts) input.exploration.allowedHosts = allowedHosts.split(',').map((value) => value.trim()).filter(Boolean);
        if (focusAreas) input.exploration.focusAreas = focusAreas.split('\n').map((value) => value.trim()).filter(Boolean);
      }

      if (credentialId) input.credentialId = credentialId;

      const result = await api.startRun(input);
      if (result.run) navigate(`/runs/${result.run.runId}`);
      else navigate('/runs');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(event) => { void handleSubmit(event); }} className="quick-run-form">
      {error && <ErrorBanner message={error} />}

      <section className="form-section">
        <div className="form-section__header">
          <span className="form-section__eyebrow">{t('run.section.target.step')}</span>
          <h3 className="form-section__title">{t('run.section.target.title')}</h3>
          <p className="form-section__description">{t('run.section.target.description')}</p>
        </div>

        <div className="form-grid form-grid--fit">
          <label className="field">
            <span className="field__label">{t('run.form.project')}</span>
            {projLoading ? (
              <Loading />
            ) : (
              <select value={projectId} onChange={(event) => { setProjectId(event.target.value); }} className="field-control">
                <option value="">{t('run.form.project.placeholder')}</option>
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          {projectId && (
            <label className="field">
              <span className="field__label">{t('run.form.site')}</span>
              <select value={siteId} onChange={(event) => { setSiteId(event.target.value); }} className="field-control">
                <option value="">{t('run.form.site.placeholder')}</option>
                {sites?.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} ({site.baseUrl})
                  </option>
                ))}
              </select>
            </label>
          )}

          {siteId && creds && creds.length > 0 && (
            <label className="field">
              <span className="field__label">{t('run.form.credential')}</span>
              <select value={credentialId} onChange={(event) => { setCredentialId(event.target.value); }} className="field-control">
                <option value="">{t('run.form.credential.placeholder')}</option>
                {creds.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {projectId && (
            <label className="field">
              <span className="field__label">{t('run.form.repo')}</span>
              <select
                value={repoId}
                onChange={(event) => {
                  setRepoId(event.target.value);
                  setSelectorValue('');
                }}
                className="field-control"
                required={requiresRepoSelection}
              >
                <option value="">{t('run.form.repo.placeholder')}</option>
                {repos?.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name} ({repo.path})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="form-section">
        <div className="form-section__header">
          <span className="form-section__eyebrow">{t('run.section.mode.step')}</span>
          <h3 className="form-section__title">{t('run.section.mode.title')}</h3>
          <p className="form-section__description">{t('run.section.mode.description')}</p>
        </div>

        <div className="form-grid">
          <label className="field field--span-12">
            <span className="field__label">{t('run.mode')}</span>
            <select
              value={mode}
              onChange={(event) => { setMode(event.target.value as import('../types.js').RunMode); }}
              className="field-control"
            >
              <option value="regression">{t('run.mode.regression')}</option>
              <option value="exploration">{t('run.mode.exploration')}</option>
              <option value="hybrid">{t('run.mode.hybrid')}</option>
            </select>
            <span className="field__hint">{t(`run.mode.hint.${mode}`)}</span>
          </label>

          {needsSelector && (
            <>
              <label className="field field--span-3">
                <span className="field__label">{t('run.selectorType')}</span>
                <select
                  value={selectorType}
                  onChange={(event) => { setSelectorType(event.target.value as SelectorType); }}
                  className="field-control"
                >
                  <option value="suite">{t('run.selectorType.suite')}</option>
                  <option value="scenario">{t('run.selectorType.scenario')}</option>
                  <option value="tag">{t('run.selectorType.tag')}</option>
                  <option value="testcase">{t('run.selectorType.testcase')}</option>
                </select>
              </label>

              <label className="field field--span-8">
                <span className="field__label">{t('run.selectorValue')}</span>
                <div className="field-inline">
                  {selectors && selectors.length > 0 ? (
                    <select
                      value={selectorValue}
                      onChange={(event) => { setSelectorValue(event.target.value); }}
                      required
                      className="field-control"
                    >
                      <option value="">{t('run.form.selector.placeholder')}</option>
                      {selectors.map((selector) => (
                        <option key={selector.id} value={selector.value}>
                          {selector.value}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={selectorValue}
                      onChange={(event) => { setSelectorValue(event.target.value); }}
                      required
                      placeholder={t(`run.selectorValue.placeholder.${selectorType}`)}
                      className="field-control"
                    />
                  )}
                  {projectId && repoId && (
                    <Button
                      type="button"
                      onClick={() => { void handleScan(); }}
                      disabled={scanning}
                      size="sm"
                      title={t('run.refreshSelectors.title')}
                    >
                      {scanning ? t('run.refreshingSelectors') : t('run.refreshSelectors')}
                    </Button>
                  )}
                </div>
                <span className="field__hint">{t('run.selectorCacheHint')}</span>
              </label>
            </>
          )}
        </div>
      </section>

      {needsExploration && (
        <section className="form-section">
          <div className="form-section__header">
            <span className="form-section__eyebrow">{t('run.section.exploration.step')}</span>
            <h3 className="form-section__title">{t('run.section.exploration.title')}</h3>
            <p className="form-section__description">{t('run.section.exploration.description')}</p>
          </div>

          <div className="form-grid">
            <label className="field field--span-12">
              <span className="field__label">
                {t('run.startUrls')} ({t('run.startUrls.hint')})
              </span>
              <textarea
                value={startUrls}
                onChange={(event) => { setStartUrls(event.target.value); }}
                rows={3}
                required
                className="field-control field-control--textarea"
              />
            </label>

            <label className="field field--span-12">
              <span className="field__label">
                {t('run.focusAreas')} ({t('run.focusAreas.hint')})
              </span>
              <textarea
                value={focusAreas}
                onChange={(event) => { setFocusAreas(event.target.value); }}
                rows={2}
                className="field-control field-control--textarea"
              />
            </label>

            <label className="field field--span-3">
              <span className="field__label">{t('run.maxSteps')}</span>
              <input
                type="number"
                value={maxSteps}
                onChange={(event) => { setMaxSteps(Number(event.target.value)); }}
                min={1}
                className="field-control"
              />
            </label>

            <label className="field field--span-3">
              <span className="field__label">{t('run.maxPages')}</span>
              <input
                type="number"
                value={maxPages}
                onChange={(event) => { setMaxPages(Number(event.target.value)); }}
                min={1}
                className="field-control"
              />
            </label>

            <label className="field field--span-3">
              <span className="field__label">{t('run.browserMode')}</span>
              <select
                value={browserMode}
                onChange={(event) => { setBrowserMode(event.target.value as 'headless' | 'headed'); }}
                className="field-control"
              >
                <option value="headless">{t('run.browserMode.headless')}</option>
                <option value="headed">{t('run.browserMode.headed')}</option>
              </select>
            </label>

            <label className="field field--span-3">
              <span className="field__label">{t('run.captchaAutoSolve')}</span>
              <select
                value={captchaAutoSolve ? 'on' : 'off'}
                onChange={(event) => { setCaptchaAutoSolve(event.target.value === 'on'); }}
                className="field-control"
              >
                <option value="on">{t('common.enabled')}</option>
                <option value="off">{t('common.disabled')}</option>
              </select>
            </label>

            <label className="field field--span-3">
              <span className="field__label">{t('run.captchaAutoSolveAttempts')}</span>
              <input
                type="number"
                value={captchaAutoSolveAttempts}
                onChange={(event) => { setCaptchaAutoSolveAttempts(Math.max(1, Math.min(3, Number(event.target.value) || 1))); }}
                min={1}
                max={3}
                disabled={!captchaAutoSolve}
                className="field-control"
              />
            </label>

            <label className="field field--span-3">
              <span className="field__label">{t('run.manualInterventionOnCaptcha')}</span>
              <select
                value={manualInterventionOnCaptcha ? 'on' : 'off'}
                onChange={(event) => { setManualInterventionOnCaptcha(event.target.value === 'on'); }}
                className="field-control"
              >
                <option value="on">{t('common.enabled')}</option>
                <option value="off">{t('common.disabled')}</option>
              </select>
            </label>

            <label className="field field--span-3">
              <span className="field__label">{t('run.manualLoginTimeoutSec')}</span>
              <input
                type="number"
                value={manualLoginTimeoutSec}
                onChange={(event) => { setManualLoginTimeoutSec(Math.max(10, Number(event.target.value) || 10)); }}
                min={10}
                disabled={!manualInterventionOnCaptcha}
                className="field-control"
              />
            </label>

            <label className="field field--span-6">
              <span className="field__label">
                {t('run.allowedHosts')} ({t('run.allowedHosts.hint')})
              </span>
              <input
                value={allowedHosts}
                onChange={(event) => { setAllowedHosts(event.target.value); }}
                className="field-control"
              />
            </label>
          </div>
        </section>
      )}

      {(projectId || repoId || projectPath) && (
        <section className="selection-summary" aria-label={t('run.workspaceSummary')}>
          <SummaryItem label={t('run.workspaceSummary.project')} value={selectedProject?.name ?? t('common.none')} />
          <SummaryItem label={t('run.workspaceSummary.site')} value={selectedSite?.name ?? t('common.none')} />
          <SummaryItem label={t('run.workspaceSummary.credential')} value={selectedCredential?.label ?? t('common.none')} />
          <SummaryItem label={t('run.workspaceSummary.repo')} value={selectedRepo?.name ?? (requiresRepoSelection ? t('run.workspaceSummary.repoUnselected') : t('common.none'))} />
          <SummaryItem label={t('run.workspaceSummary.path')} value={projectPath || t('common.none')} />
          {needsExploration && (
            <SummaryItem
              label={t('run.workspaceSummary.browserMode')}
              value={browserMode === 'headed' ? t('run.browserMode.headed') : t('run.browserMode.headless')}
            />
          )}
          {needsExploration && (
            <SummaryItem
              label={t('run.workspaceSummary.captchaAttempts')}
              value={captchaAutoSolve ? t('run.workspaceSummary.attempts', { count: captchaAutoSolveAttempts }) : t('common.disabled')}
            />
          )}
          {needsExploration && (
            <SummaryItem
              label={t('run.workspaceSummary.manualFallback')}
              value={manualInterventionOnCaptcha ? t('run.workspaceSummary.manualFallback.enabled', { seconds: manualLoginTimeoutSec }) : t('common.disabled')}
            />
          )}
          {projectId && sites && sites.length > 0 && !siteId && (
            <div className="selection-summary__warning">{t('run.workspaceSummary.siteRecommendation')}</div>
          )}
        </section>
      )}

      <div className="quick-run-actions">
        <div className="quick-run-actions__hint">
          {t('run.submitHint')}
        </div>
        <Button type="submit" variant="primary" disabled={loading || (requiresRepoSelection && !repoId)}>
          {loading ? t('common.loading') : t('run.start')}
        </Button>
      </div>
    </form>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="selection-summary__item">
      <div className="selection-summary__label">{label}</div>
      <div className="selection-summary__value">{value}</div>
    </div>
  );
}
