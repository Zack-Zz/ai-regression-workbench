export { HarnessSessionManager } from './session-manager.js';
export type {
  StartSessionInput,
  StepRecord,
  CheckpointData,
  ApprovalRecord,
  PromptSampleRecord,
  StopConditionResult,
} from './session-manager.js';

export { ToolRegistry } from './tool-registry.js';
export type { ToolCallRecord, ToolCallResult, ToolHandler, ToolDescriptor } from './tool-registry.js';

export { ToolExecutionPlanner } from './tool-execution-planner.js';
export type { PlannedToolCall, ToolPlanningContext, ToolExecutionPlannerResult } from './tool-execution-planner.js';

export { ArtifactWriter } from './artifact-writer.js';
export type { GenerateArtifactsInput, GenerateArtifactsResult } from './artifact-writer.js';

export {
  DEFAULT_EXPLORATION_POLICY,
  DEFAULT_CODE_REPAIR_POLICY,
} from './harness-policy.js';
export type { HarnessPolicy, StopConditions } from './harness-policy.js';

export { ObservedHarness } from './observed-harness.js';
export type {
  ObservabilityAdapter,
  ObservabilityEvent,
  ObservabilitySummary,
} from './observability.js';

export {
  EXPLORATION_AGENT_PROFILE,
  CODE_REPAIR_AGENT_PROFILE,
  PLAN_AGENT_PROFILE,
  VERIFICATION_AGENT_PROFILE,
} from './agent-profile.js';
export type { AgentRole, AgentProfile } from './agent-profile.js';

export { AgentContextAssembler } from './agent-context-assembler.js';
export type { AgentAssemblyInput, CodeRepairContext } from './agent-context-assembler.js';

export {
  buildApproxBudgetSnapshot,
  estimateApproxTokens,
  isApproxBudgetExceeded,
} from './budget.js';
export type { ApproxBudgetSnapshot } from './budget.js';
