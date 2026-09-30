/**
 * Canonical owner map consumed by the memory research lab (screening,
 * architecture fingerprint, Draft PR evidence packet). Paths are the single
 * canonical owner per responsibility on current main; the lab only reads them.
 */
import { createHash } from "node:crypto";
import type { CandidateCategory } from "@/lib/memoryResearch/types";

export type MemoryOwnerId =
  | "raw_history"
  | "rolling_summary"
  | "global_current_memory"
  | "medium_term"
  | "relationship_durable"
  | "episodic_facts"
  | "lexical_retrieval"
  | "semantic_retrieval"
  | "embedding_index"
  | "reranking_scoring"
  | "episodic_selection"
  | "prompt_packing"
  | "memory_lifecycle"
  | "memory_benchmark"
  | "memory_ci";

export type OwnerEntry = { responsibility: string; paths: readonly string[] };

export const MEMORY_OWNER_MAP: Readonly<Record<MemoryOwnerId, OwnerEntry>> = {
  raw_history: {
    responsibility: "RAW recent-turn window",
    paths: ["src/lib/hybridMemory.ts", "src/lib/memory/memory-constants.ts"],
  },
  rolling_summary: {
    responsibility: "5-turn seal batch summaries",
    paths: ["src/lib/memory/memory-rolling-summary.ts", "src/lib/memory/memory-summary-persist.ts"],
  },
  global_current_memory: {
    responsibility: "Global Current Memory compaction/checkpoint",
    paths: [
      "src/lib/memory/memory-lorebook-resolve.ts",
      "src/lib/memory/memory-global-compaction-execution.ts",
      "src/lib/memory/memory-global-checkpoint.ts",
    ],
  },
  medium_term: {
    responsibility: "Medium-Term sealed-summary ring",
    paths: ["src/lib/memory/memory-medium-term.ts"],
  },
  relationship_durable: {
    responsibility: "Relationship durable meta + tail extraction",
    paths: [
      "src/lib/memory/memory-relationship-meta.ts",
      "src/lib/relationshipMemoryTail.ts",
      "src/lib/memory/memoryRelationshipTask.ts",
    ],
  },
  episodic_facts: {
    responsibility: "Episodic fact extraction + persistence",
    paths: ["src/lib/memory/memory-episodic-extract.ts", "src/lib/episodicMemoryFacts.ts"],
  },
  lexical_retrieval: {
    responsibility: "Retrieval V2 lexical candidate discovery",
    paths: ["src/lib/episodicMemoryFacts.ts"],
  },
  semantic_retrieval: {
    responsibility: "Additive semantic candidate lane (flag-off in production)",
    paths: [
      "src/lib/memory/memory-episodic-semantic-config.ts",
      "src/lib/memory/memory-episodic-semantic-jobs.ts",
    ],
  },
  embedding_index: {
    responsibility: "Embedding transport + in-DB embedding index",
    paths: ["src/lib/openRouterEmbeddings.ts", "src/lib/memory/memory-episodic-semantic-index.ts"],
  },
  reranking_scoring: {
    responsibility: "Final composite scoring of episodic candidates",
    paths: ["src/lib/episodicMemoryFacts.ts"],
  },
  episodic_selection: {
    responsibility: "Episodic retrieval/selection bounds (candidate count / fact count / char budget)",
    paths: ["src/lib/episodicMemoryFacts.ts"],
  },
  prompt_packing: {
    responsibility: "Memory prompt layers + budgets",
    paths: [
      "src/lib/memory/memory-manager.ts",
      "src/lib/memory/memory-injector.ts",
      "src/lib/memory/memory-capacity-shared.ts",
      "src/services/contextBuilder.ts",
    ],
  },
  memory_lifecycle: {
    responsibility: "regen/delete/edit/fork/reset memory continuity",
    paths: [
      "src/lib/memory/memory-branch-control.ts",
      "src/lib/memory/memory-fork-snapshot.ts",
      "src/lib/memory/memory-reconcile.ts",
      "src/lib/memory/memory-source-boundary.ts",
    ],
  },
  memory_benchmark: {
    responsibility: "Deterministic RP memory benchmark (single harness owner)",
    paths: ["src/lib/memory/memory-rp-benchmark.ts", "src/lib/memory/memory-rp-benchmark-suite.ts"],
  },
  memory_ci: {
    responsibility: "Memory CI",
    paths: [".github/workflows/validate-memory-episodic.yml"],
  },
};

