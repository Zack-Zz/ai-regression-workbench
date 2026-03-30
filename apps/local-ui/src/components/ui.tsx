import React from 'react';
import { t } from '../i18n.js';
import type { RunStatus, CodeTaskStatus } from '../types.js';

type StageResultStatus = 'success' | 'degraded' | 'failed' | 'skipped';

function hexToRgba(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const normalized = hex.length === 3
    ? hex.split('').map((value) => value + value).join('')
    : hex;

  if (normalized.length !== 6) return color;

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha)})`;
}

export function Loading(): React.ReactElement {
  return <div className="loading-indicator">{t('common.loading')}</div>;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div className="error-banner">
      <strong>{t('common.error')}:</strong> {message}
      {onRetry && (
        <Button onClick={onRetry} size="sm">
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

const RUN_STATUS_COLOR: Record<string, string> = {
  COMPLETED: '#2a7',
  FAILED: '#c33',
  CANCELLED: '#888',
  PAUSED: '#f59e0b',
  CREATED: '#6b7280',
  RUNNING_TESTS: '#2563eb',
  PLANNING_EXPLORATION: '#2563eb',
  RUNNING_EXPLORATION: '#2563eb',
  COLLECTING_ARTIFACTS: '#0f766e',
  FETCHING_TRACES: '#0f766e',
  FETCHING_LOGS: '#0f766e',
  ANALYZING_FAILURES: '#7c3aed',
  AWAITING_CODE_ACTION: '#ea580c',
  RUNNING_CODE_TASK: '#2563eb',
  AWAITING_REVIEW: '#a16207',
  READY_TO_COMMIT: '#047857',
};

const TASK_STATUS_COLOR: Record<string, string> = {
  DRAFT: '#6b7280',
  SUCCEEDED: '#2a7',
  COMMITTED: '#2a7',
  FAILED: '#c33',
  REJECTED: '#c33',
  CANCELLED: '#888',
  RUNNING: '#36c',
  VERIFYING: '#36c',
  APPROVED: '#0a0',
  PENDING_APPROVAL: '#f90',
  COMMIT_PENDING: '#a60',
};

export function StatusBadge({ status, type = 'run' }: { status: string; type?: 'run' | 'task' }): React.ReactElement {
  const color = (type === 'task' ? TASK_STATUS_COLOR[status] : RUN_STATUS_COLOR[status]) ?? '#555';
  return (
    <span
      className="status-badge"
      style={{
        borderColor: hexToRgba(color, 0.18),
        background: hexToRgba(color, 0.12),
        color,
      }}
    >
      {t(`status.${status}`)}
    </span>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }): React.ReactElement {
  return <StatusBadge status={status} type="run" />;
}

export function TaskStatusBadge({ status }: { status: CodeTaskStatus }): React.ReactElement {
  return <StatusBadge status={status} type="task" />;
}

export function Button({ children, onClick, disabled, variant = 'default', type = 'button', size = 'md', style, className, title }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  type?: 'button' | 'submit' | 'reset';
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
  className?: string;
  title?: string;
}): React.ReactElement {
  const classes = [
    'ui-button',
    variant !== 'default' ? `ui-button--${variant}` : '',
    size === 'sm' ? 'ui-button--sm' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classes} style={style} title={title}>
      {children}
    </button>
  );
}

export function Card({
  children,
  title,
  subtitle,
  actions,
  className,
  bodyClassName,
}: {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}): React.ReactElement {
  const cardClassName = ['ui-card', className ?? ''].filter(Boolean).join(' ');
  const headerClassName = ['ui-card__header', title || subtitle || actions ? 'ui-card__header--with-body' : ''].filter(Boolean).join(' ');
  const contentClassName = ['ui-card__body', bodyClassName ?? ''].filter(Boolean).join(' ');

  return (
    <div className={cardClassName}>
      {(title || subtitle || actions) && (
        <div className={headerClassName}>
          <div>
            {title && <h3 className="ui-card__title">{title}</h3>}
            {subtitle && <p className="ui-card__subtitle">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={contentClassName}>{children}</div>
    </div>
  );
}

export function KV({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', fontSize: '0.9em' }}>
      <span style={{ color: '#666', minWidth: 140 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }): React.ReactElement {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <thead>
          <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => <td key={j}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StageResultsList({
  stages,
  currentStage,
  live = false,
}: {
  stages: Array<{ stage: string; status: StageResultStatus; message?: string }>;
  currentStage?: string | undefined;
  live?: boolean;
}): React.ReactElement {
  const doneCount = stages.filter((stage) => stage.status === 'success').length;
  const progress = stages.length > 0 ? Math.round((doneCount / stages.length) * 100) : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 160, fontSize: '0.85em', color: '#4b5563' }}>
          {doneCount}/{stages.length} {t('stage.status.success')}
        </div>
        <div style={{ flex: 1, minWidth: 180, height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
          <div
            style={{
              width: `${String(progress)}%`,
              height: '100%',
              background: live ? 'linear-gradient(90deg, #2563eb, #0f766e)' : '#9ca3af',
              transition: 'width 180ms ease-out',
            }}
          />
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            padding: '0.25rem 0.65rem',
            background: live ? '#eff6ff' : '#f3f4f6',
            color: live ? '#1d4ed8' : '#6b7280',
            fontSize: '0.8em',
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: live ? '#2563eb' : '#9ca3af',
              boxShadow: live ? '0 0 0 3px rgba(37, 99, 235, 0.12)' : 'none',
            }}
          />
          {live ? t('run.reportLive') : t('run.reportSnapshot')}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {stages.map((stage, index) => {
          const isCurrent = currentStage === stage.stage;
          const tone = stage.status === 'success'
            ? { border: '#86efac', bg: '#f0fdf4', fg: '#166534', accent: '#16a34a', marker: '✓' }
            : stage.status === 'failed'
              ? { border: '#fca5a5', bg: '#fef2f2', fg: '#b91c1c', accent: '#dc2626', marker: '×' }
              : stage.status === 'degraded'
                ? { border: '#bfdbfe', bg: '#eff6ff', fg: '#1d4ed8', accent: '#2563eb', marker: String(index + 1) }
                : { border: '#e5e7eb', bg: '#f9fafb', fg: '#6b7280', accent: '#9ca3af', marker: String(index + 1) };
          return (
            <div
              key={`${stage.stage}-${index}`}
              style={{
                border: `1px solid ${tone.border}`,
                background: tone.bg,
                borderRadius: 10,
                padding: '0.8rem 0.9rem',
                display: 'grid',
                gridTemplateColumns: '40px minmax(0, 1fr)',
                gap: '0.85rem',
                alignItems: 'start',
                boxShadow: isCurrent ? '0 0 0 3px rgba(37, 99, 235, 0.08)' : 'none',
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  background: tone.accent,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                }}
              >
                {tone.marker}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: '#111827' }}>{t(`status.${stage.stage}`)}</span>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.15rem 0.5rem',
                      borderRadius: 999,
                      background: '#fff',
                      color: tone.fg,
                      fontSize: '0.78em',
                      fontWeight: 700,
                    }}
                  >
                    {t(`stage.status.${stage.status}`)}
                  </span>
                  {isCurrent && (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.5rem',
                        borderRadius: 999,
                        background: '#111827',
                        color: '#fff',
                        fontSize: '0.78em',
                        fontWeight: 700,
                      }}
                    >
                      {t('run.stageCurrent')}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 2, fontFamily: 'monospace', fontSize: '0.78em', color: '#6b7280' }}>{stage.stage}</div>
                {stage.message && (
                  <div style={{ marginTop: '0.45rem', color: '#374151', fontSize: '0.9em', lineHeight: 1.5 }}>
                    {stage.message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ImagePreviewModal({ src, title, onClose }: { src: string; title?: string; onClose: () => void }): React.ReactElement {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => { e.stopPropagation(); }}
        style={{
          maxWidth: 'min(1100px, 92vw)',
          maxHeight: '92vh',
          background: '#fff',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(15, 23, 42, 0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb', background: '#f8fafc' }}>
          <div style={{ fontWeight: 600 }}>{title ?? 'Image Preview'}</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1.25rem', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '1rem', background: '#0f172a' }}>
          <img src={src} alt={title ?? 'preview'} style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(92vh - 110px)', margin: '0 auto', objectFit: 'contain' }} />
        </div>
      </div>
    </div>
  );
}
