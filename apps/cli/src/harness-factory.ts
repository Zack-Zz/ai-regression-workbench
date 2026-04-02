import type { Db } from '@zarb/storage';
import { HarnessSessionManager, ObservedHarness } from '@zarb/agent-harness/runtime';
import type { ObservabilityAdapter } from '@zarb/agent-harness/runtime';

/**
 * createHarness — dependency assembly point for the harness session manager.
 * If an ObservabilityAdapter is provided, wraps the manager in ObservedHarness.
 * Otherwise returns the plain HarnessSessionManager.
 * Observability is always optional: absence of adapter has no effect on behavior.
 * Derived from observability-design.md §4, §8.
 */
export function createHarness(
  db: Db,
  adapter?: ObservabilityAdapter,
  provider?: string,
): HarnessSessionManager | ObservedHarness {
  const inner = new HarnessSessionManager(db);
  if (adapter) return new ObservedHarness(inner, adapter, provider);
  return inner;
}
