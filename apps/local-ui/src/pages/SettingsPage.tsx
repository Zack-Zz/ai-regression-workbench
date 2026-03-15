import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Card, KV, Button, ErrorBanner as Banner } from '../components/ui.js';
import type { PersonalSettings, UpdateSettingsInput, SettingsApplyResult } from '../types.js';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function SettingsPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.getSettings(), []);
  const [patch, setPatch] = useState<DeepPartial<PersonalSettings>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [applyResult, setApplyResult] = useState<SettingsApplyResult | null>(null);
  const [saving, setSaving] = useState(false);

  function set(section: keyof PersonalSettings, key: string, value: unknown): void {
    const s = section as string;
    setPatch(p => ({ ...p, [s]: { ...((p as Record<string, Record<string, unknown>>)[s] ?? {}), [key]: value } }));
  }

  async function handleValidate(): Promise<void> {
    const input: UpdateSettingsInput = { patch: patch as Partial<PersonalSettings> };
    try {
      const result = await api.validateSettings(input);
      setValidationErrors(result.errors);
      setValidationWarnings(result.warnings ?? []);
    } catch (e: unknown) { setValidationErrors([e instanceof Error ? e.message : String(e)]); }
  }

  async function handleSave(): Promise<void> {
    if (!data) return;
    setSaving(true);
    setApplyResult(null);
    setValidationErrors([]);
    const input: UpdateSettingsInput = { patch: patch as Partial<PersonalSettings>, expectedVersion: data.version };
    try {
      const result = await api.updateSettings(input);
      if (result.success) {
        setApplyResult(result);
        setPatch({});
        reload();
      }
    } catch (e: unknown) { setValidationErrors([e instanceof Error ? e.message : String(e)]); } finally { setSaving(false); }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div>{t('common.notFound')}</div>;

  const v = data.values;
  const val = (section: keyof PersonalSettings, key: string): unknown => {
    const pSection = (patch as Record<string, Record<string, unknown>>)[section as string];
    if (pSection?.[key] !== undefined) return pSection[key];
    return (v[section] as Record<string, unknown>)[key];
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Button onClick={() => { navigate(-1); }}>← {t('common.back')}</Button>
        <h2 style={{ margin: 0 }}>{t('settings.title')}</h2>
        <span style={{ color: '#888', fontSize: '0.85em' }}>{t('settings.version')}: {data.version} · {data.updatedAt.slice(0, 16).replace('T', ' ')}</span>
        <div style={{ flex: 1 }} />
        <Button onClick={() => { void handleValidate(); }}>{t('settings.validate')}</Button>
        <Button variant="primary" disabled={saving} onClick={() => { void handleSave(); }}>{t('settings.save')}</Button>
        <Button onClick={() => { setPatch({}); }}>重置未保存</Button>
      </div>

      {validationErrors.length > 0 && <Banner message={validationErrors.join('; ')} />}
      {validationWarnings.length > 0 && (
        <div style={{ padding: '0.5rem 1rem', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 4, marginBottom: '0.5rem', fontSize: '0.9em' }}>
          ⚠ {validationWarnings.join('; ')}
        </div>
      )}

      {applyResult && (
        <div style={{ padding: '0.75rem 1rem', background: '#efe', border: '1px solid #cfc', borderRadius: 4, marginBottom: '1rem', fontSize: '0.9em', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div>✓ 已保存 (v{applyResult.version !== undefined ? String(applyResult.version) : '?'})</div>
          {applyResult.reloadedModules && applyResult.reloadedModules.length > 0 && (
            <div><strong>立即重载模块：</strong>{applyResult.reloadedModules.join(', ')}</div>
          )}
          {applyResult.nextRunOnlyKeys && applyResult.nextRunOnlyKeys.length > 0 && (
            <div><strong>仅下次运行生效：</strong>{applyResult.nextRunOnlyKeys.join(', ')}</div>
          )}
          {applyResult.requiresRestart && (
            <div style={{ color: '#b45309' }}>⚠ {t('settings.restartRequired')}</div>
          )}
        </div>
      )}

      <SettingsSection title={t('settings.storage')}>
        <SettingRow label="sqlitePath" value={String(val('storage', 'sqlitePath'))} onChange={v => { set('storage', 'sqlitePath', v); }} />
        <SettingRow label="artifactRoot" value={String(val('storage', 'artifactRoot'))} onChange={v => { set('storage', 'artifactRoot', v); }} />
        <SettingRow label="diagnosticRoot" value={String(val('storage', 'diagnosticRoot'))} onChange={v => { set('storage', 'diagnosticRoot', v); }} />
        <SettingRow label="codeTaskRoot" value={String(val('storage', 'codeTaskRoot'))} onChange={v => { set('storage', 'codeTaskRoot', v); }} />
      </SettingsSection>

      <SettingsSection title={t('settings.workspace')}>
        <SettingRow label="targetProjectPath" value={String(val('workspace', 'targetProjectPath'))} onChange={v => { set('workspace', 'targetProjectPath', v); }} />
        <SettingRow label="gitRootStrategy" value={String(val('workspace', 'gitRootStrategy'))} onChange={v => { set('workspace', 'gitRootStrategy', v); }} />
        <KV label="allowOutsideToolWorkspace" value={String(val('workspace', 'allowOutsideToolWorkspace'))} />
      </SettingsSection>

      <SettingsSection title={t('settings.testAssets')}>
        <SettingRow label="sharedRoot" value={(val('testAssets', 'sharedRoot') as string | undefined) ?? ''} onChange={v => { set('testAssets', 'sharedRoot', v); }} />
        <SettingRow label="generatedRoot" value={String(val('testAssets', 'generatedRoot'))} onChange={v => { set('testAssets', 'generatedRoot', v); }} />
        <KV label="includeSharedInRuns" value={String(val('testAssets', 'includeSharedInRuns'))} />
        <KV label="includeGeneratedInRuns" value={String(val('testAssets', 'includeGeneratedInRuns'))} />
      </SettingsSection>

      <SettingsSection title={t('settings.diagnostics')}>
        <SettingRow label="timeWindowSeconds" value={String(v.diagnostics.correlationKeys.timeWindowSeconds)} onChange={_v => { /* nested key — not patchable via simple set */ }} description="关联时间窗口（秒）" />
      </SettingsSection>

      <SettingsSection title={t('settings.trace')}>
        <SettingRow label="provider" value={String(val('trace', 'provider'))} onChange={v => { set('trace', 'provider', v); }} />
        <SettingRow label="endpoint" value={String(val('trace', 'endpoint'))} onChange={v => { set('trace', 'endpoint', v); }} />
      </SettingsSection>

      <SettingsSection title={t('settings.logs')}>
        <SettingRow label="provider" value={String(val('logs', 'provider'))} onChange={v => { set('logs', 'provider', v); }} />
        <SettingRow label="endpoint" value={String(val('logs', 'endpoint'))} onChange={v => { set('logs', 'endpoint', v); }} />
        <SettingRow label="defaultLimit" value={String(val('logs', 'defaultLimit'))} onChange={v => { set('logs', 'defaultLimit', Number(v)); }} />
      </SettingsSection>

      <SettingsSection title={t('settings.ai')}>
        <SettingRow label="provider" value={String(val('ai', 'provider'))} onChange={v => { set('ai', 'provider', v); }} />
        <SettingRow label="model" value={String(val('ai', 'model'))} onChange={v => { set('ai', 'model', v); }} />
        <SettingRow label="apiKeyEnvVar" value={val('ai', 'apiKeyEnvVar') as string | undefined ?? ''} onChange={v => { set('ai', 'apiKeyEnvVar', v); }} />
        <SettingRow label="defaultApprovalRequired (codeAgent)" value={String(val('codeAgent', 'defaultApprovalRequired'))} onChange={v => { set('codeAgent', 'defaultApprovalRequired', v === 'true'); }} description="新任务默认是否需要人工批准" />
      </SettingsSection>

      <SettingsSection title={t('settings.report')}>
        <SettingRow label="port" value={String(val('report', 'port'))} onChange={v => { set('report', 'port', Number(v)); }} description="修改后需重启服务" />
        <SettingRow label="locale" value={v.ui?.locale ?? 'zh-CN'} onChange={v => { setPatch(p => ({ ...p, ui: { locale: v as 'zh-CN' | 'en-US' } })); }} />
      </SettingsSection>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Card title={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>{children}</div>
    </Card>
  );
}

function SettingRow({ label, value, onChange, description }: { label: string; value: string; onChange: (v: string) => void; description?: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.9em' }}>
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {description && <div style={{ color: '#888', fontSize: '0.8em' }}>{description}</div>}
      </div>
      <input value={value} onChange={e => { onChange(e.target.value); }} style={{ flex: 1, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4 }} />
    </div>
  );
}

// Re-export for use in components
export { KV, Card };
