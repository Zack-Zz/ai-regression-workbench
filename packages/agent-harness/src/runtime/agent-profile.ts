export type AgentRole = 'exploration' | 'code-repair' | 'plan' | 'verify';

export interface AgentProfile {
  role: AgentRole;
  name: string;
  description: string;
  toolNamespaces: string[];
  maxTurns: number;
  reviewOnVerifyFailureAllowed: boolean;
}

export const EXPLORATION_AGENT_PROFILE: AgentProfile = {
  role: 'exploration',
  name: 'ExplorationAgent',
  description: 'Interactive browser exploration runtime with planning, auth recovery, and finding capture.',
  toolNamespaces: ['playwright'],
  maxTurns: 20,
  reviewOnVerifyFailureAllowed: false,
};

export const CODE_REPAIR_AGENT_PROFILE: AgentProfile = {
  role: 'code-repair',
  name: 'CodeRepairAgent',
  description: 'Structured code repair runtime with staged prompt assembly, transport execution, and retry memory.',
  toolNamespaces: ['workspace', 'git', 'verify'],
  maxTurns: 4,
  reviewOnVerifyFailureAllowed: true,
};
