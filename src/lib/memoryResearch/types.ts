/**
 * Automated Memory Improvement System — candidate model.
 *
 * READER AUDIT: research-lab only. No production runtime module may import
 * anything under `src/lib/memoryResearch/` (enforced by
 * `memoryResearchIsolation.test.ts`). The lab reads production memory owners
 * through the deterministic benchmark harness; it never writes to them.
 */
import type { MemoryOwnerId } from "@/lib/memoryResearch/ownerMap";

export type ResearchSourceKind = "github_repository" | "arxiv";

export type CandidateCategory =
  | "conversational_memory"
  | "agent_memory_framework"
  | "rag_retrieval"
  | "temporal_memory"
  | "graph_memory"
  | "embedding_model"
  | "reranker_model"
  | "long_context"
  | "memory_benchmark"
  | "summary_method"
  | "prompt_packing"
  | "companion_roleplay_memory";

export type CandidateLifecycleState =
  | "RESEARCHED"
  | "SCREENED"
  | "EXPERIMENT_ELIGIBLE"
  | "BENCHMARKED"
  | "ACCEPTED"
  | "REJECTED"
  | "WATCH";

export type CandidateDecisionCode =
  | "ACCEPTED_QUALITY_GAIN"
  | "REJECTED_NO_QUALITY_GAIN"
  | "REJECTED_PRECISION_REGRESSION"
  | "REJECTED_FALSE_MEMORY_REGRESSION"
  | "REJECTED_STALE_STATE_REGRESSION"
  | "REJECTED_QUALITY_REGRESSION"
  | "REJECTED_COST_REGRESSION"
  | "REJECTED_LATENCY_REGRESSION"
  | "REJECTED_OWNER_CONFLICT"
  | "REJECTED_INFRA_COMPLEXITY"
  | "REJECTED_DESTRUCTIVE_MIGRATION"
  | "REJECTED_PRIVACY_EXPOSURE"
  | "REJECTED_BOUNDARY_CHANGE"
  | "REJECTED_BILLING_CHANGE"
  | "REJECTED_UNMAINTAINED"
  | "WATCH_INSUFFICIENT_EVIDENCE"
  | "WATCH_NO_EXPERIMENT_ADAPTER"
  | "WATCH_NO_BENCHMARK_HOOK"
  | "WATCH_BENCHMARK_FAILED"
  | "WATCH_LIVE_EXPERIMENT_PENDING"
  | "WATCH_IMPLEMENTATION_PR_PENDING";

/** Infra/risk flags declared by curated watchlist metadata or inferred from source text. */
export type InfraRequirement =
  | "none"
  | "vector_database"
  | "graph_database"
  | "gpu_inference"
  | "python_runtime"
  | "hosted_saas"
  | "extra_llm_calls_per_turn"
  | "new_embedding_provider";

export type PrivacyImplication =
  | "none"
  | "sends_rp_text_to_new_external_service"
  | "stores_rp_text_in_new_external_store";

export type MigrationRequirement = "none" | "additive" | "destructive";

/** A single observation of a technology produced by a source adapter. */
export type ResearchObservation = {
  candidateKey: string;
  sourceKind: ResearchSourceKind;
  sourceUrl: string;
  title: string;
  version: string | null;
  publishedAt: string | null;
  summary: string;
  claimedAdvantage: string;
  category: CandidateCategory;
  /** Repository/paper evidence signals used by screening. */
  evidence: {
    hasReproducibleCode: boolean;
    hasPublishedBenchmark: boolean;
    archived: boolean;
    lastActivityAt: string | null;
  };
  infraRequirements: readonly InfraRequirement[];
  privacyImplications: readonly PrivacyImplication[];
  migrationRequirement: MigrationRequirement;
  /** Screening red flags declared by curated metadata. */
  riskFlags: readonly CandidateRiskFlag[];
};

export type CandidateRiskFlag =
  | "duplicates_canonical_owner"
  | "changes_auth_safety_adult_boundary"
  | "changes_provider_billing";

export type CandidateEvaluation = {
  cycleKey: string;
  evaluatedAt: string;
  version: string | null;
  adapterFingerprint: string | null;
  architectureFingerprint: string;
  state: CandidateLifecycleState;
  decision: CandidateDecisionCode;
  reason: string;
  stateTrail: readonly CandidateLifecycleState[];
};

/** Durable ledger record — one per candidateKey. */
export type ResearchCandidate = {
  candidateKey: string;
  category: CandidateCategory;
  sourceKind: ResearchSourceKind;
  sourceUrl: string;
  title: string;
  version: string | null;
  discoveredAt: string;
  lastSeenAt: string;
  summary: string;
  claimedAdvantage: string;
  applicableOwners: readonly MemoryOwnerId[];
  expectedBenefit: string;
  expectedCost: string;
  infraRequirements: readonly InfraRequirement[];
  privacyImplications: readonly PrivacyImplication[];
  migrationRequirement: MigrationRequirement;
  state: CandidateLifecycleState;
  lastDecision: CandidateDecisionCode | null;
  lastDecisionReason: string;
  /** Set when the latest decision is a rejection; null otherwise. */
  priorRejectionReason: string | null;
  /** Human-readable condition that unlocks reevaluation. */
  reevaluationCondition: string;
  /** Earliest time a WATCH candidate is re-screened without a new trigger. */
  cooldownUntil: string | null;
  evaluations: readonly CandidateEvaluation[];
  /** Draft PR opened for the latest ACCEPTED evaluation; null until creation succeeds. */
  draftPrUrl: string | null;
  /** Latest paid/live lab evidence. Research/runtime code never consumes this. */
  liveExperiment?: {
    recipeId: string;
    recipeVersion: string;
    evaluatedAt: string;
    referenceModel: string;
    candidateModel: string;
    gateDecision: CandidateDecisionCode;
    gateReason: string;
    referenceMetrics: string;
    candidateMetrics: string;
    candidateCostUsdPer1kTurns: number | null;
    referenceCostUsdPer1kTurns: number | null;
    queryP95DeltaMs: number | null;
  } | null;
};
