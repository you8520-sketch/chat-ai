/**
 * Canonical configuration owner for episodic semantic candidate discovery.
 *
 * Every model id, dimension, similarity threshold, scorer weight, lane weight,
 * and input bound used by the semantic index, the embeddings transport caller,
 * the semantic candidate lane, and the final scorer is defined here once.
 *
 * STATUS: BGE-M3 is the approved initial production semantic model after the
 * live benchmark on PR #1079. Other candidates remain provisional / benchmark
 * only. Runtime activation still requires the separate feature flag plus an
 * APPROVED config, so approval alone does not enable production retrieval.
 */
import type { Route } from "@/lib/ai";
export type EpisodicSemanticConfigStatus = "PROVISIONAL_LIVE_BENCHMARK_PENDING" | "APPROVED";

export type EpisodicSemanticModelConfig = {
  /** OpenRouter embeddings model slug. */
  modelId: string;
  /** Expected vector length returned by the provider (fail-closed on mismatch). */
  dimensions: number;
  /** Sent as the official `dimensions` request field only when set. */
  requestDimensions?: number;
  /**
   * Explicit response-model aliases observed/approved for this OpenRouter model.
   * Transport matching is case-insensitive but never strips arbitrary vendor or
   * provider prefixes; only these configured aliases may differ from modelId.
   */
  responseModelAliases?: readonly string[];
  /** Bumps whenever any number below changes; recorded in diagnostics. */
  configVersion: string;
  status: EpisodicSemanticConfigStatus;
  /** Minimum cosine similarity for semantic lane admission AND final relevance evidence. */
  similarityPassThreshold: number;
  /** Composite-score weight applied to similarity for facts passing the threshold. */
  semanticScoreWeight: number;
  /**
   * Max share of the fixed candidateLimit the semantic lane may fill. Only
   * slots it actually fills are taken from the lexical lanes.
   */
  semanticLaneMaxShare: number;
};

/** Ledger/provenance identity; the canonical cost-center classifier maps it to `memory`. */
export const EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND = "background-memory-episodic-embedding";

/**
 * Only facts stamped at write time with this canonical per-turn content route
 * (`resolveEffectiveAdultRp` → Route) may be sent for indexing, and only a turn
 * on this route may embed its query. Unstamped/legacy facts are excluded.
 */
export const EPISODIC_SEMANTIC_INDEXABLE_CONTENT_ROUTE: Route = "safe";

/** Max canonical rows scanned per index job when looking for pending facts. */
export const EPISODIC_SEMANTIC_INDEX_SCAN_ROWS = 500;

/** Input bounds for anything sent to the embeddings provider. */
export const EPISODIC_SEMANTIC_MAX_QUERY_CHARS = 500;
export const EPISODIC_SEMANTIC_MAX_FACT_CHARS = 400;
export const EPISODIC_SEMANTIC_INDEX_BATCH_SIZE = 16;
export const EPISODIC_SEMANTIC_QUERY_TIMEOUT_MS = 2_500;
export const EPISODIC_SEMANTIC_INDEX_TIMEOUT_MS = 15_000;

export const EPISODIC_SEMANTIC_MODEL_CANDIDATES = {
  bge_m3: {
    modelId: "baai/bge-m3",
    dimensions: 1024,
    responseModelAliases: ["parasail-bge-m3"],
    configVersion: "bge-m3@1024/approved-1",
    status: "APPROVED",
    similarityPassThreshold: 0.5,
    semanticScoreWeight: 4,
    semanticLaneMaxShare: 0.1,
  },
  qwen3_embedding_8b: {
    modelId: "qwen/qwen3-embedding-8b",
    dimensions: 4096,
    configVersion: "qwen3-embedding-8b@4096/provisional-1",
    status: "PROVISIONAL_LIVE_BENCHMARK_PENDING",
    similarityPassThreshold: 0.5,
    semanticScoreWeight: 4,
    semanticLaneMaxShare: 0.1,
  },
} as const satisfies Record<string, EpisodicSemanticModelConfig>;

export type EpisodicSemanticModelKey = keyof typeof EPISODIC_SEMANTIC_MODEL_CANDIDATES;

/**
 * Live-benchmark control arm only. Deliberately outside
 * EPISODIC_SEMANTIC_MODEL_CANDIDATES, so the runtime gate can never select it.
 */
export const EPISODIC_SEMANTIC_BENCHMARK_CONTROL_MODELS = {
  openai_text_embedding_3_small: {
    ...EPISODIC_SEMANTIC_MODEL_CANDIDATES.bge_m3,
    modelId: "openai/text-embedding-3-small",
    dimensions: 1536,
    responseModelAliases: ["text-embedding-3-small"],
    configVersion: "text-embedding-3-small@1536/benchmark-control",
  },
} as const satisfies Record<string, EpisodicSemanticModelConfig>;

export type EpisodicSemanticRuntime =
  | { enabled: true; model: EpisodicSemanticModelConfig }
  | {
      enabled: false;
      reason:
        | "flag_off"
        | "unknown_model"
        | "config_provisional_live_benchmark_pending";
    };

function isTruthyFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * Single activation gate. Requires the flag, a known model key, AND an APPROVED
 * config — a provisional config cannot activate even with the flag on.
 */
export function resolveEpisodicSemanticRuntime(env: NodeJS.ProcessEnv = process.env): EpisodicSemanticRuntime {
  if (!isTruthyFlag(env.EPISODIC_SEMANTIC_DISCOVERY_ENABLED)) {
    return { enabled: false, reason: "flag_off" };
  }
  const key = env.EPISODIC_SEMANTIC_MODEL?.trim() as EpisodicSemanticModelKey | undefined;
  const model: EpisodicSemanticModelConfig | undefined =
    key && Object.hasOwn(EPISODIC_SEMANTIC_MODEL_CANDIDATES, key)
      ? EPISODIC_SEMANTIC_MODEL_CANDIDATES[key]
      : undefined;
  if (!model) return { enabled: false, reason: "unknown_model" };
  switch (model.status) {
    case "APPROVED":
      return { enabled: true, model };
    case "PROVISIONAL_LIVE_BENCHMARK_PENDING":
      return { enabled: false, reason: "config_provisional_live_benchmark_pending" };
    default: {
      const _exhaustive: never = model.status;
      return _exhaustive;
    }
  }
}
