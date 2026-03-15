import React from 'react';
import { t } from '../i18n.js';
import type { RunStatus, CodeTaskStatus } from '../types.js';

export function Loading(): React.ReactElement {
  return <div style={{ padding: '1rem', color: '#888' }}>{t('common.loading')}</div>;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div style={{ padding: '0.75rem 1rem', background: '#fee', border: '1px solid #fcc', borderRadius: 4, color: '#c00' }}>
      <strong>{t('common.error')}:</strong> {message}
      {onRetry && <button onClick={onRetry} style={{ marginLeft: '1rem' }}>{t('common.retry')}</button>}
    </div>
  );
}

const RUN_STATUS_COLOR: Record<string, string> = {
  COMPLETED: '#2a7', FAILED: '#c33', CANCELLED: '#888', PAUSED: '#f90',
  RUNNING_TESTS: '#36c', RUNNING_EXPLORATION: '#36c', AWAITING_REVIEW: '#a60',
};

const TASK_STATUS_COLOR: Record<string, string> = {
  SUCCEEDED: '#2a7', COMMITTED: '#2a7', FAILED: '#c33', REJECTED: '#c33',
  CANCELLED: '#888', RUNNING: '#36c', VERIFYING: '#36c',
  APPROVED: '#0a0', PENDING_APPROVAL: '#f90', COMMIT_PENDING: '#a60',
};

export function StatusBadge({ status, type = 'run' }: { status: string; type?: 'run' | 'task' }): React.ReactElement {
  const color = (type === 'task' ? TASK_STATUS_COLOR[status] : RUN_STATUS_COLOR[status]) ?? '#555';
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: color, color: '#fff', fontSize: '0.8em', fontWeight: 600 }}>
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

export function Button({ children, onClick, disabled, variant = 'default' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
}): React.ReactElement {
  const bg = variant === 'primary' ? '#36c' : variant === 'danger' ? '#c33' : '#eee';
  const fg = variant === 'default' ? '#333' : '#fff';
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: '6px 14px', background: bg, color: fg, border: 'none', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  );
}

export function Card({ children, title }: { children: React.ReactNode; title?: string }): React.ReactElement {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, marginBottom: '1rem', overflow: 'hidden' }}>
      {title && <div style={{ padding: '0.5rem 1rem', background: '#f5f5f5', borderBottom: '1px solid #ddd', fontWeight: 600 }}>{title}</div>}
      <div style={{ padding: '1rem' }}>{children}</div>
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
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
        <thead>
          <tr>{headers.map(h => <th key={h} style={{ padding: '6px 10px', background: '#f5f5f5', borderBottom: '1px solid #ddd', textAlign: 'left' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
              {row.map((cell, j) => <td key={j} style={{ padding: '6px 10px' }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
