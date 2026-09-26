/**
 * Async orchestration for episodic semantic discovery — the only place that
 * turns text into vectors. Both entry points are gated by the canonical
 * runtime and never throw: any failure yields "no semantic evidence", which
 * the retrieval owner treats as exact lexical Retrieval V2.
 *
 * Callers:
 * - `resolveEpisodicSemanticQuery`: chat route, before episodic retrieval.
 * - `runEpisodicSemanticIndexJob`: `scheduleMemoryUpdate` post-turn owner,
 *   after the canonical episodic write transaction has committed.
 */
import type Database from "better-sqlite3";
import type { Route } from "@/lib/ai";
import { listEpisodicFactsForSemanticIndexing } from "@/lib/episodicMemoryFacts";
import { callOpenRouterEmbeddings } from "@/lib/openRouterEmbeddings";
import {
  EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND,
  EPISODIC_SEMANTIC_INDEXABLE_CONTENT_ROUTE,
  EPISODIC_SEMANTIC_INDEX_BATCH_SIZE,
  EPISODIC_SEMANTIC_INDEX_TIMEOUT_MS,
  EPISODIC_SEMANTIC_MAX_QUERY_CHARS,
  EPISODIC_SEMANTIC_QUERY_TIMEOUT_MS,
  resolveEpisodicSemanticRuntime,
  type EpisodicSemanticModelConfig,
  type EpisodicSemanticRuntime,
} from "./memory-episodic-semantic-config";
import {
  normalizeEmbeddingVector,
  pruneOrphanEpisodicFactEmbeddings,
  upsertEpisodicFactEmbedding,
  type EpisodicSemanticQuery,
} from "./memory-episodic-semantic-index";

export type EpisodicEmbeddingPurpose = "query" | "index";

/** Embeds `inputs` in order; must throw (never return partial) on any failure. */
export type EpisodicEmbedder = (
  inputs: string[],
  model: EpisodicSemanticModelConfig,
  purpose: EpisodicEmbeddingPurpose
) => Promise<number[][]>;

export const openRouterEpisodicEmbedder: EpisodicEmbedder = async (inputs, model, purpose) => {
  const { vectors } = await callOpenRouterEmbeddings({
    model: model.modelId,
    inputs,
    dimensions: model.dimensions,
    requestDimensions: model.requestDimensions,
    responseModelAliases: model.responseModelAliases,
    requestKind: EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND,
    timeoutMs: purpose === "query" ? EPISODIC_SEMANTIC_QUERY_TIMEOUT_MS : EPISODIC_SEMANTIC_INDEX_TIMEOUT_MS,
  });
  return vectors;
};

type SemanticJobOptions = {
  env?: NodeJS.ProcessEnv;
  /** Test seam: an explicit runtime (e.g. synthetic model) instead of env resolution. */
  runtime?: EpisodicSemanticRuntime;
  embed?: EpisodicEmbedder;
};

export type EpisodicSemanticQueryResolution = {
  query: EpisodicSemanticQuery | null;
  reason:
    | "ok"
    | "disabled"
    | "adult_scope_excluded"
    | "empty_query"
    | "no_usable_index"
    | "provider_error"
    | "invalid_vector";
};

/**
 * Resolves the query vector for one turn. The canonical content route gates
 * the provider call itself: an adult (non-indexable-route) turn sends nothing.
 * `usableIndex` lets the caller skip the call (0 HTTP, 0 RTT) when no in-scope
 * vector exists for the active model.
 */
