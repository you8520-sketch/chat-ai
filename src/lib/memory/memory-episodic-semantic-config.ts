/**
 * Canonical configuration owner for episodic semantic candidate discovery.
 *
 * Every model id, dimension, similarity threshold, scorer weight, lane weight,
 * and input bound used by the semantic index, the embeddings transport caller,
 * the semantic candidate lane, and the final scorer is defined here once.
 *
 * STATUS: every candidate below is PROVISIONAL. Thresholds and weights were not
 * calibrated against a live embedding model; they only make the deterministic
 * synthetic fixtures meaningful. `resolveEpisodicSemanticRuntime` therefore
 * refuses to activate any provisional config, so production retrieval stays on
 * the exact lexical Retrieval V2 path until a live benchmark approves a config.
 */
export type EpisodicSemanticConfigStatus = "PROVISIONAL_LIVE_BENCHMARK_PENDING" | "APPROVED";

export type EpisodicSemanticModelConfig = {
  /** OpenRouter embeddings model slug. */
  modelId: string;
  /** Expected vector length returned by the provider (fail-closed on mismatch). */
  dimensions: number;
  /** Sent as the official `dimensions` request field only when set. */
  requestDimensions?: number;
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
    configVersion: "bge-m3@1024/provisional-1",
    status: "PROVISIONAL_LIVE_BENCHMARK_PENDING",
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
