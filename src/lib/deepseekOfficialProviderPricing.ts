/**
 * DeepSeek official provider pricing observer — FETCH + PARSE + NORMALIZE EVIDENCE only.
 * Does not mutate published pricing, promotions, or billing policy.
 *
 * Source authority: https://api-docs.deepseek.com/quick_start/pricing/
 * (official structured docs table — no machine-readable JSON endpoint exists).
 */

import { createHash } from "node:crypto";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  DEEPSEEK_V41_FLASH_OFFICIAL_API_NAME,
} from "@/lib/chatModels";
import { DEEPSEEK_OFFICIAL_PRICING_SOURCE_URL } from "@/lib/modelPricingTrackingConfig";
import type { PriceSnapshotPricingMode } from "@/lib/modelPricingTrackingConfig";

export type DeepSeekOfficialPricingSchedule = "peak" | "off_peak";

export type DeepSeekOfficialModelRateSet = {
  cacheHitInputUsdPerMillion: number | null;
  cacheMissInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

export type DeepSeekOfficialParsedModel = {
  providerModelIdentity: string;
  providerVersionLabel: string;
  peak: DeepSeekOfficialModelRateSet;
  offPeak: DeepSeekOfficialModelRateSet;
};

export type DeepSeekOfficialPricingParseResult =
  | {
      ok: true;
      models: DeepSeekOfficialParsedModel[];
      rawFingerprint: string;
    }
  | {
      ok: false;
      reason: string;
    };

export type OfficialProviderPricingEvidence = {
  provider: "deepseek";
  canonicalModelId: string;
  providerModelIdentity: string;
  providerVersionLabel: string;
  pricingMode: Extract<PriceSnapshotPricingMode, "provider_peak" | "provider_standard">;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  observedAt: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceUrl: string;
  rawFingerprint: string;
};

export const DEEPSEEK_OFFICIAL_V4_PRO_API_NAME = "deepseek-v4-pro";

/** Single owner: DeepSeek official adapter supported canonical model identities. */
export const DEEPSEEK_OFFICIAL_CANONICAL_IDENTITY: Record<
  string,
  { canonicalModelId: string; expectedVersionLabel: string }
> = {
  [DEEPSEEK_OFFICIAL_V4_PRO_API_NAME]: {
    canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    expectedVersionLabel: "DeepSeek-V4-Pro-0813",
  },
  [DEEPSEEK_V41_FLASH_OFFICIAL_API_NAME]: {
    canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    expectedVersionLabel: "DeepSeek-V4.1-Flash",
  },
};

/** Canonical model ids this DeepSeek official observer owns — not global PROVIDER_PEAK policy. */
export function listDeepSeekOfficialCanonicalModelIds(): string[] {
  const ids = new Set<string>();
  for (const mapping of Object.values(DEEPSEEK_OFFICIAL_CANONICAL_IDENTITY)) {
    ids.add(mapping.canonicalModelId);
  }
  return [...ids].sort();
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUsd(value: string): number | null {
  const match = value.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value != null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted;
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function fingerprintDeepSeekOfficialDocument(payload: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function fingerprintOfficialProviderPeakState(params: {
  canonicalModelId: string;
  providerModelIdentity: string;
  providerVersionLabel: string;
  peak: DeepSeekOfficialModelRateSet;
}): string {
  return fingerprintDeepSeekOfficialDocument({
    kind: "official_provider_peak",
    modelId: params.canonicalModelId,
    providerModelIdentity: params.providerModelIdentity,
    providerVersionLabel: params.providerVersionLabel,
    peak: {
      cacheHitInputUsdPerMillion: params.peak.cacheHitInputUsdPerMillion,
      cacheMissInputUsdPerMillion: params.peak.cacheMissInputUsdPerMillion,
      outputUsdPerMillion: params.peak.outputUsdPerMillion,
    },
  });
}

function normalizeSchedule(value: string): DeepSeekOfficialPricingSchedule | null {
  const upper = value.trim().toUpperCase();
  if (upper === "PEAK") return "peak";
  if (upper === "OFF-PEAK" || upper === "OFF PEAK") return "off_peak";
  return null;
}

function normalizeCategory(value: string): "cache_hit" | "cache_miss" | "output" | null {
  const text = value.toUpperCase();
  if (text.includes("CACHE HIT")) return "cache_hit";
  if (text.includes("CACHE MISS")) return "cache_miss";
  if (text.includes("OUTPUT")) return "output";
  return null;
}

function normalizeOfficialModelId(value: string): string {
  return value.replace(/\(\d+\)/g, "").trim().toLowerCase();
}

function extractTables(html: string): string[] {
  return [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => match[0]!);
}

function extractRowCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
    stripHtml(cell[1]!)
  );
}

function extractTableRows(tableHtml: string): string[][] {
  const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const scope = tbodyMatch?.[1] ?? tableHtml;
  return [...scope.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => extractRowCells(row[1]!));
}

function scorePricingTable(rows: string[][]): number {
  const flat = rows.flat().join(" ").toUpperCase();
  let score = 0;
  if (flat.includes("MODEL")) score += 1;
  if (flat.includes("MODEL VERSION")) score += 2;
  if (flat.includes("PRICING")) score += 2;
  if (flat.includes("DEEPSEEK-V4-PRO") || flat.includes("DEEPSEEK-FLASH")) score += 2;
  if (flat.includes("PEAK") && flat.includes("OFF-PEAK")) score += 2;
  return score;
}

function selectPricingTableRows(html: string): string[][] | null {
  let bestRows: string[][] | null = null;
  let bestScore = 0;
  for (const tableHtml of extractTables(html)) {
    const rows = extractTableRows(tableHtml);
    const score = scorePricingTable(rows);
    if (score > bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }
  if (!bestRows || bestScore < 6) return null;
  return bestRows;
}

function parsePricingTableRows(parsedRows: string[][]): DeepSeekOfficialPricingParseResult {
  if (parsedRows.length === 0) {
    return { ok: false, reason: "official_pricing_table_empty" };
  }

  const modelRow = parsedRows.find((cells) => cells.some((cell) => cell.toUpperCase() === "MODEL"));
  if (!modelRow) {
    return { ok: false, reason: "official_model_row_missing" };
  }

  const modelStartIndex = modelRow.findIndex((cell) => cell.toUpperCase() === "MODEL");
  const providerModelIds = modelRow.slice(modelStartIndex + 1).map(normalizeOfficialModelId).filter(Boolean);
  if (providerModelIds.length === 0) {
    return { ok: false, reason: "official_model_columns_missing" };
  }

  const versionRow = parsedRows.find((cells) => cells.some((cell) => cell.toUpperCase() === "MODEL VERSION"));
  const versionLabels =
    versionRow && versionRow.length >= modelStartIndex + 1 + providerModelIds.length
      ? versionRow.slice(modelStartIndex + 1, modelStartIndex + 1 + providerModelIds.length)
      : providerModelIds.map(() => "");

  const models = new Map<string, DeepSeekOfficialParsedModel>();
  for (let index = 0; index < providerModelIds.length; index += 1) {
    const providerModelIdentity = providerModelIds[index]!;
    models.set(providerModelIdentity, {
      providerModelIdentity,
      providerVersionLabel: versionLabels[index] ?? "",
      peak: {
        cacheHitInputUsdPerMillion: null,
        cacheMissInputUsdPerMillion: NaN,
        outputUsdPerMillion: NaN,
      },
      offPeak: {
        cacheHitInputUsdPerMillion: null,
        cacheMissInputUsdPerMillion: NaN,
        outputUsdPerMillion: NaN,
      },
    });
  }

  let currentCategory: "cache_hit" | "cache_miss" | "output" | null = null;
  for (const cells of parsedRows) {
    const joined = cells.join(" ").toUpperCase();
    if (joined.includes("PRICING")) {
      const category = normalizeCategory(cells.find((cell) => normalizeCategory(cell) != null) ?? joined);
      if (category) currentCategory = category;
    }
    const explicitCategory = cells.map(normalizeCategory).find((value) => value != null);
    if (explicitCategory) currentCategory = explicitCategory;

    const scheduleIndex = cells.findIndex((cell) => normalizeSchedule(cell) != null);
    if (scheduleIndex < 0 || currentCategory == null) continue;

    const schedule = normalizeSchedule(cells[scheduleIndex]!);
    if (!schedule) continue;

    const rateCells = cells.slice(scheduleIndex + 1);
    if (rateCells.length < providerModelIds.length) continue;

    for (let index = 0; index < providerModelIds.length; index += 1) {
      const model = models.get(providerModelIds[index]!);
      const rate = parseUsd(rateCells[index] ?? "");
      if (!model || rate == null) continue;
      const bucket = schedule === "peak" ? model.peak : model.offPeak;
      if (currentCategory === "cache_hit") {
        bucket.cacheHitInputUsdPerMillion = rate;
      } else if (currentCategory === "cache_miss") {
        bucket.cacheMissInputUsdPerMillion = rate;
      } else {
        bucket.outputUsdPerMillion = rate;
      }
    }
  }

  const completeModels: DeepSeekOfficialParsedModel[] = [];
  for (const model of models.values()) {
    const peakComplete =
      Number.isFinite(model.peak.cacheMissInputUsdPerMillion) &&
      Number.isFinite(model.peak.outputUsdPerMillion);
    const offPeakComplete =
      Number.isFinite(model.offPeak.cacheMissInputUsdPerMillion) &&
      Number.isFinite(model.offPeak.outputUsdPerMillion);
    if (!peakComplete || !offPeakComplete) {
      return { ok: false, reason: "official_pricing_rows_incomplete" };
    }
    completeModels.push(model);
  }

  if (completeModels.length === 0) {
    return { ok: false, reason: "official_pricing_models_empty" };
  }

  const rawFingerprint = fingerprintDeepSeekOfficialDocument({
    source: "deepseek_official_pricing_docs",
    models: completeModels.map((model) => ({
      id: model.providerModelIdentity,
      version: model.providerVersionLabel,
      peak: model.peak,
      offPeak: model.offPeak,
    })),
  });

  return { ok: true, models: completeModels, rawFingerprint };
}

/**
 * Parse the official DeepSeek pricing docs table.
 * PEAK and OFF-PEAK rows are distinguished by explicit schedule labels — never inferred.
 */
export function parseDeepSeekOfficialPricingHtml(html: string): DeepSeekOfficialPricingParseResult {
  const parsedRows = selectPricingTableRows(html);
  if (!parsedRows) {
    return { ok: false, reason: "official_pricing_table_missing" };
  }
  return parsePricingTableRows(parsedRows);
}

export function mapDeepSeekOfficialModelToCanonical(
  model: DeepSeekOfficialParsedModel
): { canonicalModelId: string } | { reason: string } {
  const mapping = DEEPSEEK_OFFICIAL_CANONICAL_IDENTITY[model.providerModelIdentity];
  if (!mapping) {
    return { reason: "official_model_identity_unmapped" };
  }
  if (model.providerVersionLabel !== mapping.expectedVersionLabel) {
    return {
      reason: `official_version_label_mismatch:${model.providerModelIdentity}:${model.providerVersionLabel}`,
    };
  }
  return { canonicalModelId: mapping.canonicalModelId };
}

export function buildOfficialProviderPeakEvidence(params: {
  model: DeepSeekOfficialParsedModel;
  canonicalModelId: string;
  observedAt: string;
  sourceUrl?: string;
}): OfficialProviderPricingEvidence | null {
  const peak = params.model.peak;
  if (
    !Number.isFinite(peak.cacheMissInputUsdPerMillion) ||
    !Number.isFinite(peak.outputUsdPerMillion)
  ) {
    return null;
  }

  return {
    provider: "deepseek",
    canonicalModelId: params.canonicalModelId,
    providerModelIdentity: params.model.providerModelIdentity,
    providerVersionLabel: params.model.providerVersionLabel,
    pricingMode: "provider_peak",
    inputUsdPerMillion: peak.cacheMissInputUsdPerMillion,
    outputUsdPerMillion: peak.outputUsdPerMillion,
    cacheReadUsdPerMillion: peak.cacheHitInputUsdPerMillion,
    cacheWriteUsdPerMillion: null,
    observedAt: params.observedAt,
    validFrom: null,
    validUntil: null,
    sourceUrl: params.sourceUrl ?? DEEPSEEK_OFFICIAL_PRICING_SOURCE_URL,
    rawFingerprint: fingerprintOfficialProviderPeakState({
      canonicalModelId: params.canonicalModelId,
      providerModelIdentity: params.model.providerModelIdentity,
      providerVersionLabel: params.model.providerVersionLabel,
      peak,
    }),
  };
}

export type DeepSeekOfficialPricingRefreshResult =
  | {
      ok: true;
      observedAt: string;
      documentFingerprint: string;
      peakEvidenceByCanonicalModelId: Map<string, OfficialProviderPricingEvidence>;
      identityFailures: Array<{ providerModelIdentity: string; reason: string }>;
    }
  | {
      ok: false;
      reason: string;
    };

let lastObservedEvidence: Map<string, OfficialProviderPricingEvidence> | null = null;
let lastObservedAt = 0;
let inFlight: Promise<DeepSeekOfficialPricingRefreshResult> | null = null;

const OFFICIAL_PRICING_TTL_MS = 60 * 60 * 1000;

export function getCachedDeepSeekOfficialPeakEvidence(
  canonicalModelId: string
): OfficialProviderPricingEvidence | null {
  return lastObservedEvidence?.get(canonicalModelId) ?? null;
}

/** TEST-ONLY: inject parsed evidence without network. */
export function setDeepSeekOfficialPeakEvidenceForTest(
  evidence: OfficialProviderPricingEvidence[],
  observedAt: number = Date.now()
): void {
  lastObservedEvidence = new Map(evidence.map((row) => [row.canonicalModelId, row]));
  lastObservedAt = observedAt;
}

/** TEST-ONLY: reset TTL gate and cached evidence. */
export function resetDeepSeekOfficialProviderPricingForTest(): void {
  lastObservedEvidence = null;
  lastObservedAt = 0;
  inFlight = null;
}

export function normalizeDeepSeekOfficialPricingDocument(params: {
  html: string;
  observedAt: string;
  sourceUrl?: string;
}): DeepSeekOfficialPricingRefreshResult {
  const parsed = parseDeepSeekOfficialPricingHtml(params.html);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }

  const peakEvidenceByCanonicalModelId = new Map<string, OfficialProviderPricingEvidence>();
  const identityFailures: Array<{ providerModelIdentity: string; reason: string }> = [];

  for (const model of parsed.models) {
    const mapped = mapDeepSeekOfficialModelToCanonical(model);
    if ("reason" in mapped) {
      identityFailures.push({
        providerModelIdentity: model.providerModelIdentity,
        reason: mapped.reason,
      });
      continue;
    }
    const evidence = buildOfficialProviderPeakEvidence({
      model,
      canonicalModelId: mapped.canonicalModelId,
      observedAt: params.observedAt,
      sourceUrl: params.sourceUrl,
    });
    if (!evidence) continue;
    peakEvidenceByCanonicalModelId.set(mapped.canonicalModelId, evidence);
  }

  return {
    ok: true,
    observedAt: params.observedAt,
    documentFingerprint: parsed.rawFingerprint,
    peakEvidenceByCanonicalModelId,
    identityFailures,
  };
}

async function fetchOfficialPricingHtml(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(DEEPSEEK_OFFICIAL_PRICING_SOURCE_URL, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
    headers: { Accept: "text/html" },
  });
  if (!response.ok) {
    throw new Error(`DeepSeek official pricing ${response.status}`);
  }
  return response.text();
}

async function refreshOfficialPricing(opts?: {
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<DeepSeekOfficialPricingRefreshResult> {
  const observedAt = new Date().toISOString();
  const html = await fetchOfficialPricingHtml(opts?.fetchImpl ?? fetch);
  const normalized = normalizeDeepSeekOfficialPricingDocument({
    html,
    observedAt,
    sourceUrl: DEEPSEEK_OFFICIAL_PRICING_SOURCE_URL,
  });
  if (normalized.ok) {
    lastObservedEvidence = normalized.peakEvidenceByCanonicalModelId;
    lastObservedAt = Date.now();
  }
  return normalized;
}

/**
 * Refresh official DeepSeek provider pricing evidence.
 * Failures return `{ ok: false }`; the tracker marks the attempt FAILED so the
 * existing same-day reclaim owner can retry after transient outages.
 */
export async function refreshDeepSeekOfficialProviderPricing(opts?: {
  force?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<DeepSeekOfficialPricingRefreshResult> {
  if (!opts?.force && Date.now() - lastObservedAt < OFFICIAL_PRICING_TTL_MS && lastObservedEvidence) {
    return {
      ok: true,
      observedAt: new Date(lastObservedAt).toISOString(),
      documentFingerprint: "cached",
      peakEvidenceByCanonicalModelId: lastObservedEvidence,
      identityFailures: [],
    };
  }
  if (inFlight) return inFlight;

  inFlight = refreshOfficialPricing(opts)
    .catch((error) => ({
      ok: false as const,
      reason: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
