import type { ExperimentAdapter } from "@/lib/memoryResearch/experiments";
import type { LiveExperimentRecipe } from "@/lib/memoryResearch/liveExperimentRecipes";
import {
  BENCHMARK_HOOKED_OWNERS,
  CATEGORY_OWNERS,
  type MemoryOwnerId,
} from "@/lib/memoryResearch/ownerMap";
import type {
  CandidateDecisionCode,
  InfraRequirement,
  ResearchObservation,
} from "@/lib/memoryResearch/types";

export const UNMAINTAINED_AFTER_DAYS = 365;

/** Infra that is unrealistic to adopt wholesale in the TypeScript/Railway single-service architecture. */
const HEAVY_INFRA: readonly InfraRequirement[] = [
  "vector_database",
  "graph_database",
  "gpu_inference",
  "python_runtime",
  "hosted_saas",
];

export type ScreeningResult =
  | { outcome: "EXPERIMENT_ELIGIBLE"; applicableOwners: readonly MemoryOwnerId[]; reason: string }
  | {
      outcome: "STOP";
      decision: CandidateDecisionCode;
      applicableOwners: readonly MemoryOwnerId[];
      reason: string;
    };

/**
 * Deterministic screening on observation metadata only. A STOP result is
 * recorded as WATCH/REJECT and the candidate never reaches the benchmark.
 */
export function screenCandidate(
  observation: ResearchObservation,
  adapter: ExperimentAdapter | undefined,
  now: Date,
  liveRecipe?: LiveExperimentRecipe
): ScreeningResult {
  const applicableOwners = adapter
    ? [adapter.targetOwner]
    : liveRecipe
      ? [liveRecipe.targetOwner]
      : CATEGORY_OWNERS[observation.category];
  const stop = (decision: CandidateDecisionCode, reason: string): ScreeningResult => ({
    outcome: "STOP",
    decision,
    applicableOwners,
    reason,
  });

  if (observation.riskFlags.includes("duplicates_canonical_owner")) {
    return stop("REJECTED_OWNER_CONFLICT", "would create a parallel owner for an existing canonical memory responsibility");
  }
  if (observation.migrationRequirement === "destructive") {
    return stop("REJECTED_DESTRUCTIVE_MIGRATION", "requires a destructive migration of production memory data");
  }
  if (observation.privacyImplications.some((p) => p !== "none")) {
    return stop(
      "REJECTED_PRIVACY_EXPOSURE",
      `new external exposure of private RP data: ${observation.privacyImplications.filter((p) => p !== "none").join(", ")}`
    );
  }
  if (observation.riskFlags.includes("changes_auth_safety_adult_boundary")) {
    return stop("REJECTED_BOUNDARY_CHANGE", "touches auth/safety/adult boundary");
  }
  if (observation.riskFlags.includes("changes_provider_billing")) {
    return stop("REJECTED_BILLING_CHANGE", "changes provider billing structure");
  }
  if (observation.evidence.archived) {
    return stop("REJECTED_UNMAINTAINED", "source repository is archived");
  }
  if (observation.sourceKind === "github_repository" && observation.evidence.lastActivityAt) {
    const ageDays = (now.getTime() - Date.parse(observation.evidence.lastActivityAt)) / 86_400_000;
    if (ageDays > UNMAINTAINED_AFTER_DAYS) {
      return stop("REJECTED_UNMAINTAINED", `no repository activity for ${Math.floor(ageDays)} days`);
    }
  }
  const heavy = observation.infraRequirements.filter((i) => HEAVY_INFRA.includes(i));
  if (heavy.length > 0 && !adapter && !liveRecipe) {
    return stop(
      "REJECTED_INFRA_COMPLEXITY",
      `wholesale adoption needs ${heavy.join(", ")}; only a TypeScript-native port of the technique is evaluable`
    );
  }
  if (!observation.evidence.hasReproducibleCode && !observation.evidence.hasPublishedBenchmark) {
    return stop("WATCH_INSUFFICIENT_EVIDENCE", "no reproducible code or published benchmark behind the claim");
  }
  if (observation.category === "memory_benchmark") {
    return stop(
      "WATCH_NO_BENCHMARK_HOOK",
      "benchmark release: evaluable only by porting its cases into memory-rp-benchmark-suite.ts (same-owner extension)"
    );
  }
  if (!applicableOwners.some((owner) => BENCHMARK_HOOKED_OWNERS.includes(owner))) {
    return stop(
      "WATCH_NO_BENCHMARK_HOOK",
      `the deterministic benchmark has no A/B hook for ${applicableOwners.join(", ")} yet`
    );
  }
  if (!adapter && liveRecipe) {
    return stop(
      "WATCH_LIVE_EXPERIMENT_PENDING",
      `safe live recipe ${liveRecipe.id}@${liveRecipe.recipeVersion} is registered; await the isolated monthly live benchmark`
    );
  }
  if (!adapter) {
    return stop("WATCH_NO_EXPERIMENT_ADAPTER", "benchmarkable owner, but no lab experiment adapter is registered");
  }
  return { outcome: "EXPERIMENT_ELIGIBLE", applicableOwners, reason: `adapter ${adapter.adapterVersion} registered` };
}
