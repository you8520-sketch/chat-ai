/**
 * Smallest generation-scoped claim/release for fire-and-forget auxiliary QA.
 * Domain-namespaced so scene-boundary and completion-integrity do not collide.
 *
 * Not a generic queue, Decision Plane, or workflow engine — only:
 * claim(generation+domain) / complete / reset-for-tests.
 */
import {
  generationJobKey,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";

type ClaimSets = {
  running: Set<string>;
  completed: Set<string>;
};

const domains = new Map<string, ClaimSets>();

function setsFor(domain: string): ClaimSets {
  let sets = domains.get(domain);
  if (!sets) {
    sets = { running: new Set(), completed: new Set() };
    domains.set(domain, sets);
  }
  return sets;
}

/** Try to claim exactly-once slot for (domain, assistantMessageId, generationSequence). */
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

/** Release running claim and mark generation completed for this domain. */
export function completeGenerationAuxQaJob(
  domain: string,
  scope: Pick<AssistantGenerationScope, "assistantMessageId" | "generationSequence">
): void {
  const sets = setsFor(domain);
  const key = generationJobKey(scope);
  sets.running.delete(key);
  sets.completed.add(key);
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
