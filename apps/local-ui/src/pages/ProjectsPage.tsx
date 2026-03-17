import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { Loading, ErrorBanner, Card, Button } from '../components/ui.js';
import { t } from '../i18n.js';
import type { Project } from '../types.js';

export function ProjectsPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.listProjects(), []);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body: { name: string; description?: string } = { name: name.trim() };
      if (desc.trim()) body.description = desc.trim();
      await api.createProject(body);
      setName(''); setDesc(''); setCreating(false);
      reload();
    } finally { setSaving(false); }
  }

  return (
    <div>
      <Card title={t('project.title')}>
        <div style={{ marginBottom: '1rem' }}>
          <Button onClick={() => { setCreating(v => !v); }}>{t('project.new')}</Button>
        </div>
        {creating && (
          <form onSubmit={(e) => { void handleCreate(e); }} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <input value={name} onChange={e => { setName(e.target.value); }} placeholder={`${t('project.name')} *`} required
              style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, flex: '1 1 160px' }} />
            <input value={desc} onChange={e => { setDesc(e.target.value); }} placeholder={t('project.description')}
              style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, flex: '2 1 200px' }} />
            <Button type="submit" disabled={saving}>{saving ? '…' : t('common.save')}</Button>
            <Button type="button" onClick={() => { setCreating(false); }}>{t('common.cancel')}</Button>
          </form>
        )}
        {loading && <Loading />}
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {data && data.length === 0 && <span style={{ color: '#888', fontSize: '0.9em' }}>{t('project.noProjects')}</span>}
        {data && data.map(p => <ProjectRow key={p.id} project={p} onClick={() => { navigate(`/projects/${p.id}`); }} />)}
      </Card>
    </div>
  );
}

function ProjectRow({ project, onClick }: { project: Project; onClick: () => void }): React.ReactElement {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.6rem 0.5rem', borderBottom: '1px solid #eee', cursor: 'pointer' }}>
      <span style={{ fontWeight: 600, minWidth: 120, flex: '0 0 auto' }}>{project.name}</span>
      <span style={{ color: '#666', fontSize: '0.85em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.description ?? ''}</span>
      <span style={{ color: '#aaa', fontSize: '0.8em', fontFamily: 'monospace', flex: '0 0 auto' }}>{project.id}</span>
      <span style={{ color: '#aaa', fontSize: '0.8em' }}>→</span>
    </div>
  );
}
