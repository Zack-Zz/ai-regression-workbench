import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { Loading, ErrorBanner, Card, KV, Button, Table } from '../components/ui.js';

export function TestcaseExecutionPage(): React.ReactElement {
  const { runId, testcaseId } = useParams<{ runId: string; testcaseId: string }>();
  const navigate = useNavigate();
  const rid = runId ?? '';
  const tid = testcaseId ?? '';
  const { data, loading, error, reload } = useAsync(() => api.getExecutionProfile(rid, tid), [rid, tid]);

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data) return <div>未找到执行详情</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <Button onClick={() => { navigate(`/runs/${rid}`); }}>← 返回</Button>
        <h2 style={{ margin: 0 }}>{tid}</h2>
        <div style={{ flex: 1 }} />
        <Button onClick={() => { navigate(`/runs/${rid}/execution-report`); }}>执行报告</Button>
      </div>

      <Card title="执行概览">
        <KV label="Flow Steps" value={String(data.summary.flowStepCount)} />
        <KV label="UI Actions" value={String(data.summary.uiActionCount)} />
        <KV label="API Calls" value={String(data.summary.apiCallCount)} />
        <KV label="Failed APIs" value={String(data.summary.failedApiCount)} />
      </Card>

      {data.flowSteps.length > 0 && (
        <Card title={`流程步骤 (${String(data.flowSteps.length)})`}>
          <Table
            headers={['Step', 'Flow', '状态', '开始时间', '耗时']}
            rows={data.flowSteps.map((step) => [
              step.stepName,
              step.flowId,
              <span key="success" style={{ color: step.success ? '#2a7' : '#c33' }}>{step.success ? 'success' : 'failed'}</span>,
              step.startedAt,
              step.durationMs !== undefined ? `${String(step.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {data.uiActions.length > 0 && (
        <Card title={`UI 操作 (${String(data.uiActions.length)})`}>
          <Table
            headers={['Type', '状态', '页面', '开始时间', '耗时']}
            rows={data.uiActions.map((action) => [
              action.actionType,
              <span key="success" style={{ color: action.success ? '#2a7' : '#c33' }}>{action.success ? 'success' : 'failed'}</span>,
              action.pageUrl ?? '-',
              action.startedAt,
              action.durationMs !== undefined ? `${String(action.durationMs)}ms` : '-',
            ])}
          />
        </Card>
      )}

      {data.apiCalls.length > 0 && (
        <Card title={`接口调用 (${String(data.apiCalls.length)})`}>
          <Table
            headers={['Method', 'URL', 'Status', '耗时', '摘要/错误']}
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
