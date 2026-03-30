import React from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, useServerEvents } from '../hooks.js';
import { Button, Card, ErrorBanner, Loading, RunStatusBadge, TaskStatusBadge } from '../components/ui.js';
import { t } from '../i18n.js';
import type { CodeTaskSummary, RunSummary } from '../types.js';

export function HomePage(): React.ReactElement {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => api.listRuns('limit=5'), []);
  const { data: pendingTasks } = useAsync(() => api.listCodeTasks('status=PENDING_APPROVAL&limit=10'), []);
  const { data: reviewTasks } = useAsync(() => api.listCodeTasks('status=SUCCEEDED&limit=10'), []);
  const { data: commitTasks } = useAsync(() => api.listCodeTasks('status=COMMIT_PENDING&limit=10'), []);
  const { data: projects } = useAsync(() => api.listProjects(), []);
  useServerEvents(['run.created', 'run.updated'], () => reload());

  const statCards = [
    { label: t('home.stat.projects'), value: String(projects?.length ?? 0), detail: t('home.stat.projects.detail') },
    { label: t('home.stat.pendingApproval'), value: String(pendingTasks?.items.length ?? 0), detail: t('home.stat.pendingApproval.detail') },
    { label: t('home.stat.pendingReview'), value: String(reviewTasks?.items.length ?? 0), detail: t('home.stat.pendingReview.detail') },
    { label: t('home.stat.pendingCommit'), value: String(commitTasks?.items.length ?? 0), detail: t('home.stat.pendingCommit.detail') },
  ];

  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <span className="page-intro__eyebrow">{t('home.eyebrow')}</span>
          <h1 className="page-intro__title">{t('home.title')}</h1>
          <p className="page-intro__description">
            {t('home.description')}
          </p>
        </div>
      </section>

      <section className="summary-grid" aria-label={t('home.summary.aria')}>
        {statCards.map((item) => (
          <SummaryStat key={item.label} label={item.label} value={item.value} detail={item.detail} />
        ))}
      </section>

      <section className="home-grid">
        <Card
          title={t('home.actions.title')}
          subtitle={t('home.actions.subtitle')}
        >
          <div className="action-group">
            <ActionSection
              title={t('home.actions.pendingApproval')}
              items={pendingTasks?.items ?? []}
              emptyText={t('home.actions.pendingApproval.empty')}
              onOpen={(taskId) => { navigate(`/code-tasks/${taskId}`); }}
            />
            <ActionSection
              title={t('home.actions.pendingReview')}
              items={reviewTasks?.items ?? []}
              emptyText={t('home.actions.pendingReview.empty')}
              onOpen={(taskId) => { navigate(`/code-tasks/${taskId}`); }}
            />
            <ActionSection
              title={t('home.actions.pendingCommit')}
              items={commitTasks?.items ?? []}
              emptyText={t('home.actions.pendingCommit.empty')}
              onOpen={(taskId) => { navigate(`/code-tasks/${taskId}`); }}
            />
          </div>
        </Card>

        <div className="sidebar-stack">
          <Card
            title={t('home.shortcuts.title')}
            subtitle={t('home.shortcuts.subtitle')}
          >
            <div className="shortcut-list">
              <button type="button" className="shortcut-item" onClick={() => { navigate('/start-run'); }}>
                <div className="shortcut-item__title">{t('home.shortcuts.startRun.title')}</div>
                <div className="shortcut-item__body">{t('home.shortcuts.startRun.body')}</div>
              </button>
              <button type="button" className="shortcut-item" onClick={() => { navigate('/runs'); }}>
                <div className="shortcut-item__title">{t('home.shortcuts.runs.title')}</div>
                <div className="shortcut-item__body">{t('home.shortcuts.runs.body')}</div>
              </button>
              <button type="button" className="shortcut-item" onClick={() => { navigate('/code-tasks'); }}>
                <div className="shortcut-item__title">{t('home.shortcuts.codeTasks.title')}</div>
                <div className="shortcut-item__body">{t('home.shortcuts.codeTasks.body')}</div>
              </button>
            </div>
          </Card>
        </div>
      </section>

      <Card
        title={t('home.recentRuns.title')}
        subtitle={t('home.recentRuns.subtitle')}
      >
        {loading && <Loading />}
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {data && (
          <>
            <div className="run-list">
              {data.items.map((run) => (
                <RunRow key={run.runId} run={run} onClick={() => { navigate(`/runs/${run.runId}`); }} />
              ))}
              {data.items.length === 0 && <p className="empty-state">{t('home.recentRuns.empty')}</p>}
            </div>
            <div className="section-footer">
              <Button onClick={() => { navigate('/runs'); }}>
                {t('home.recentRuns.viewAll')}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function SummaryStat({ label, value, detail }: { label: string; value: string; detail: string }): React.ReactElement {
  return (
    <div className="summary-card">
      <div className="summary-card__label">{label}</div>
      <div className="summary-card__value">{value}</div>
      <div className="summary-card__detail">{detail}</div>
    </div>
  );
}

function ActionSection({ title, items, emptyText, onOpen }: {
  title: string;
  items: CodeTaskSummary[];
  emptyText: string;
  onOpen: (taskId: string) => void;
}): React.ReactElement {
  return (
    <section className="action-section">
      <div className="action-section__header">
        <h3 className="action-section__title">{title}</h3>
        <span className="action-section__count">{String(items.length)}</span>
      </div>
      <div className="task-list">
        {items.length === 0 && <p className="empty-state">{emptyText}</p>}
        {items.map((task) => (
          <TaskRow key={`${title}-${task.taskId}`} task={task} onOpen={() => { onOpen(task.taskId); }} />
        ))}
      </div>
    </section>
  );
}

function TaskRow({ task, onOpen }: { task: CodeTaskSummary; onOpen: () => void }): React.ReactElement {
  return (
    <div className="task-row" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen();
      }
    }}>
      <TaskStatusBadge status={task.status} />
      <div className="task-row__content">
        <p className="task-row__title">{task.goal}</p>
        <div className="task-row__meta">{task.taskId}</div>
      </div>
      <div className="task-row__tail">
        <span>{task.target || t('home.task.targetFallback')}</span>
        <span>{t('common.viewDetail')}</span>
      </div>
    </div>
  );
}