export async function resolveEpisodicSemanticQuery(
  opts: SemanticJobOptions & {
    query: string | null | undefined;
    contentRoute: Route;
    usableIndex?: (model: EpisodicSemanticModelConfig) => boolean;
  }
): Promise<EpisodicSemanticQueryResolution> {
  const runtime = opts.runtime ?? resolveEpisodicSemanticRuntime(opts.env);
  if (!runtime.enabled) return { query: null, reason: "disabled" };
  if (opts.contentRoute !== EPISODIC_SEMANTIC_INDEXABLE_CONTENT_ROUTE) {
    return { query: null, reason: "adult_scope_excluded" };
  }
  const text = (opts.query ?? "").trim().slice(0, EPISODIC_SEMANTIC_MAX_QUERY_CHARS);
  if (!text) return { query: null, reason: "empty_query" };
  try {
    if (opts.usableIndex && !opts.usableIndex(runtime.model)) {
      return { query: null, reason: "no_usable_index" };
    }
  } catch (e) {
    console.warn("[EpisodicSemantic] index readiness probe failed; lexical V2 only:", (e as Error).message);
    return { query: null, reason: "no_usable_index" };
  }
  const embed = opts.embed ?? openRouterEpisodicEmbedder;
  let vectors: number[][];
  try {
    vectors = await embed([text], runtime.model, "query");
  } catch (e) {
    console.warn("[EpisodicSemantic] query embedding failed; lexical V2 only:", (e as Error).message);
    return { query: null, reason: "provider_error" };
  }
  const vector = vectors.length === 1 ? normalizeEmbeddingVector(vectors[0]!, runtime.model.dimensions) : null;
  if (!vector) return { query: null, reason: "invalid_vector" };
  return { query: { model: runtime.model, vector }, reason: "ok" };
}

export type EpisodicSemanticIndexJobResult = {
  status: "disabled" | "idle" | "indexed" | "provider_error" | "invalid_batch" | "db_error";
  requested: number;
  written: number;
  droppedStale: number;
  prunedOrphans: number;
};

/**
 * Bounded, idempotent lazy backfill for one chat: prunes orphan vectors, then
 * embeds at most one batch of canonically selected facts (scope, guard, safe
 * content route) lacking a current full-text-hash vector for the active model. Each write re-checks the canonical row, so a result that raced a
 * canonical mutation is dropped instead of stored.
 */
export async function runEpisodicSemanticIndexJob(
  opts: SemanticJobOptions & { db: Database.Database; chatId: number; batchSize?: number }
): Promise<EpisodicSemanticIndexJobResult> {
  const result: EpisodicSemanticIndexJobResult = {
    status: "disabled",
    requested: 0,
    written: 0,
    droppedStale: 0,
    prunedOrphans: 0,
  };
  const runtime = opts.runtime ?? resolveEpisodicSemanticRuntime(opts.env);
  if (!runtime.enabled) return result;
  const { model } = runtime;
  const embed = opts.embed ?? openRouterEpisodicEmbedder;

  let pending: ReturnType<typeof listEpisodicFactsForSemanticIndexing>;
  try {
    result.prunedOrphans = pruneOrphanEpisodicFactEmbeddings(opts.db, opts.chatId);
    pending = listEpisodicFactsForSemanticIndexing(opts.db, {
      chatId: opts.chatId,
      model,
      limit: opts.batchSize ?? EPISODIC_SEMANTIC_INDEX_BATCH_SIZE,
    });
  } catch (e) {
    console.warn("[EpisodicSemantic] index selection failed:", (e as Error).message);
    return { ...result, status: "db_error" };
  }
  if (pending.length === 0) return { ...result, status: "idle" };
  result.requested = pending.length;

  let vectors: number[][];
  try {
    vectors = await embed(pending.map((p) => p.embeddingInput), model, "index");
  } catch (e) {
    console.warn("[EpisodicSemantic] index embedding failed:", (e as Error).message);
    return { ...result, status: "provider_error" };
  }
  const normalized = vectors.length === pending.length
    ? vectors.map((v) => normalizeEmbeddingVector(v, model.dimensions))
    : null;
  if (!normalized || normalized.some((v) => v === null)) {
    return { ...result, status: "invalid_batch" };
  }

  try {
    pending.forEach((item, i) => {
      const outcome = upsertEpisodicFactEmbedding(opts.db, {
        chatId: opts.chatId,
        factId: item.factId,
        model,
        contentHash: item.contentHash,
        vector: normalized[i]!,
      });
      if (outcome === "written") result.written += 1;
      else result.droppedStale += 1;
    });
  } catch (e) {
    console.warn("[EpisodicSemantic] index write failed:", (e as Error).message);
    return { ...result, status: "db_error" };
  }
  return { ...result, status: "indexed" };
}
