/**
 * Smallest generation-scoped claim/release for fire-and-forget auxiliary QA.
 * Domain-namespaced so scene-boundary and completion-integrity do not collide.
 *
 * Not a generic queue, Decision Plane, or workflow engine — only:
 * claim(generation+domain) / complete / reset-for-tests.
 *
 * Duplicate suppression is process-local by design. Completed history is
 * bounded so long-lived workers do not retain one key per generation forever.
 */
import {
  generationJobKey,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";

export const MAX_COMPLETED_AUX_QA_CLAIMS_PER_DOMAIN = 4096;

type ClaimSets = {
  running: Set<string>;
  completed: Map<string, true>;
};

const domains = new Map<string, ClaimSets>();

function setsFor(domain: string): ClaimSets {
  let sets = domains.get(domain);
  if (!sets) {
    sets = { running: new Set(), completed: new Map() };
    domains.set(domain, sets);
  }
  return sets;
}

function rememberCompleted(sets: ClaimSets, key: string): void {
  sets.completed.delete(key);
  sets.completed.set(key, true);
  while (sets.completed.size > MAX_COMPLETED_AUX_QA_CLAIMS_PER_DOMAIN) {
    const oldest = sets.completed.keys().next().value as string | undefined;
    if (!oldest) break;
    sets.completed.delete(oldest);
  }
}

/** Try to claim process-local at-most-once slot for (domain, generation). */
export function tryClaimGenerationAuxQaJob(
  domain: string,
  scope: Pick<AssistantGenerationScope, "assistantMessageId" | "generationSequence">
): boolean {
  const sets = setsFor(domain);
  const key = generationJobKey(scope);
  if (sets.running.has(key) || sets.completed.has(key)) return false;
  sets.running.add(key);
  return true;
}

/** Release running claim and remember completion in a bounded process-local window. */
export function completeGenerationAuxQaJob(
  domain: string,
  scope: Pick<AssistantGenerationScope, "assistantMessageId" | "generationSequence">
): void {
  const sets = setsFor(domain);
  const key = generationJobKey(scope);
  sets.running.delete(key);
  rememberCompleted(sets, key);
}

/** Test-only sentinel reset. Omit domain to clear all aux-QA claim domains. */
export function resetGenerationAuxQaClaimsForTests(domain?: string): void {
  if (domain) {
    const sets = domains.get(domain);
    if (sets) {
      sets.running.clear();
      sets.completed.clear();
    }
    return;
  }
  for (const sets of domains.values()) {
    sets.running.clear();
    sets.completed.clear();
  }
}
