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
        <Button onClick={() => { setPatch({}); }}>{t('settings.resetUnsaved')}</Button>
      </div>

      {validationErrors.length > 0 && <Banner message={validationErrors.join('; ')} />}
      {validationWarnings.length > 0 && (
        <div style={{ padding: '0.5rem 1rem', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 4, marginBottom: '0.5rem', fontSize: '0.9em' }}>
          ⚠ {validationWarnings.join('; ')}
        </div>
      )}

      {applyResult && (
        <div style={{ padding: '0.75rem 1rem', background: '#efe', border: '1px solid #cfc', borderRadius: 4, marginBottom: '1rem', fontSize: '0.9em', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div>✓ {t('settings.saved')} (v{applyResult.version !== undefined ? String(applyResult.version) : '?'})</div>
          {applyResult.reloadedModules && applyResult.reloadedModules.length > 0 && (
            <div><strong>{t('settings.reloadedModules')}：</strong>{applyResult.reloadedModules.join(', ')}</div>
          )}
          {applyResult.nextRunOnlyKeys && applyResult.nextRunOnlyKeys.length > 0 && (
            <div><strong>{t('settings.nextRunOnly')}：</strong>{applyResult.nextRunOnlyKeys.join(', ')}</div>
          )}
          {applyResult.requiresRestart && (
            <div style={{ color: '#b45309' }}>⚠ {t('settings.restartRequired')}</div>
          )}
        </div>
      )}

      <SettingsSection title={t('settings.storage')}>
        <SettingRow label={t('settings.field.sqlitePath')} value={String(val('storage', 'sqlitePath'))} onChange={v => { set('storage', 'sqlitePath', v); }} description={t('settings.field.sqlitePath.desc')} />
        <SettingRow label={t('settings.field.artifactRoot')} value={String(val('storage', 'artifactRoot'))} onChange={v => { set('storage', 'artifactRoot', v); }} description={t('settings.field.artifactRoot.desc')} />
        <SettingRow label={t('settings.field.diagnosticRoot')} value={String(val('storage', 'diagnosticRoot'))} onChange={v => { set('storage', 'diagnosticRoot', v); }} description={t('settings.field.diagnosticRoot.desc')} />
        <SettingRow label={t('settings.field.codeTaskRoot')} value={String(val('storage', 'codeTaskRoot'))} onChange={v => { set('storage', 'codeTaskRoot', v); }} description={t('settings.field.codeTaskRoot.desc')} />
      </SettingsSection>

      <SettingsSection title={t('settings.workspace')}>
        <SettingRow label="Playwright 测试集根目录" value={String(val('workspace', 'testSuitesRoot') ?? '')} onChange={v => { set('workspace', 'testSuitesRoot', v); }} description="存放所有项目 Playwright 测试集的根目录" />
      </SettingsSection>

      <SettingsSection title={t('settings.diagnostics')}>
        <SettingRow label={t('settings.timeWindowSeconds')} value={String(v.diagnostics.correlationKeys.timeWindowSeconds)} onChange={_v => { /* nested key — not patchable via simple set */ }} description={t('settings.timeWindowSeconds')} />
      </SettingsSection>

      <SettingsSection title={t('settings.trace')}>
        <SettingRow label={t('settings.field.provider')} value={String(val('trace', 'provider'))} onChange={v => { set('trace', 'provider', v); }} />
        <SettingRow label={t('settings.field.endpoint')} value={String(val('trace', 'endpoint'))} onChange={v => { set('trace', 'endpoint', v); }} description={t('settings.field.endpoint.desc')} />
      </SettingsSection>

      <SettingsSection title={t('settings.logs')}>
        <SettingRow label={t('settings.field.provider')} value={String(val('logs', 'provider'))} onChange={v => { set('logs', 'provider', v); }} />
        <SettingRow label={t('settings.field.endpoint')} value={String(val('logs', 'endpoint'))} onChange={v => { set('logs', 'endpoint', v); }} description={t('settings.field.endpoint.desc')} />
        <SettingRow label={t('settings.field.defaultLimit')} value={String(val('logs', 'defaultLimit'))} onChange={v => { set('logs', 'defaultLimit', Number(v)); }} />
      </SettingsSection>

      <SettingsSection title={t('settings.ai')}>
        {/* Active provider selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.9em' }}>
          <div style={{ minWidth: 220, fontWeight: 500 }}>{t('settings.field.activeProvider')}</div>
          <select
            value={String(val('ai', 'activeProvider'))}
            onChange={e => { set('ai', 'activeProvider', e.target.value); }}
            style={{ flex: 1, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4 }}
          >
            {Object.keys((v.ai?.providers ?? {})).map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        {/* Per-provider config */}
        {Object.entries(v.ai?.providers ?? {}).map(([providerKey, providerCfg]) => {
          const patchedProviders = (patch.ai as { providers?: Record<string, unknown> } | undefined)?.providers ?? {};
          const patchedCfg = (patchedProviders[providerKey] as Record<string, unknown> | undefined) ?? {};
          const getField = (field: string): string => String(patchedCfg[field] ?? (providerCfg as Record<string, unknown>)[field] ?? '');
          const setField = (field: string, value: string): void => {
            setPatch(p => ({
              ...p,
              ai: {
                ...(p.ai ?? {}),
                providers: {
                  ...((p.ai as { providers?: Record<string, unknown> } | undefined)?.providers ?? {}),
                  [providerKey]: {
                    ...(((p.ai as { providers?: Record<string, unknown> } | undefined)?.providers?.[providerKey] as Record<string, unknown> | undefined) ?? {}),
                    [field]: value,
                  },
                },
              },
            }) as DeepPartial<PersonalSettings>);
          };
          return (
            <div key={providerKey} style={{ border: '1px solid #eee', borderRadius: 6, padding: '0.75rem', marginTop: '0.5rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#555' }}>{providerKey}</div>
              <SettingRow label={t('settings.field.baseUrl')} value={getField('baseUrl')} onChange={v => { setField('baseUrl', v); }} />
              <SettingRow label={t('settings.field.model')} value={getField('model')} onChange={v => { setField('model', v); }} description={t('settings.field.model.desc')} />
              <SettingRow label={t('settings.field.apiKey')} value={getField('apiKey')} onChange={v => { setField('apiKey', v); }} type="password" description={t('settings.field.apiKey.desc')} />
              <SettingRow label={t('settings.field.apiKeyEnvVar')} value={getField('apiKeyEnvVar')} onChange={v => { setField('apiKeyEnvVar', v); }} description={t('settings.field.apiKeyEnvVar.desc')} />
            </div>
          );
        })}

        <SettingRow label={t('settings.approvalRequired')} value={String(val('codeAgent', 'defaultApprovalRequired'))} onChange={v => { set('codeAgent', 'defaultApprovalRequired', v === 'true'); }} description={t('settings.approvalRequired')} />
        <SettingRow label="自动审批 (autoApprove)" value={String(val('codeAgent', 'autoApprove') ?? false)} onChange={v => { set('codeAgent', 'autoApprove', v === 'true'); }} description="开启后 CodeTask 草稿自动晋升并审批，无需人工确认" />
        <SettingRow label="自动审批最高风险级别" value={String(val('codeAgent', 'autoApproveMaxRiskLevel') ?? 'low')} onChange={v => { set('codeAgent', 'autoApproveMaxRiskLevel', v); }} description="low / medium / high，仅在 autoApprove=true 时生效" />
      </SettingsSection>

      <SettingsSection title={t('settings.report')}>
        <SettingRow label={t('settings.field.port')} value={String(val('report', 'port'))} onChange={v => { set('report', 'port', Number(v)); }} description={t('settings.portHint')} />
        <SettingRow label={t('settings.field.locale')} value={v.ui?.locale ?? 'zh-CN'} onChange={v => { setPatch(p => ({ ...p, ui: { locale: v as 'zh-CN' | 'en-US' } })); }} description={t('settings.field.locale.desc')} />
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

function SettingRow({ label, value, onChange, description, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; description?: string; type?: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.9em' }}>
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {description && <div style={{ color: '#888', fontSize: '0.8em' }}>{description}</div>}
      </div>
      <input type={type} value={value} onChange={e => { onChange(e.target.value); }} style={{ flex: 1, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 4 }} />
    </div>
  );
}

// Re-export for use in components
export { KV, Card };
