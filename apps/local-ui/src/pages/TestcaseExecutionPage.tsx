import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Card, KV, Button, Table } from '../components/ui.js';

export function TestcaseExecutionPage(): React.ReactElement {
  const { runId, testcaseId } = useParams<{ runId: string; testcaseId: string }>();
  const navigate = useNavigate();
  const rid = runId ?? '';
  const tid = testcaseId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getExecutionProfile(rid, tid), [rid, tid]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div>{t('testcaseExecution.notFound')}</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Button onClick={() => { navigate(`/runs/${rid}`); }}>← {t('common.back')}</Button>
        <h2 style={{ margin: 0 }}>{tid}</h2>
        <div style={{ flex: 1 }} />
        <Button onClick={() => { navigate(`/runs/${rid}/execution-report`); }}>{t('testcaseExecution.report')}</Button>
      </div>

      <Card title={t('testcaseExecution.overview')}>
        <KV label={t('testcaseExecution.flowStepCount')} value={String(data.summary.flowStepCount)} />
        <KV label={t('testcaseExecution.uiActionCount')} value={String(data.summary.uiActionCount)} />
        <KV label={t('testcaseExecution.apiCallCount')} value={String(data.summary.apiCallCount)} />
        <KV label={t('testcaseExecution.failedApiCount')} value={String(data.summary.failedApiCount)} />
      </Card>

      {data.flowSteps.length > 0 && (
        <Card title={t('testcaseExecution.flowSteps', { count: data.flowSteps.length })}>
          <Table
            headers={[t('testcaseExecution.step'), t('testcaseExecution.flow'), t('common.status'), t('run.startedAt'), t('common.duration')]}
            rows={data.flowSteps.map((step) => [
              step.stepName,
              step.flowId,
              <span key="success" style={{ color: step.success ? '#2a7' : '#c33' }}>{step.success ? t('testcaseExecution.success') : t('testcaseExecution.failed')}</span>,
              step.startedAt,
              step.durationMs !== undefined ? `${String(step.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {data.uiActions.length > 0 && (
        <Card title={t('testcaseExecution.uiActions', { count: data.uiActions.length })}>
          <Table
            headers={[t('common.type'), t('common.status'), t('testcaseExecution.page'), t('run.startedAt'), t('common.duration')]}
            rows={data.uiActions.map((action) => [
              action.actionType,
              <span key="success" style={{ color: action.success ? '#2a7' : '#c33' }}>{action.success ? t('testcaseExecution.success') : t('testcaseExecution.failed')}</span>,
              action.pageUrl ?? '-',
              action.startedAt,
              action.durationMs !== undefined ? `${String(action.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {data.apiCalls.length > 0 && (
        <Card title={t('testcaseExecution.apiCalls', { count: data.apiCalls.length })}>
          <Table
            headers={[t('common.method'), t('common.url'), t('common.status'), t('common.duration'), t('testcaseExecution.summaryOrError')]}
            rows={data.apiCalls.map((call) => [
              call.method ?? '-',
              <span key="url" style={{ fontSize: '0.8em', wordBreak: 'break-all' }}>{call.url}</span>,
              <span key="status" style={{ color: call.success ? '#2a7' : '#c33' }}>{call.statusCode ?? '-'}</span>,
              call.durationMs !== undefined ? `${String(call.durationMs)}ms` : '-',
              call.responseSummary ?? call.errorMessage ?? '-',
            ])}
          />
        </Card>
      )}
    </div>
  );
}