function RunRow({ run, onClick }: { run: RunSummary; onClick: () => void }): React.ReactElement {
  return (
    <div className="run-row" onClick={onClick} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick();
      }
    }}>
      <div className="run-row__primary">
        <div className="run-row__stack">
          <RunStatusBadge status={run.status} />
          <span className="run-row__label">{run.runMode}</span>
        </div>
        <div className="run-row__scope">
          {run.scopeType}
          {run.scopeValue ? `: ${run.scopeValue}` : ''}
        </div>
        <div className="run-row__meta">{t('run.detail.id')}: {run.runId}</div>
      </div>

      <div className="run-row__secondary">
        {(run.projectName ?? run.projectId) && (
          <div className="run-row__stack">
            <span className="run-row__pill">{t('run.detail.project', { name: run.projectName ?? run.projectId!.slice(0, 8) })}</span>
          </div>
        )}
        {(run.siteName ?? run.siteId) && (
          <div className="run-row__stack" style={{ marginTop: 8 }}>
            <span className="run-row__pill">{t('run.detail.site', { name: run.siteName ?? run.siteId!.slice(0, 8) })}</span>
          </div>
        )}
      </div>

      <div className="run-row__tail">
        <div className="run-row__stats">✓ {run.passed} · ✗ {run.failed}</div>
        <div className="run-row__time">{run.startedAt.slice(0, 16).replace('T', ' ')}</div>
      </div>
    </div>
  );
}
