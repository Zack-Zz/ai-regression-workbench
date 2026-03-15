import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { t } from '../i18n.js';
import { Loading, ErrorBanner, Card, KV, Button, Table } from '../components/ui.js';

export function ExecutionReportPage(): React.ReactElement {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const id = runId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getExecutionReport(id), [id]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div>{t('common.notFound')}</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Button onClick={() => { navigate(`/runs/${id}`); }}>← {t('common.back')}</Button>
        <h2 style={{ margin: 0 }}>{t('run.executionReport')}</h2>
      </div>

      <Card>
        <KV label={t('run.mode')} value={data.runMode} />
        <KV label={t('common.status')} value={data.status} />
        <KV label={t('run.startedAt')} value={data.startedAt} />
        {data.endedAt && <KV label={t('run.endedAt')} value={data.endedAt} />}
        <KV label="统计" value={`✓${String(data.summary.passed)} ✗${String(data.summary.failed)} ↷${String(data.summary.skipped)} / ${String(data.summary.total)}`} />
        <KV label="流程步骤" value={String(data.totals.flowStepCount)} />
        <KV label="UI 操作" value={String(data.totals.uiActionCount)} />
        <KV label="接口调用" value={String(data.totals.apiCallCount)} />
        <KV label="失败接口" value={String(data.totals.failedApiCount)} />
        {data.fatalReason && <KV label="致命原因" value={<span style={{ color: '#c33' }}>{data.fatalReason}</span>} />}
      </Card>

      {data.degradedSteps.length > 0 && (
        <Card title="降级步骤">
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em' }}>
            {data.degradedSteps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </Card>
      )}

      {data.flowSummaries.length > 0 && (
        <Card title="流程链路摘要">
          <Table
            headers={['Flow ID', '步骤', 'UI 操作', '接口', '失败接口', '耗时']}
            rows={data.flowSummaries.map(f => [f.flowId, String(f.stepCount), String(f.uiActionCount), String(f.apiCallCount), String(f.failedApiCount), f.durationMs !== undefined ? `${String(f.durationMs)}ms` : '-'])}
          />
        </Card>
      )}

      {data.failureReports.length > 0 && (
        <Card title={t('run.failureReports')}>
          {data.failureReports.map(f => (
            <div key={f.testcaseId} style={{ padding: '0.4rem 0', borderBottom: '1px solid #eee', display: 'flex', gap: '1rem', fontSize: '0.9em' }}>
              <button onClick={() => { navigate(`/runs/${id}/testcases/${f.testcaseId}/failure-report`); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#36c', textDecoration: 'underline' }}>{f.testcaseId}</button>
              <span style={{ color: '#c33' }}>{f.errorMessage ?? ''}</span>
            </div>
          ))}
        </Card>
      )}

      {data.warnings && data.warnings.length > 0 && (
        <Card title="警告">
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9em', color: '#f60' }}>
            {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
