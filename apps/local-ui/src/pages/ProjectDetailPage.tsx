import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { Loading, ErrorBanner, Card, Button } from '../components/ui.js';
import { t } from '../i18n.js';
import type { Site, LocalRepo, SiteCredential } from '../types.js';

export function ProjectDetailPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const id = projectId!;

  const { data: project, loading: pLoading, error: pError, reload: reloadProject } = useAsync(() => api.getProject(id), [id]);
  const { data: sites, reload: reloadSites } = useAsync(() => api.listSites(id), [id]);
  const { data: repos, reload: reloadRepos } = useAsync(() => api.listRepos(id), [id]);
  const [credSiteId, setCredSiteId] = React.useState<string | null>(null);

  const [editingName, setEditingName] = React.useState('');
  const [editingDesc, setEditingDesc] = React.useState('');
  const [editMode, setEditMode] = React.useState(false);

  React.useEffect(() => {
    if (project) { setEditingName(project.name); setEditingDesc(project.description ?? ''); }
  }, [project]);

  async function saveProject(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body: { name: string; description?: string } = { name: editingName.trim() };
    if (editingDesc.trim()) body.description = editingDesc.trim();
    await api.updateProject(id, body);
    setEditMode(false); reloadProject();
  }

  async function deleteProject(): Promise<void> {
    if (!confirm(`${t('common.confirm')} — ${project?.name ?? id}`)) return;
    await api.deleteProject(id);
    navigate('/projects');
  }

  if (pLoading) return <Loading />;
  if (pError) return <ErrorBanner message={pError} />;
  if (!project) return <ErrorBanner message={t('common.notFound')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Card title={t('project.detail.title')}>
        {editMode ? (
          <form onSubmit={(e) => { void saveProject(e); }} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input value={editingName} onChange={e => { setEditingName(e.target.value); }} required
              style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, flex: '1 1 160px' }} />
            <input value={editingDesc} onChange={e => { setEditingDesc(e.target.value); }} placeholder={t('project.description')}
              style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, flex: '2 1 200px' }} />
            <Button type="submit">{t('common.save')}</Button>
            <Button type="button" onClick={() => { setEditMode(false); }}>{t('common.cancel')}</Button>
          </form>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontWeight: 600, fontSize: '1.1em' }}>{project.name}</span>
            {project.description && <span style={{ color: '#666' }}>{project.description}</span>}
            <span style={{ color: '#aaa', fontSize: '0.8em', fontFamily: 'monospace' }}>{project.id}</span>
            <div style={{ flex: 1 }} />
            <Button onClick={() => { setEditMode(true); }}>{t('project.detail.editName')}</Button>
            <Button onClick={() => { void deleteProject(); }} style={{ color: '#c00', borderColor: '#c00' }}>{t('common.delete')}</Button>
          </div>
        )}
      </Card>

      {/* Sites */}
      <SitesSection projectId={id} sites={sites ?? []} reload={reloadSites} onManageCreds={setCredSiteId} />

      {credSiteId && (
        <CredentialsSection projectId={id} siteId={credSiteId}
          siteName={sites?.find(s => s.id === credSiteId)?.name ?? credSiteId}
          onClose={() => { setCredSiteId(null); }} />
      )}

      <ReposSection projectId={id} repos={repos ?? []} reload={reloadRepos} />
    </div>
  );
}

