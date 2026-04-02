/**
 * HarnessPolicy — runtime constraints for an agent session.
 * Derived from agent-harness-design.md §3.2.
 */
export interface StopConditions {
  maxFindings?: number;
  stopWhenFocusAreasCovered?: boolean;
  stopWhenNoNewFindingsForSteps?: number;
}

export interface HarnessPolicy {
  sessionBudgetMs: number;
  toolCallTimeoutMs: number;
  allowedHosts: string[];
  allowedWriteScopes: string[];
  requireApprovalFor: string[];
  reviewOnVerifyFailureAllowed: boolean;
  stopConditions?: StopConditions;
}

export const DEFAULT_EXPLORATION_POLICY: HarnessPolicy = {
  sessionBudgetMs: 10 * 60 * 1000,   // 10 min
  toolCallTimeoutMs: 30 * 1000,       // 30 s
  allowedHosts: [],
  allowedWriteScopes: [],
  requireApprovalFor: ['fs.write', 'shell.exec', 'git.commit'],
  reviewOnVerifyFailureAllowed: false,
};

export const DEFAULT_CODE_REPAIR_POLICY: HarnessPolicy = {
  sessionBudgetMs: 10 * 60 * 1000,
  toolCallTimeoutMs: 5 * 60 * 1000,  // 5 min per command
  allowedHosts: [],
  allowedWriteScopes: [],
  requireApprovalFor: ['git.commit'],
  reviewOnVerifyFailureAllowed: true,
};
