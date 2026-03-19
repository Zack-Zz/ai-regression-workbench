import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, TaskStatusBadge, Card, KV, Button } from '../components/ui.js';
import type { SubmitReviewInput } from '../types.js';

const CANCELLABLE_TASK_STATUSES = new Set([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'RUNNING',
  'COMMIT_PENDING',
]);

export function CodeTaskDetailPage(): React.ReactElement {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const id = taskId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getCodeTask(id), [id]);

  const [reviewDecision, setReviewDecision] = useState<'accept' | 'reject' | 'retry'>('accept');
  const [reviewComment, setReviewComment] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  async function doAction(fn: () => Promise<unknown>): Promise<void> {
    setActionLoading(true);
    try { await fn(); reload(); } catch (e: unknown) { alert(e instanceof Error ? e.message : String(e)); } finally { setActionLoading(false); }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div>{t('common.notFound')}</div>;

  const { summary, reviews, commit, changedFiles, verificationCommands, diffPath, patchPath, rawOutputPath, verifyOutputPath } = data;
  const diffUrl = diffPath ? api.getCodeTaskArtifactUrl(id, 'diff') : null;
  const patchUrl = patchPath ? api.getCodeTaskArtifactUrl(id, 'patch') : null;
  const rawOutputUrl = rawOutputPath ? api.getCodeTaskArtifactUrl(id, 'raw-output') : null;
  const verifyOutputUrl = verifyOutputPath ? api.getCodeTaskArtifactUrl(id, 'verify-output') : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Button onClick={() => { navigate(-1); }}>← {t('common.back')}</Button>
        <h2 style={{ margin: 0 }}>{summary.taskId}</h2>
        <TaskStatusBadge status={summary.status} />
        <div style={{ flex: 1 }} />
        {summary.status === 'DRAFT' || summary.status === 'PENDING_APPROVAL'
          ? <Button variant="primary" disabled={actionLoading} onClick={() => { void doAction(() => api.approveCodeTask(id)); }}>{t('task.approve')}</Button>
          : null}
        {summary.status === 'APPROVED'
          ? <Button variant="primary" disabled={actionLoading} onClick={() => { void doAction(() => api.executeCodeTask(id)); }}>{t('task.execute')}</Button>
          : null}
        {CANCELLABLE_TASK_STATUSES.has(summary.status)
          ? <Button variant="danger" disabled={actionLoading} onClick={() => { void doAction(() => api.cancelCodeTask(id)); }}>{t('task.cancel')}</Button>
          : null}
        {['FAILED', 'REJECTED'].includes(summary.status)
          ? <Button disabled={actionLoading} onClick={() => { void doAction(() => api.retryCodeTask(id)); }}>{t('task.retry')}</Button>
          : null}
      </div>

      <Card>
        <KV label={t('task.goal')} value={summary.goal} />
        <KV label={t('task.workspace')} value={summary.workspacePath} />
        <KV label={t('task.mode')} value={summary.mode} />
        <KV label={t('task.target')} value={summary.target} />
        {summary.agentName && <KV label={t('task.agent')} value={summary.agentName} />}
        {summary.verifyPassed !== undefined && <KV label={t('task.verifyResult')} value={summary.verifyPassed ? '✓ 通过' : '✗ 失败'} />}
        {summary.parentTaskId && <KV label="父任务" value={summary.parentTaskId} />}
        <KV label="版本" value={`v${String(summary.taskVersion)}`} />
      </Card>

      {changedFiles.length > 0 && (
        <Card title={t('task.changedFiles')}>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em' }}>
            {changedFiles.map(f => <li key={f}>{f}</li>)}
          </ul>
        </Card>
      )}

      {(diffUrl ?? patchUrl ?? rawOutputUrl ?? verifyOutputUrl) && (
        <Card title="产物">
          {diffUrl && <KV label="Diff" value={<a href={diffUrl} target="_blank" rel="noreferrer">查看</a>} />}
          {patchUrl && <KV label="Patch" value={<a href={patchUrl} target="_blank" rel="noreferrer">下载</a>} />}
          {rawOutputUrl && <KV label="Raw Output" value={<a href={rawOutputUrl} target="_blank" rel="noreferrer">查看</a>} />}
          {verifyOutputUrl && <KV label="Verify Output" value={<a href={verifyOutputUrl} target="_blank" rel="noreferrer">查看</a>} />}
        </Card>
      )}

      {verificationCommands.length > 0 && (
        <Card title="验证命令">
          <code style={{ fontSize: '0.85em' }}>{verificationCommands.join(' && ')}</code>
        </Card>
      )}

      {/* Review panel — show when task has succeeded verification or is in a reviewable state */}
      {(['SUCCEEDED', 'FAILED'] as string[]).includes(summary.status) ? (
        <Card title={t('review.submitReview')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['accept', 'reject', 'retry'] as const).map(d => (
                <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input type="radio" name="decision" value={d} checked={reviewDecision === d} onChange={() => { setReviewDecision(d); }} />
                  {t(`review.${d}`)}
                </label>
              ))}
            </div>
            <textarea placeholder={t('review.comment')} value={reviewComment} onChange={e => { setReviewComment(e.target.value); }} rows={2} style={{ padding: '4px 8px', resize: 'vertical' }} />
            <div>
              <Button variant="primary" disabled={actionLoading} onClick={() => {
                const input: SubmitReviewInput = { taskId: id, decision: reviewDecision, codeTaskVersion: summary.taskVersion };
                if (reviewComment) input.comment = reviewComment;
                if (summary.verifyPassed === false && reviewDecision === 'accept') input.forceReviewOnVerifyFailure = true;
                void doAction(() => api.submitReview(input));
              }}>{t('review.submitReview')}</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Commit panel */}
      {summary.status === 'COMMIT_PENDING' && !commit && (
        <Card title={t('review.createCommit')}>
          {summary.verifyPassed === false && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 4, marginBottom: '0.5rem', fontSize: '0.9em' }}>
              ⚠ verify 失败后提交属于 override，请确认已知晓风险。
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input value={commitMsg} onChange={e => { setCommitMsg(e.target.value); }} placeholder={t('review.commitMessage')} style={{ flex: 1, padding: '4px 8px' }} />
            <Button variant="primary" disabled={actionLoading || !commitMsg} onClick={() => { void doAction(() => api.createCommit({ taskId: id, commitMessage: commitMsg, expectedTaskVersion: summary.taskVersion })); }}>
              {t('review.createCommit')}
            </Button>
          </div>
          <div style={{ fontSize: '0.8em', color: '#888', marginTop: 4 }}>expectedTaskVersion: {String(summary.taskVersion)}</div>
        </Card>
      )}

      {reviews.length > 0 && (
        <Card title={t('task.reviews')}>
          {reviews.map(r => (
            <div key={r.reviewId} style={{ padding: '0.4rem 0', borderBottom: '1px solid #eee', fontSize: '0.9em', display: 'flex', gap: '1rem' }}>
              <span style={{ fontWeight: 600, color: r.decision === 'accept' ? '#2a7' : r.decision === 'reject' ? '#c33' : '#f90' }}>{t(`review.${r.decision}`)}</span>
              <span style={{ color: '#555' }}>v{r.codeTaskVersion}</span>
              {r.comment && <span>{r.comment}</span>}
              <span style={{ color: '#888', marginLeft: 'auto' }}>{r.createdAt.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
        </Card>
      )}

      {commit && (
        <Card title={t('task.commit')}>
          <KV label="状态" value={commit.status} />
          {commit.commitSha && <KV label="SHA" value={<code>{commit.commitSha}</code>} />}
          {commit.branchName && <KV label="分支" value={commit.branchName} />}
          {commit.commitMessage && <KV label="信息" value={commit.commitMessage} />}
          {commit.errorMessage && <KV label="错误" value={<span style={{ color: '#c33' }}>{commit.errorMessage}</span>} />}
        </Card>
      )}
    </div>
  );
}