/* ── Sites ── */
function SitesSection({ projectId, sites, reload, onManageCreds }: { projectId: string; sites: Site[]; reload: () => void; onManageCreds: (siteId: string) => void }): React.ReactElement {
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', baseUrl: '', description: '' });
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState({ name: '', baseUrl: '', description: '' });

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body: { name: string; baseUrl: string; description?: string } = { name: form.name.trim(), baseUrl: form.baseUrl.trim() };
    if (form.description.trim()) body.description = form.description.trim();
    await api.createSite(projectId, body);
    setForm({ name: '', baseUrl: '', description: '' }); setCreating(false); reload();
  }

  async function save(siteId: string, e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body: { name: string; baseUrl: string; description?: string } = { name: editForm.name.trim(), baseUrl: editForm.baseUrl.trim() };
    if (editForm.description.trim()) body.description = editForm.description.trim();
    await api.updateSite(projectId, siteId, body);
    setEditId(null); reload();
  }

  async function del(site: Site): Promise<void> {
    if (!confirm(`${t('site.delete.confirm').replace('{name}', site.name)}`)) return;
    await api.deleteSite(projectId, site.id); reload();
  }

  return (
    <Card title={t('site.title')}>
      <Button onClick={() => { setCreating(v => !v); }} style={{ marginBottom: '0.75rem' }}>{t('site.add')}</Button>
      {creating && (
        <form onSubmit={(e) => { void create(e); }} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <input value={form.name} onChange={e => { setForm(f => ({ ...f, name: e.target.value })); }} placeholder="名称 *" required style={inputStyle} />
          <input value={form.baseUrl} onChange={e => { setForm(f => ({ ...f, baseUrl: e.target.value })); }} placeholder="Base URL * (https://...)" required style={{ ...inputStyle, flex: '2 1 200px' }} />
          <Button type="submit">{t('common.save')}</Button>
          <Button type="button" onClick={() => { setCreating(false); }}>{t('common.cancel')}</Button>
        </form>
      )}
      {sites.length === 0 && !creating && <span style={{ color: '#888', fontSize: '0.9em' }}>{t('site.noSites')}</span>}
      {sites.map(s => editId === s.id ? (
        <form key={s.id} onSubmit={(e) => { void save(s.id, e); }} style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 0', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
          <input value={editForm.name} onChange={e => { setEditForm(f => ({ ...f, name: e.target.value })); }} required style={inputStyle} />
          <input value={editForm.baseUrl} onChange={e => { setEditForm(f => ({ ...f, baseUrl: e.target.value })); }} required style={{ ...inputStyle, flex: '2 1 200px' }} />
          <Button type="submit">{t('common.save')}</Button>
          <Button type="button" onClick={() => { setEditId(null); }}>{t('common.cancel')}</Button>
        </form>
      ) : (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
          <span style={{ fontWeight: 500, minWidth: 100 }}>{s.name}</span>
          <a href={s.baseUrl} target="_blank" rel="noreferrer" style={{ color: '#0070f3', fontSize: '0.85em', flex: 1 }}>{s.baseUrl}</a>
          <Button onClick={() => { setEditId(s.id); setEditForm({ name: s.name, baseUrl: s.baseUrl, description: '' }); }}>{t('common.actions')}</Button>
          <Button onClick={() => { onManageCreds(s.id); }}>{t('site.credentials')}</Button>
          <Button onClick={() => { void del(s); }} style={{ color: '#c00', borderColor: '#c00' }}>{t('common.delete')}</Button>
        </div>
      ))}
    </Card>
  );
}

/* ── Repos ── */
type RepoFormState = { name: string; path: string; description: string; testOutputDir: string; baseBranch: string };
const repoFieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const repoLabelStyle: React.CSSProperties = { fontSize: '0.82em', color: '#555', fontWeight: 500 };
const repoFullInput: React.CSSProperties = { padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, width: '100%', boxSizing: 'border-box' };