export const AUTOMATION_OWNER_MAP: Readonly<Record<string, string>> = {
  runtime_scheduler_definitions: "src/lib/schedulerDefinitions.ts (production in-process jobs only)",
  runtime_scheduler_registry: "src/lib/schedulerRunRegistry.ts (durable slot claims in production SQLite)",
  runtime_cron_jobs: "src/cron/{finance,payout,training}Scheduler.ts",
  training_analysis: "src/lib/training/* (production RP quality analysis/export)",
  memory_research_cycle: ".github/workflows/memory-research-cycle.yml → scripts/memory-research-cycle.ts → src/lib/memoryResearch/cycle.ts",
  memory_research_companion_bridge: "src/lib/memoryResearch/companionExperimentBridge.ts (official-doc technique → canonical-owner experiment-routing evidence only)",
  memory_research_benchmark_adoption: "src/lib/memoryResearch/benchmarkAdoptionBridge.ts (external benchmark ability → local deterministic case-coverage evidence only)",
  memory_research_case_port_planner: "src/lib/memoryResearch/benchmarkCasePortPlanner.ts (benchmark gap → correct local harness/fixture plan; no auto-edit)",
  memory_research_persistent_gap_radar: "src/lib/memoryResearch/persistentGapRadar.ts (same-fingerprint repeated positive-case misses → persistent-gap evidence only)",
  memory_research_harness_feasibility: "src/lib/memoryResearch/benchmarkHarnessFeasibility.ts (case-port plan → measurement feasibility / provider-judge boundary evidence only)",
  memory_research_baseline_trend: "src/lib/memoryResearch/baselineTrend.ts (same-benchmark deterministic baseline drift evidence across research cycles)",
  memory_research_ledger: "orphan branch `memory-research-ledger` (ledger.json + cycles/*.json)",
  memory_research_draft_pr: "src/lib/memoryResearch/draftPr.ts (ACCEPTED-only, `gh pr create --draft`)",
  provider_cost_accounting: "src/lib/providerCostLedger.ts (production spend; research cycle makes 0 paid calls)",
  test_egress_policy: "src/lib/test/regularTestEgressPolicy.ts",
};

/**
 * Owners the deterministic benchmark can actually A/B through a mode input.
 * Adding an id here does not register an experiment adapter and does not
 * change production runtime.
 *
 * - semantic_retrieval / embedding_index → `mode.semantic`
 * - prompt_packing → `mode.packing` leftover policy + supplied higher-priority texts
 * - episodic_selection → `mode.selection` fact/char/candidate bounds
 *
 * Deliberately NOT marked as hooked:
 * - reranking_scoring: score weights/order are not parameterized by BenchmarkMode
 * - global_current_memory: the harness can supply emitted Global text as packing
 *   input, but does not A/B Global compaction/checkpoint generation itself
 */
export const BENCHMARK_HOOKED_OWNERS: readonly MemoryOwnerId[] = [
  "semantic_retrieval",
  "embedding_index",
  "prompt_packing",
  "episodic_selection",
];

export function isBenchmarkOwnerHooked(owner: MemoryOwnerId): boolean {
  return BENCHMARK_HOOKED_OWNERS.includes(owner);
}

export const CATEGORY_OWNERS: Readonly<Record<CandidateCategory, readonly MemoryOwnerId[]>> = {
  conversational_memory: ["episodic_facts", "rolling_summary", "global_current_memory"],
  agent_memory_framework: ["episodic_facts", "global_current_memory", "relationship_durable"],
  rag_retrieval: ["lexical_retrieval", "semantic_retrieval"],
  temporal_memory: ["episodic_facts", "reranking_scoring"],
  graph_memory: ["relationship_durable", "episodic_facts"],
  embedding_model: ["embedding_index", "semantic_retrieval"],
  reranker_model: ["reranking_scoring"],
  long_context: ["prompt_packing", "raw_history"],
  memory_benchmark: ["memory_benchmark"],
  summary_method: ["rolling_summary", "medium_term", "global_current_memory"],
  prompt_packing: ["prompt_packing"],
  companion_roleplay_memory: ["episodic_facts", "relationship_durable", "prompt_packing"],
};

/** sha256 over the benchmarked owner files; a change re-opens benchmark-decided candidates. */
export function computeArchitectureFingerprint(readFile: (path: string) => string): string {
  const hash = createHash("sha256");
  for (const path of architectureFingerprintPaths()) {
    hash.update(path).update("\0").update(readFile(path)).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** Every file whose content defines the architecture a benchmark decision was made against. */
export function architectureFingerprintPaths(): string[] {
  const all = new Set<string>();
  for (const entry of Object.values(MEMORY_OWNER_MAP)) {
    for (const path of entry.paths) {
      if (!path.startsWith(".github/")) all.add(path);
    }
  }
  return [...all].sort();
}

/** Fingerprint only the deterministic benchmark definition/case harness. */
export function computeBenchmarkDefinitionFingerprint(
  readFile: (path: string) => string
): string {
  const hash = createHash("sha256");
  for (const path of MEMORY_OWNER_MAP.memory_benchmark.paths) {
    hash.update(path).update("\0").update(readFile(path)).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
