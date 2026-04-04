export type AgentRole = 'exploration' | 'code-repair' | 'plan' | 'verify';

export interface AgentProfile {
  role: AgentRole;
  name: string;
  description: string;
  toolNamespaces: string[];
  maxTurns: number;
  approxTokenBudget?: number;
  reviewOnVerifyFailureAllowed: boolean;
}

export const EXPLORATION_AGENT_PROFILE: AgentProfile = {
  role: 'exploration',
  name: 'ExplorationAgent',
  description: 'Interactive browser exploration runtime with planning, auth recovery, and finding capture.',
  toolNamespaces: ['playwright'],
  maxTurns: 20,
  approxTokenBudget: 10_000,
  reviewOnVerifyFailureAllowed: false,
};

export const CODE_REPAIR_AGENT_PROFILE: AgentProfile = {
  role: 'code-repair',
  name: 'CodeRepairAgent',
  description: 'Structured code repair runtime with staged prompt assembly, transport execution, and retry memory.',
  toolNamespaces: ['workspace', 'git', 'verify'],
  maxTurns: 4,
  approxTokenBudget: 12_000,
  reviewOnVerifyFailureAllowed: true,
};

export const PLAN_AGENT_PROFILE: AgentProfile = {
  role: 'plan',
  name: 'ReadOnlyPlanAgent',
  description: 'Read-only planner that extracts likely files, minimal edit strategy, and verification order.',
  toolNamespaces: ['workspace', 'memory'],
  maxTurns: 1,
  reviewOnVerifyFailureAllowed: false,
};

export const VERIFICATION_AGENT_PROFILE: AgentProfile = {
  role: 'verify',
  name: 'VerificationAgent',
  description: 'Independent verifier that summarizes adversarial checks and recommends pass, retry, or manual review.',
  toolNamespaces: ['verify', 'workspace', 'git'],
  maxTurns: 1,
  reviewOnVerifyFailureAllowed: false,
};
