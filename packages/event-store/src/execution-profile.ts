import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TestcaseExecutionProfile, ApiCallItem, UiActionItem, FlowStepItem } from '@zarb/shared-types';
import type { Db, ApiCallRow, UiActionRow, FlowStepRow } from '@zarb/storage';
import { ApiCallRepository, UiActionRepository, FlowStepRepository, executionProfilePath } from '@zarb/storage';

function toApiCall(r: ApiCallRow): ApiCallItem {
  const item: ApiCallItem = { id: r.id, url: r.url, success: r.success === 1, startedAt: r.started_at };
  if (r.flow_step_id) item.flowStepId = r.flow_step_id;
  if (r.ui_action_id) item.uiActionId = r.ui_action_id;
  if (r.method) item.method = r.method;
  if (r.status_code != null) item.statusCode = r.status_code;
  if (r.response_summary) item.responseSummary = r.response_summary;
  if (r.error_type) item.errorType = r.error_type;
  if (r.error_message) item.errorMessage = r.error_message;
  if (r.trace_id) item.traceId = r.trace_id;
  if (r.request_id) item.requestId = r.request_id;
  if (r.ended_at) item.endedAt = r.ended_at;
  if (r.duration_ms != null) item.durationMs = r.duration_ms;
  return item;
}

function toUiAction(r: UiActionRow, apiRows: ApiCallRow[]): UiActionItem {
  const item: UiActionItem = { id: r.id, actionType: r.action_type, success: r.success === 1, startedAt: r.started_at };
  if (r.flow_step_id) item.flowStepId = r.flow_step_id;
  if (r.locator) item.locator = r.locator;
  if (r.page_url) item.pageUrl = r.page_url;
  if (r.ended_at) item.endedAt = r.ended_at;
  if (r.duration_ms != null) item.durationMs = r.duration_ms;
  if (r.api_call_count != null) item.apiCallCount = r.api_call_count;
  if (r.failed_api_count != null) item.failedApiCount = r.failed_api_count;
  const ids = apiRows.filter((a) => a.ui_action_id === r.id).map((a) => a.id);
  if (ids.length > 0) item.apiCallIds = ids;
  return item;
}

function toFlowStep(r: FlowStepRow, uiRows: UiActionRow[], apiRows: ApiCallRow[]): FlowStepItem {
  const item: FlowStepItem = { id: r.id, flowId: r.flow_id, stepName: r.step_name, success: r.success === 1, startedAt: r.started_at };
  if (r.ended_at) item.endedAt = r.ended_at;
  if (r.duration_ms != null) item.durationMs = r.duration_ms;
  if (r.ui_action_count != null) item.uiActionCount = r.ui_action_count;
  if (r.api_call_count != null) item.apiCallCount = r.api_call_count;
  if (r.failed_api_count != null) item.failedApiCount = r.failed_api_count;
  const uiIds = uiRows.filter((u) => u.flow_step_id === r.id).map((u) => u.id);
  if (uiIds.length > 0) item.uiActionIds = uiIds;
  const apiIds = apiRows.filter((a) => a.flow_step_id === r.id).map((a) => a.id);
  if (apiIds.length > 0) item.apiCallIds = apiIds;
  return item;
}

export class ExecutionProfileBuilder {
  private readonly apiRepo: ApiCallRepository;
  private readonly uiRepo: UiActionRepository;
  private readonly flowRepo: FlowStepRepository;

  constructor(db: Db) {
    this.apiRepo = new ApiCallRepository(db);
    this.uiRepo = new UiActionRepository(db);
    this.flowRepo = new FlowStepRepository(db);
  }

  build(runId: string, testcaseId: string, dataRoot: string, scenarioId?: string): TestcaseExecutionProfile {
    const apiRows = this.apiRepo.findByTestcase(runId, testcaseId);
    const uiRows = this.uiRepo.findByTestcase(runId, testcaseId);
    const flowRows = this.flowRepo.findByTestcase(runId, testcaseId);

    const apiCalls = apiRows.map(toApiCall);
    const uiActions = uiRows.map((r) => toUiAction(r, apiRows));
    const flowSteps = flowRows.map((r) => toFlowStep(r, uiRows, apiRows));

    const profile: TestcaseExecutionProfile = {
      runId,
      testcaseId,
      summary: {
        flowStepCount: flowSteps.length,
        uiActionCount: uiActions.length,
        apiCallCount: apiCalls.length,
        failedApiCount: apiCalls.filter((a) => !a.success).length,
      },
      flowSteps,
      uiActions,
      apiCalls,
    };
    if (scenarioId) profile.scenarioId = scenarioId;

    const absPath = join(dataRoot, executionProfilePath(runId, testcaseId));
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, JSON.stringify(profile, null, 2), 'utf8');
    return profile;
  }

  readFromDisk(runId: string, testcaseId: string, dataRoot: string): TestcaseExecutionProfile | null {
    try {
      return JSON.parse(readFileSync(join(dataRoot, executionProfilePath(runId, testcaseId)), 'utf8')) as TestcaseExecutionProfile;
    } catch {
      return null;
    }
  }
}
