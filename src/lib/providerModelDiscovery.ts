import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { CheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import { isCheaperInferenceModel } from "@/lib/chatModels";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";
import { listPublishedModelIds } from "@/lib/publishedModelPricing";

export const PROVIDER_MODEL_DISCOVERY_PROVIDER = "cheaperinference" as const;

export type ProviderModelDiscovery = {
  id: number;
  provider: string;
  modelId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstSeenRunDateKey: string;
  lastSeenRunDateKey: string;
  observationCount: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  referenceInputUsdPerMillion: number | null;
  referenceOutputUsdPerMillion: number | null;
  discountPercent: number | null;
  catalogFingerprint: string;
  productRegisteredNow: boolean;
};

type DiscoveryRow = {
  id: number;
  provider: string;
  model_id: string;
  first_seen_at: string;
  last_seen_at: string;
  first_seen_run_date_key: string;
  last_seen_run_date_key: string;
  observation_count: number;
  input_usd_per_million: number;
  output_usd_per_million: number;
  cache_read_usd_per_million: number | null;
  cache_write_usd_per_million: number | null;
  reference_input_usd_per_million: number | null;
  reference_output_usd_per_million: number | null;
  discount_percent: number | null;
  latest_catalog_fingerprint: string;
};

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function publishedModelSet(): Set<string> {
  return new Set(listPublishedModelIds().map(normalizeModelId));
}

/**
 * Product-known is broader than Main RP: background/auxiliary CI models and
 * historical published models must not be rediscovered as "new supply".
 */
export function isProductKnownProviderModel(modelId: string): boolean {
  const normalized = normalizeModelId(modelId);
  return publishedModelSet().has(normalized) || isCheaperInferenceModel(normalized);
}

export function providerCatalogFingerprint(row: CheaperInferenceCatalogPricing): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        modelId: normalizeModelId(row.modelId),
        input: row.inputUsdPerMillion,
        output: row.outputUsdPerMillion,
        cacheRead: row.cacheReadUsdPerMillion,
        cacheWrite: row.cacheWriteUsdPerMillion,
        referenceInput: row.referenceInputUsdPerMillion ?? null,
        referenceOutput: row.referenceOutputUsdPerMillion ?? null,
        discountPercent: row.discountPercent ?? null,
        threshold: row.inputTokenPriceThreshold ?? null,
        aboveThreshold: row.aboveThreshold ?? null,
      })
    )
    .digest("hex");
}

export type ObserveProviderModelCatalogResult = {
  observedUnknown: number;
  newlyDiscoveredModelIds: string[];
};