function RepoForm({ f, setF, branches, onValidate, pathSt, onSubmit, onCancel }: {
  f: RepoFormState; setF: React.Dispatch<React.SetStateAction<RepoFormState>>;
  branches: string[]; onValidate: () => void;
  pathSt: { ok: boolean; msg: string } | null;
  onSubmit: (e: React.FormEvent) => void; onCancel: () => void;
}): React.ReactElement {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem', background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 6, marginBottom: '0.75rem' }}>
      <div style={repoFieldStyle}>
        <label style={repoLabelStyle}>{t('repo.name')} *</label>
        <input value={f.name} onChange={e => { setF(p => ({ ...p, name: e.target.value })); }} required style={repoFullInput} />
      </div>
      <div style={repoFieldStyle}>
        <label style={repoLabelStyle}>{t('repo.path')} *</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={f.path} onChange={e => { setF(p => ({ ...p, path: e.target.value })); }} required style={{ ...repoFullInput, flex: 1 }} placeholder="/path/to/project" />
          <button type="button" onClick={onValidate} style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#f5f5f5', cursor: 'pointer', whiteSpace: 'nowrap' }}>✓ {t('repo.validatePath')}</button>
        </div>
        {pathSt && <span style={{ fontSize: '0.8em', color: pathSt.ok ? '#2a7a2a' : '#c00' }}>{pathSt.msg}</span>}
      </div>
      <div style={repoFieldStyle}>
        <label style={repoLabelStyle}>{t('repo.baseBranch')} *</label>
        {branches.length > 0 ? (
          <select value={f.baseBranch} onChange={e => { setF(p => ({ ...p, baseBranch: e.target.value })); }} required style={repoFullInput}>
            <option value="">— 选择基线分支 —</option>
            {branches.map(b => <option key={b} value={b}>{b}</option>)}
            {f.baseBranch && !branches.includes(f.baseBranch) && <option value={f.baseBranch}>{f.baseBranch}</option>}
          </select>
        ) : (
          <input value={f.baseBranch} onChange={e => { setF(p => ({ ...p, baseBranch: e.target.value })); }} required placeholder="如 main（验证路径后可自动加载分支）" style={repoFullInput} />
        )}
      </div>
      <div style={repoFieldStyle}>
        <label style={repoLabelStyle}>{t('project.description')}（选填，最多 500 字）</label>
        <textarea value={f.description} onChange={e => { setF(p => ({ ...p, description: e.target.value.slice(0, 500) })); }} rows={3} style={{ ...repoFullInput, resize: 'vertical' }} />
        <span style={{ fontSize: '0.75em', color: '#aaa', textAlign: 'right' }}>{f.description.length}/500</span>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Button type="submit">{t('common.save')}</Button>
        <Button type="button" onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

function ReposSection({ projectId, repos, reload }: { projectId: string; repos: LocalRepo[]; reload: () => void }): React.ReactElement {
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<RepoFormState>({ name: '', path: '', description: '', testOutputDir: '', baseBranch: '' });
  const [formBranches, setFormBranches] = React.useState<string[]>([]);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<RepoFormState>({ name: '', path: '', description: '', testOutputDir: '', baseBranch: '' });
  const [editBranches, setEditBranches] = React.useState<string[]>([]);

  async function loadBranches(path: string, setter: (b: string[]) => void): Promise<void> {
    if (!path.trim()) return;
    try {
      const info = await api.validatePath(path.trim());
      if (info.isGit) {
        // path is valid git repo — fetch branches via a temp repo lookup won't work without repoId
        // Instead just validate; branch list loaded after save via git-info endpoint
        setter([]);
      }
    } catch { /* ignore */ }
  }

  async function loadRepoBranches(repoId: string, setter: (b: string[]) => void): Promise<void> {
    try {
      const info = await api.getRepoGitInfo(projectId, repoId);
      setter(info.branches);
    } catch { setter([]); }
  }

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body: { name: string; path: string; description?: string; testOutputDir?: string; baseBranch?: string } = { name: form.name.trim(), path: form.path.trim() };
    if (form.description.trim()) body.description = form.description.trim();
    if (form.testOutputDir.trim()) body.testOutputDir = form.testOutputDir.trim();
    if (form.baseBranch.trim()) body.baseBranch = form.baseBranch.trim();
    await api.createRepo(projectId, body);
    setForm({ name: '', path: '', description: '', testOutputDir: '', baseBranch: '' }); setCreating(false); reload();
  }

  async function save(repoId: string, e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body: { name: string; path: string; description?: string; testOutputDir?: string; baseBranch?: string } = { name: editForm.name.trim(), path: editForm.path.trim() };
    if (editForm.description.trim()) body.description = editForm.description.trim();
    if (editForm.testOutputDir.trim()) body.testOutputDir = editForm.testOutputDir.trim();
    body.baseBranch = editForm.baseBranch;
    await api.updateRepo(projectId, repoId, body);
    setEditId(null); reload();
  }

  async function del(repo: LocalRepo): Promise<void> {
    if (!confirm(t('repo.delete.confirm').replace('{name}', repo.name))) return;
    await api.deleteRepo(projectId, repo.id); reload();
  }

  const [pathStatus, setPathStatus] = React.useState<{ ok: boolean; msg: string } | null>(null);
  const [editPathStatus, setEditPathStatus] = React.useState<{ ok: boolean; msg: string } | null>(null);

  async function validateAndLoadBranches(path: string, repoId: string | null, branchSetter: (b: string[]) => void, statusSetter: (s: { ok: boolean; msg: string }) => void): Promise<void> {
    if (!path.trim()) return;
    try {
      const info = await api.validatePath(path.trim());
      if (!info.isDir) { statusSetter({ ok: false, msg: t('repo.validatePath') + ': 路径不存在或不是目录' }); return; }
      if (!info.isGit) { statusSetter({ ok: false, msg: '该目录不是 git 仓库' }); return; }
      statusSetter({ ok: true, msg: '✓ 有效的 git 仓库' });
      if (repoId) await loadRepoBranches(repoId, branchSetter);
    } catch { statusSetter({ ok: false, msg: '验证失败' }); }
  }

  return (
    <Card title={t('repo.title')}>
      <Button onClick={() => { setCreating(v => !v); setPathStatus(null); }} style={{ marginBottom: '0.75rem' }}>{t('repo.add')}</Button>
      {creating && (
        <RepoForm f={form} setF={setForm} branches={formBranches}
          onValidate={() => { void validateAndLoadBranches(form.path, null, setFormBranches, setPathStatus); }}
          pathSt={pathStatus}
          onSubmit={(e) => { void create(e); }}
          onCancel={() => { setCreating(false); setPathStatus(null); }} />
      )}
      {repos.length === 0 && !creating && <span style={{ color: '#888', fontSize: '0.9em' }}>{t('repo.noRepos')}</span>}
      {repos.map(r => editId === r.id ? (
        <RepoForm key={r.id} f={editForm} setF={setEditForm} branches={editBranches}
          onValidate={() => { void validateAndLoadBranches(editForm.path, r.id, setEditBranches, setEditPathStatus); }}
          pathSt={editPathStatus}
          onSubmit={(e) => { void save(r.id, e); }}
          onCancel={() => { setEditId(null); setEditPathStatus(null); }} />
      ) : (
        <div key={r.id} style={{ border: '1px solid #d0d0d0', borderRadius: 8, padding: '1rem', marginBottom: '0.75rem', background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
            <span style={{ fontWeight: 600, fontSize: '1em' }}>{r.name}</span>
            {r.baseBranch && <span style={{ fontSize: '0.8em', background: '#e8f4e8', color: '#2a7a2a', padding: '2px 8px', borderRadius: 12 }}>⎇ {r.baseBranch}</span>}
            <div style={{ flex: 1 }} />
            <Button onClick={() => {
              setEditId(r.id); setEditPathStatus(null);
              setEditForm({ name: r.name, path: r.path, description: r.description ?? '', testOutputDir: r.testOutputDir ?? '', baseBranch: r.baseBranch ?? '' });
              void loadRepoBranches(r.id, setEditBranches);
            }}>{t('project.detail.editName')}</Button>
            <Button onClick={() => { void del(r); }} style={{ color: '#c00', borderColor: '#c00' }}>{t('common.delete')}</Button>
          </div>
          <code style={{ fontSize: '0.82em', color: '#555', display: 'block', marginBottom: r.description ? '0.3rem' : 0 }}>{r.path}</code>
          {r.description && <p style={{ margin: 0, fontSize: '0.85em', color: '#666' }}>{r.description}</p>}
        </div>
      ))}
    </Card>
  );
}

const inputStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, flex: '1 1 140px' };

/* ── Credentials ── */
function CredentialsSection({ projectId, siteId, siteName, onClose }: {
  projectId: string; siteId: string; siteName: string; onClose: () => void;
}): React.ReactElement {
  const { data: creds, reload } = useAsync(() => api.listCredentials(projectId, siteId), [siteId]);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ label: '', authType: 'userpass' as 'userpass' | 'cookie' | 'token', loginUrl: '', username: '', password: '', cookiesJson: '', headersJson: '' });

  async function create(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body: Parameters<typeof api.createCredential>[2] = { label: form.label.trim(), authType: form.authType };
    if (form.loginUrl.trim()) body.loginUrl = form.loginUrl.trim();
    if (form.username.trim()) body.username = form.username.trim();
    if (form.password) body.password = form.password;
    if (form.cookiesJson.trim()) body.cookiesJson = form.cookiesJson.trim();
    if (form.headersJson.trim()) body.headersJson = form.headersJson.trim();
    await api.createCredential(projectId, siteId, body);
    setForm({ label: '', authType: 'userpass', loginUrl: '', username: '', password: '', cookiesJson: '', headersJson: '' });
    setCreating(false); reload();
  }

  async function del(cred: SiteCredential): Promise<void> {
    if (!confirm(`确认删除凭据「${cred.label}」？`)) return;
    await api.deleteCredential(projectId, siteId, cred.id); reload();
  }

  return (
    <Card title={`凭据 — ${siteName}`}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <Button onClick={() => { setCreating(v => !v); }}>{t('cred.add')}</Button>
        <Button onClick={onClose}>收起</Button>
      </div>
      {creating && (
        <form onSubmit={(e) => { void create(e); }} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <input value={form.label} onChange={e => { setForm(f => ({ ...f, label: e.target.value })); }} placeholder="标签 *" required style={inputStyle} />
          <select value={form.authType} onChange={e => { setForm(f => ({ ...f, authType: e.target.value as 'userpass' | 'cookie' | 'token' })); }} style={inputStyle}>
            <option value="userpass">用户名/密码</option>
            <option value="cookie">Cookie</option>
            <option value="token">Token/Header</option>
          </select>
          {form.authType === 'userpass' && <>
            <input value={form.loginUrl} onChange={e => { setForm(f => ({ ...f, loginUrl: e.target.value })); }} placeholder="登录页 URL" style={inputStyle} />
            <input value={form.username} onChange={e => { setForm(f => ({ ...f, username: e.target.value })); }} placeholder="用户名" style={inputStyle} />
            <input type="password" value={form.password} onChange={e => { setForm(f => ({ ...f, password: e.target.value })); }} placeholder="密码" style={inputStyle} />
          </>}
          {form.authType === 'cookie' && (
            <textarea value={form.cookiesJson} onChange={e => { setForm(f => ({ ...f, cookiesJson: e.target.value })); }} placeholder='Cookie JSON: [{"name":"...","value":"..."}]' rows={3} style={{ ...inputStyle, flex: '3 1 300px' }} />
          )}
          {form.authType === 'token' && (
            <textarea value={form.headersJson} onChange={e => { setForm(f => ({ ...f, headersJson: e.target.value })); }} placeholder='Headers JSON: {"Authorization":"Bearer ..."}' rows={2} style={{ ...inputStyle, flex: '3 1 300px' }} />
          )}
          <Button type="submit">{t('common.save')}</Button>
          <Button type="button" onClick={() => { setCreating(false); }}>{t('common.cancel')}</Button>
        </form>
      )}
      {creds?.length === 0 && !creating && <span style={{ color: '#888', fontSize: '0.9em' }}>{t('cred.noCreds')}</span>}
      {creds?.map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
          <span style={{ fontWeight: 500, minWidth: 120 }}>{c.label}</span>
          <span style={{ color: '#888', fontSize: '0.82em', background: '#f0f0f0', padding: '2px 6px', borderRadius: 3 }}>{c.authType ?? 'userpass'}</span>
          {c.username && <span style={{ color: '#555', fontSize: '0.85em' }}>{c.username}</span>}
          <span style={{ color: '#aaa', fontSize: '0.8em', fontFamily: 'monospace', flex: 1 }}>{c.id}</span>
          <Button onClick={() => { void del(c); }} style={{ color: '#c00', borderColor: '#c00' }}>{t('common.delete')}</Button>
        </div>
      ))}
    </Card>
  );
}
