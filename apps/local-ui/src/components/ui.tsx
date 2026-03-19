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

export function Button({ children, onClick, disabled, variant = 'default', type = 'button', style }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  type?: 'button' | 'submit' | 'reset';
  style?: React.CSSProperties;

}): React.ReactElement {
  const bg = variant === 'primary' ? '#36c' : variant === 'danger' ? '#c33' : '#eee';
  const fg = variant === 'default' ? '#333' : '#fff';
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{ padding: '6px 14px', background: bg, color: fg, border: 'none', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, ...style }}>
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