export function observeProviderModelCatalog(params: {
  db: Database.Database;
  attemptId: number;
  runDateKey: string;
  catalog: readonly CheaperInferenceCatalogPricing[];
}): ObserveProviderModelCatalogResult {
  ensureModelPricingTrackingSchema(params.db);
  const newlyDiscoveredModelIds: string[] = [];
  let observedUnknown = 0;

  const insert = params.db.prepare(
    `INSERT OR IGNORE INTO provider_model_discoveries (
       provider, model_id, first_seen_attempt_id, last_seen_attempt_id,
       first_seen_at, last_seen_at, first_seen_run_date_key, last_seen_run_date_key,
       observation_count, input_usd_per_million, output_usd_per_million,
       cache_read_usd_per_million, cache_write_usd_per_million,
       reference_input_usd_per_million, reference_output_usd_per_million,
       discount_percent, latest_catalog_fingerprint
     ) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)`
  );
  const update = params.db.prepare(
    `UPDATE provider_model_discoveries
        SET last_seen_attempt_id = ?,
            last_seen_at = ?,
            last_seen_run_date_key = ?,
            observation_count = CASE
              WHEN last_seen_attempt_id <> ? THEN observation_count + 1
              ELSE observation_count
            END,
            input_usd_per_million = ?,
            output_usd_per_million = ?,
            cache_read_usd_per_million = ?,
            cache_write_usd_per_million = ?,
            reference_input_usd_per_million = ?,
            reference_output_usd_per_million = ?,
            discount_percent = ?,
            latest_catalog_fingerprint = ?,
            updated_at = datetime('now')
      WHERE provider = ? AND model_id = ?`
  );

  for (const row of params.catalog) {
    const modelId = normalizeModelId(row.modelId);
    if (!modelId || isProductKnownProviderModel(modelId)) continue;
    observedUnknown += 1;
    const observedAt = new Date(row.fetchedAt).toISOString();
    const fingerprint = providerCatalogFingerprint(row);
    const inserted = insert.run(
      PROVIDER_MODEL_DISCOVERY_PROVIDER,
      modelId,
      params.attemptId,
      params.attemptId,
      observedAt,
      observedAt,
      params.runDateKey,
      params.runDateKey,
      row.inputUsdPerMillion,
      row.outputUsdPerMillion,
      row.cacheReadUsdPerMillion ?? null,
      row.cacheWriteUsdPerMillion ?? null,
      row.referenceInputUsdPerMillion ?? null,
      row.referenceOutputUsdPerMillion ?? null,
      row.discountPercent ?? null,
      fingerprint
    );
    if (Number(inserted.changes) > 0) {
      newlyDiscoveredModelIds.push(modelId);
      continue;
    }
    update.run(
      params.attemptId,
      observedAt,
      params.runDateKey,
      params.attemptId,
      row.inputUsdPerMillion,
      row.outputUsdPerMillion,
      row.cacheReadUsdPerMillion ?? null,
      row.cacheWriteUsdPerMillion ?? null,
      row.referenceInputUsdPerMillion ?? null,
      row.referenceOutputUsdPerMillion ?? null,
      row.discountPercent ?? null,
      fingerprint,
      PROVIDER_MODEL_DISCOVERY_PROVIDER,
      modelId
    );
  }

  return { observedUnknown, newlyDiscoveredModelIds };
}

function parseDiscovery(row: DiscoveryRow): ProviderModelDiscovery {
  return {
    id: row.id,
    provider: row.provider,
    modelId: row.model_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    firstSeenRunDateKey: row.first_seen_run_date_key,
    lastSeenRunDateKey: row.last_seen_run_date_key,
    observationCount: row.observation_count,
    inputUsdPerMillion: row.input_usd_per_million,
    outputUsdPerMillion: row.output_usd_per_million,
    cacheReadUsdPerMillion: row.cache_read_usd_per_million,
    cacheWriteUsdPerMillion: row.cache_write_usd_per_million,
    referenceInputUsdPerMillion: row.reference_input_usd_per_million,
    referenceOutputUsdPerMillion: row.reference_output_usd_per_million,
    discountPercent: row.discount_percent,
    catalogFingerprint: row.latest_catalog_fingerprint,
    productRegisteredNow: isProductKnownProviderModel(row.model_id),
  };
}

export function listProviderModelDiscoveries(
  db: Database.Database,
  opts: { limit?: number; unregisteredOnly?: boolean } = {}
): ProviderModelDiscovery[] {
  ensureModelPricingTrackingSchema(db);
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 50)));
  const rows = db
    .prepare(
      `SELECT id, provider, model_id, first_seen_at, last_seen_at,
              first_seen_run_date_key, last_seen_run_date_key, observation_count,
              input_usd_per_million, output_usd_per_million,
              cache_read_usd_per_million, cache_write_usd_per_million,
              reference_input_usd_per_million, reference_output_usd_per_million,
              discount_percent, latest_catalog_fingerprint
         FROM provider_model_discoveries
        ORDER BY last_seen_at DESC, id DESC
        LIMIT ?`
    )
    .all(limit) as DiscoveryRow[];
  const parsed = rows.map(parseDiscovery);
  return opts.unregisteredOnly === false
    ? parsed
    : parsed.filter((row) => !row.productRegisteredNow);
}
