import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Table, Card, TaskStatusBadge } from '../components/ui.js';

export function CodeTaskListPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.listCodeTasks(), []);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  const items = data?.items ?? [];

  return (
    <div>
      <h2 style={{ marginBottom: '1rem' }}>{t('nav.codeTasks')}</h2>
      {items.length === 0
        ? <Card><p style={{ color: '#888', margin: 0 }}>—</p></Card>
        : (
          <Card>
            <Table
              headers={['Task ID', t('common.status'), 'Run', 'Goal', t('common.updatedAt')]}
              rows={items.map(item => [
                <button key="id" onClick={() => { navigate(`/code-tasks/${item.taskId}`); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline', fontFamily: 'monospace' }}>
                  {item.taskId}
                </button>,
                <TaskStatusBadge key="s" status={item.status} />,
                <button key="run" onClick={() => { navigate(`/runs/${item.runId}`); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline', fontFamily: 'monospace' }}>
                  {item.runId}
                </button>,
                <span key="g" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{item.goal}</span>,
                item.updatedAt.slice(0, 19).replace('T', ' '),
              ])}
            />
          </Card>
        )}
    </div>
  );
}
