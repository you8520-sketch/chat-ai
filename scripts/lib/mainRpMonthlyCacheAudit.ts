/**
 * Canonical Main RP monthly prompt-cache audit owner (read-only).
 *
 * Derives CheaperInference audit targets from MAIN_RP_USER_SELECTABLE_OPTIONS —
 * never a hand-written model list. OpenRouter-routed models are intentionally
 * excluded from this CI usage/catalog audit instead of being misclassified.
 * provider generation calls = 0. Does not mutate production prompt/routing/billing.
 */
import { createHash } from "node:crypto";

import {
  isAnthropicModel,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  type SelectedAI,
} from "@/lib/chatModels";
import { CHEAPER_INFERENCE_BASE_URL } from "@/lib/cheaperInferenceConfig";

export const MAIN_RP_MONTHLY_CACHE_AUDIT_VERSION = 1;

export const MAIN_RP_MONTHLY_CACHE_AUDIT_OWNERS = Object.freeze({
  activeModelRegistry: "src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS",
  monthlyCacheAudit: "scripts/lib/mainRpMonthlyCacheAudit.ts",
  usageReportingCredential:
    "scripts/lib/cheaperInferenceUsageReportingCredential.ts",
  promptAssembly: "src/services/contextBuilder.ts#buildContext",
  wireAssembly: "src/lib/openRouterAdult.ts#assemblePrimaryRpRequest",
  anthropicExplicitCache:
    "src/lib/openRouterAdult.ts#applyAnthropicCacheAndPrefill",
  cacheControlPrimitives: "src/lib/openRouterCache.ts",
  promptCacheAffinity:
    "src/lib/cheaperInferenceConfig.ts#buildCheaperInferenceChatCompletionsUrl",
  cacheTokenUsageParser: "src/lib/openRouterUsage.ts#parseCompatibleUsage",
  promptSectionFingerprint: "src/lib/promptSectionFingerprint.ts",
  catalogPricing: "src/lib/cheaperInferenceCatalogPricing.server.ts#parseCatalogPricing",
  providerCostLedger: "src/lib/providerCostLedger.ts",
  qualificationPacket: "scripts/lib/rpModelQualificationPacket.ts",
});

/** OpenRouter response caching is not used for interactive Main RP cache optimization. */
export const OPENROUTER_RESPONSE_CACHING_USED_FOR_MAIN_RP = false as const;

export const CI_USAGE_REQUESTS_PATH = `${CHEAPER_INFERENCE_BASE_URL}/usage/requests`;
export const CI_MODELS_CATALOG_PATH = `${CHEAPER_INFERENCE_BASE_URL}/models`;

export const DEFAULT_SUFFICIENT_SAMPLE_THRESHOLD = 20;
export const DEFAULT_MULTI_ATTEMPT_RATIO_ALERT = 0.25;
export const DEFAULT_HEALTHY_CACHE_READ_RATIO = 0.05;
export const DEFAULT_MAX_USAGE_PAGES = 200;

export type MonthlyCacheHealthClass =
  | "CACHE_CAPABILITY_MISSING"
  | "CACHE_CONFIG_MISSING"
  | "PREFIX_INSTABILITY"
  | "ROUTING_INSTABILITY"
  | "REPORTING_GAP"
  | "AUDITOR_DRIFT"
  | "HEALTHY"
  | "NOT_MEASURED";

export type CacheMechanismKind =
  | "anthropic_explicit_cache_control"
  | "provider_implicit_kv_cache";

export type CacheMechanismEvidence = {
  kind: CacheMechanismKind;
  appExplicitCacheControl: boolean;
  openRouterResponseCachingUsed: false;
  note: string;
};

export type RatioOrNotMeasured = number | "NOT_MEASURED";

export type CalendarMonthWindow = {
  /** Inclusive start as provider timestamp 'YYYY-MM-DD HH:MM:SS' UTC. */
  startAt: string;
  /** Exclusive end as provider timestamp 'YYYY-MM-DD HH:MM:SS' UTC. */
  endAt: string;
  /** Audit month label YYYY-MM (previous completed calendar month by default). */
  yearMonth: string;
};

export type UsageRequestRow = {
  request_id: string | null;
  created_at: string | null;
  model: string | null;
  endpoint: string | null;
  status: string | null;
  prompt_tokens: number;
  completion_tokens: number | null;
  cache_read_input_tokens: number;
  cache_write_input_tokens: number;
  standard_input_tokens: number;
  billed_cost_usd: string | number | null;
  provider_attempt_count: number | null;
  cache_reporting_state: string | null;
  /** Provider routing overhead — not TTFT. */
  routing_overhead_ms: number | null;
  /** Time until response headers — not TTFT; preserve source field name. */
  time_to_response_headers_ms: number | null;
};

export type CatalogPricingEvidence = {
  id: string | null;
  input_per_million: string | number | null;
  output_per_million: string | number | null;
  cache_read_input_per_million: string | number | null;
  cache_write_input_per_million: string | number | null;
  cacheCapabilityAdvertised: boolean;
  pricing_version: string | null;
  pricing_checked_at: string | null;
  pricing_updated_at: string | null;
};

export type PrefixFingerprintEvidence = {
  /** True when tracked static/semi-static section hashes changed vs prior baseline. */
  changed: boolean | null;
  priorSha256: string | null;
  currentSha256: string | null;
  source: string | null;
};

export type ModelUsageAggregate = {
  modelId: string;
  sampleCount: number;
  promptTokenTotal: number;
  cacheReadTokenTotal: number;
  cacheWriteTokenTotal: number;
  cacheHitOrReadRatio: RatioOrNotMeasured;
  priorMonthCacheHitOrReadRatio: RatioOrNotMeasured | null;
  cacheHitOrReadRatioDelta: RatioOrNotMeasured | null;
  cacheReportingStates: string[];
  dominantCacheReportingState: string | null;
  providerAttemptCountTotal: number;
  multiAttemptCount: number;
  multiAttemptRatio: RatioOrNotMeasured;
  billedCostUsdTotal: number | null;
  latency: {
    routing_overhead_ms: {
      sampleCount: number;
      median: number | null;
      p95: number | null;
      meaning: "provider_routing_overhead_before_upstream_response";
    };
    time_to_response_headers_ms: {
      sampleCount: number;
      median: number | null;
      p95: number | null;
      meaning: "elapsed_ms_until_response_headers_not_ttft";
    };
  };
  catalog: CatalogPricingEvidence | null;
  cacheMechanism: CacheMechanismEvidence;
  prefixFingerprint: PrefixFingerprintEvidence | null;
  classification: MonthlyCacheHealthClass;
  alertFingerprint: string;
  persistentIssueFingerprint: string;
  rawEvidence: {
    recentRows: UsageRequestRow[];
    cacheReadPositiveExamples: UsageRequestRow[];
    multiAttemptExamples: UsageRequestRow[];
  };
};

export type MonthlyCacheAuditReport = {
  auditVersion: number;
  audit: "main-rp-monthly-cache-audit";
  owners: typeof MAIN_RP_MONTHLY_CACHE_AUDIT_OWNERS;
  generatedAt: string;
  window: CalendarMonthWindow;
  activeModelIds: readonly string[];
  retiredModelsExcluded: readonly string[];
  providerGenerationCalls: 0;
  openRouterResponseCachingUsedForMainRp: false;
  query: {
    pagesScanned: number;
    totalRequestsScanned: number;
    paginationComplete: boolean;
    maxPages: number;
  };
  credentialSource: string | null;
  runStatus: "OK" | "NOT_RUN" | "INCOMPLETE";
  notRunReason: string | null;
  models: Record<string, ModelUsageAggregate>;
  classifications: Record<string, MonthlyCacheHealthClass>;
  alertFingerprints: string[];
};

export type UsageFetcher = typeof fetch;

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asNonNegInt(value: unknown): number {
  const n = asFiniteNumber(value);
  if (n == null || n < 0) return 0;
  return Math.floor(n);
}

function asOptionalNonNegNumber(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null || n < 0) return null;
  return n;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatProviderTimestamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    ` ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
}

/** Previous completed calendar month in UTC (default monthly audit scope). */
export function previousCalendarMonthWindow(now: Date = new Date()): CalendarMonthWindow {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth(); // 0-based current
  const start = new Date(Date.UTC(year, monthIndex - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const ym = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}`;
  return {
    startAt: formatProviderTimestamp(start),
    endAt: formatProviderTimestamp(end),
    yearMonth: ym,
  };
}

/** Explicit YYYY-MM window (UTC calendar month). */
export function calendarMonthWindowFromYearMonth(yearMonth: string): CalendarMonthWindow {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth.trim());
  if (!match) throw new Error(`Invalid yearMonth: ${yearMonth}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`);
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return {
    startAt: formatProviderTimestamp(start),
    endAt: formatProviderTimestamp(end),
    yearMonth: `${year}-${pad2(month)}`,
  };
}

/** Previous calendar month relative to an explicit audited YYYY-MM window. */
export function priorCalendarMonthWindow(window: CalendarMonthWindow): CalendarMonthWindow {
  const [yearText, monthText] = window.yearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid audit window yearMonth: ${window.yearMonth}`);
  }
  const priorStart = new Date(Date.UTC(year, month - 2, 1, 0, 0, 0));
  return calendarMonthWindowFromYearMonth(
    `${priorStart.getUTCFullYear()}-${pad2(priorStart.getUTCMonth() + 1)}`
  );
}

/**
 * Audit targets = current canonical Main RP registry only.
 * Never invent a parallel manual list; retired models are excluded automatically.
 */
export function resolveMainRpMonthlyCacheAuditModels(
  registryIds?: readonly string[]
): string[] {
  const ids =
    registryIds ??
    MAIN_RP_USER_SELECTABLE_OPTIONS
      .filter((option) => option.provider === "cheaperinference")
      .map((option) => option.id);
  return ids.map((id) => id.trim().toLowerCase()).filter(Boolean);
}

export function resolveCacheMechanism(modelId: string): CacheMechanismEvidence {
  if (isAnthropicModel(modelId)) {
    return {
      kind: "anthropic_explicit_cache_control",
      appExplicitCacheControl: true,
      openRouterResponseCachingUsed: false,
      note:
        "Claude/Anthropic Main RP uses ephemeral cache_control on the CI wire " +
        "(applyAnthropicCacheAndPrefill). Distinct from OpenRouter response replay caching " +
        "and from provider-implicit KV caching on non-Anthropic models.",
    };
  }
  return {
    kind: "provider_implicit_kv_cache",
    appExplicitCacheControl: false,
    openRouterResponseCachingUsed: false,
    note:
      "Non-Anthropic Main RP models do not receive app-injected cache_control. " +
      "Any cache_read/write tokens reflect provider-side prompt/KV caching when advertised. " +
      "OpenRouter response caching is not used for interactive Main RP optimization.",
  };
}

export function pickUsageRequestRow(row: Record<string, unknown>): UsageRequestRow {
  const prompt = asNonNegInt(row.prompt_tokens ?? row.promptTokens);
  const cacheRead = asNonNegInt(
    row.cache_read_input_tokens ?? row.cacheReadInputTokens ?? row.cache_read_tokens
  );
  const cacheWrite = asNonNegInt(
    row.cache_write_input_tokens ?? row.cacheWriteInputTokens ?? row.cache_write_tokens
  );
  return {
    request_id: asOptionalString(row.request_id ?? row.requestId ?? row.id),
    created_at: asOptionalString(row.created_at ?? row.createdAt),
    model: asOptionalString(row.model ?? row.model_id ?? row.modelId)?.toLowerCase() ?? null,
    endpoint: asOptionalString(row.endpoint ?? row.path),
    status: asOptionalString(row.status ?? row.state),
    prompt_tokens: prompt,
    completion_tokens: asOptionalNonNegNumber(
      row.completion_tokens ?? row.completionTokens
    ),
    cache_read_input_tokens: cacheRead,
    cache_write_input_tokens: cacheWrite,
    standard_input_tokens: Math.max(0, prompt - cacheRead - cacheWrite),
    billed_cost_usd:
      row.billed_cost_usd ?? row.billedCostUsd ?? row.billed_cost ?? null,
    provider_attempt_count: asOptionalNonNegNumber(
      row.provider_attempt_count ?? row.providerAttemptCount
    ),
    cache_reporting_state: asOptionalString(
      row.cache_reporting_state ?? row.cacheReportingState
    ),
    routing_overhead_ms: asOptionalNonNegNumber(
      row.routing_overhead_ms ?? row.routingOverheadMs
    ),
    time_to_response_headers_ms: asOptionalNonNegNumber(
      row.time_to_response_headers_ms ?? row.timeToResponseHeadersMs
    ),
  };
}

export function parseCatalogPricingEvidence(
  model: Record<string, unknown> | null | undefined,
  catalogMeta: {
    pricing_version?: unknown;
    pricing_checked_at?: unknown;
    pricing_updated_at?: unknown;
  } = {}
): CatalogPricingEvidence {
  const pricing =
    model?.pricing && typeof model.pricing === "object" && !Array.isArray(model.pricing)
      ? (model.pricing as Record<string, unknown>)
      : {};
  const cacheRead = pricing.cache_read_input_per_million ?? null;
  const cacheWrite = pricing.cache_write_input_per_million ?? null;
  const cacheCapabilityAdvertised =
    asFiniteNumber(cacheRead) != null ||
    (typeof cacheRead === "string" && cacheRead.trim() !== "" && asFiniteNumber(cacheRead) != null);
  return {
    id: asOptionalString(model?.id),
    input_per_million: (pricing.input_per_million as string | number | null) ?? null,
    output_per_million: (pricing.output_per_million as string | number | null) ?? null,
    cache_read_input_per_million: (cacheRead as string | number | null) ?? null,
    cache_write_input_per_million: (cacheWrite as string | number | null) ?? null,
    cacheCapabilityAdvertised,
    pricing_version: asOptionalString(catalogMeta.pricing_version),
    pricing_checked_at: asOptionalString(catalogMeta.pricing_checked_at),
    pricing_updated_at: asOptionalString(catalogMeta.pricing_updated_at),
  };
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(nums: number[], p: number): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

function sumBilledUsd(rows: UsageRequestRow[]): number | null {
  let total = 0;
  let any = false;
  for (const row of rows) {
    const n = asFiniteNumber(row.billed_cost_usd);
    if (n == null) continue;
    any = true;
    total += n;
  }
  return any ? total : null;
}

export function computeCacheHitOrReadRatio(
  promptTokenTotal: number,
  cacheReadTokenTotal: number,
  sampleCount: number
): RatioOrNotMeasured {
  if (sampleCount <= 0) return "NOT_MEASURED";
  if (promptTokenTotal <= 0) return "NOT_MEASURED";
  return cacheReadTokenTotal / promptTokenTotal;
}

export function computeRatioDelta(
  current: RatioOrNotMeasured,
  prior: RatioOrNotMeasured | null | undefined
): RatioOrNotMeasured | null {
  if (prior == null) return null;
  if (current === "NOT_MEASURED" || prior === "NOT_MEASURED") return "NOT_MEASURED";
  return current - prior;
}

/** Aggregate prior-month cache-read ratios from the same usage source and active registry. */
export function buildPriorMonthCacheReadRatios(
  usageRows: readonly Record<string, unknown>[],
  activeModelIds: readonly string[] = MAIN_RP_MODEL_IDS
): Record<string, RatioOrNotMeasured> {
  const ids = resolveMainRpMonthlyCacheAuditModels(activeModelIds);
  const totals = Object.fromEntries(
    ids.map((id) => [id, { sampleCount: 0, promptTokenTotal: 0, cacheReadTokenTotal: 0 }])
  ) as Record<string, { sampleCount: number; promptTokenTotal: number; cacheReadTokenTotal: number }>;

  for (const raw of usageRows) {
    const row = pickUsageRequestRow(raw);
    if (!row.model || !totals[row.model]) continue;
    const total = totals[row.model]!;
    total.sampleCount += 1;
    total.promptTokenTotal += row.prompt_tokens;
    total.cacheReadTokenTotal += row.cache_read_input_tokens;
  }

  return Object.fromEntries(
    ids.map((id) => {
      const total = totals[id]!;
      return [
        id,
        computeCacheHitOrReadRatio(
          total.promptTokenTotal,
          total.cacheReadTokenTotal,
          total.sampleCount
        ),
      ];
    })
  );
}

export function classifyMonthlyCacheHealth(input: {
  modelId: string;
  inActiveRegistry: boolean;
  sampleCount: number;
  sufficientSampleThreshold?: number;
  cacheCapabilityAdvertised: boolean;
  cacheReadTokenTotal: number;
  cacheHitOrReadRatio: RatioOrNotMeasured;
  dominantCacheReportingState: string | null;
  multiAttemptRatio: RatioOrNotMeasured;
  prefixFingerprintChanged: boolean | null;
  anthropicExplicitExpected: boolean;
  multiAttemptRatioAlert?: number;
  healthyCacheReadRatio?: number;
}): MonthlyCacheHealthClass {
  const sufficient =
    input.sufficientSampleThreshold ?? DEFAULT_SUFFICIENT_SAMPLE_THRESHOLD;
  const multiAlert =
    input.multiAttemptRatioAlert ?? DEFAULT_MULTI_ATTEMPT_RATIO_ALERT;
  const healthyFloor =
    input.healthyCacheReadRatio ?? DEFAULT_HEALTHY_CACHE_READ_RATIO;

  if (!input.inActiveRegistry) return "AUDITOR_DRIFT";
  if (input.sampleCount <= 0) return "NOT_MEASURED";
  if (!input.cacheCapabilityAdvertised) return "CACHE_CAPABILITY_MISSING";

  const reporting = (input.dominantCacheReportingState ?? "").toLowerCase();
  const reportingUnknown =
    reporting === "" || reporting === "unknown" || reporting === "null";

  if (
    reportingUnknown &&
    input.cacheReadTokenTotal === 0 &&
    input.sampleCount >= sufficient
  ) {
    return "REPORTING_GAP";
  }

  if (
    input.multiAttemptRatio !== "NOT_MEASURED" &&
    input.multiAttemptRatio >= multiAlert &&
    (input.cacheHitOrReadRatio === "NOT_MEASURED" ||
      input.cacheHitOrReadRatio < healthyFloor)
  ) {
    return "ROUTING_INSTABILITY";
  }

  if (input.prefixFingerprintChanged === true) {
    return "PREFIX_INSTABILITY";
  }

  const zeroCacheReads =
    input.cacheReadTokenTotal === 0 ||
    input.cacheHitOrReadRatio === 0 ||
    (input.cacheHitOrReadRatio !== "NOT_MEASURED" &&
      input.cacheHitOrReadRatio < healthyFloor);

  if (input.sampleCount >= sufficient && zeroCacheReads) {
    if (input.anthropicExplicitExpected && !reportingUnknown) {
      return "CACHE_CONFIG_MISSING";
    }
    if (!reportingUnknown) {
      return "PREFIX_INSTABILITY";
    }
    return "REPORTING_GAP";
  }

  if (
    input.cacheHitOrReadRatio !== "NOT_MEASURED" &&
    input.cacheHitOrReadRatio >= healthyFloor
  ) {
    return "HEALTHY";
  }

  if (input.cacheReadTokenTotal > 0) return "HEALTHY";
  return "NOT_MEASURED";
}

export function buildAlertFingerprint(parts: {
  yearMonth: string;
  modelId: string;
  classification: MonthlyCacheHealthClass;
  cacheCapabilityAdvertised: boolean;
  mechanism: CacheMechanismKind;
}): string {
  const material = [
    parts.yearMonth,
    parts.modelId,
    parts.classification,
    parts.cacheCapabilityAdvertised ? "cap1" : "cap0",
    parts.mechanism,
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
}

/** Cross-month dedup key — same issue continuing should not spam as novel. */
export function buildPersistentIssueFingerprint(parts: {
  modelId: string;
  classification: MonthlyCacheHealthClass;
  cacheCapabilityAdvertised: boolean;
  mechanism: CacheMechanismKind;
}): string {
  const material = [
    parts.modelId,
    parts.classification,
    parts.cacheCapabilityAdvertised ? "cap1" : "cap0",
    parts.mechanism,
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 16);
}

export function aggregateModelUsage(opts: {
  modelId: string;
  rows: UsageRequestRow[];
  catalog: CatalogPricingEvidence | null;
  window: CalendarMonthWindow;
  activeRegistryIds: readonly string[];
  priorMonthCacheHitOrReadRatio?: RatioOrNotMeasured | null;
  prefixFingerprint?: PrefixFingerprintEvidence | null;
  sufficientSampleThreshold?: number;
}): ModelUsageAggregate {
  const modelId = opts.modelId.trim().toLowerCase();
  const rows = opts.rows;
  const sampleCount = rows.length;
  const promptTokenTotal = rows.reduce((s, r) => s + r.prompt_tokens, 0);
  const cacheReadTokenTotal = rows.reduce((s, r) => s + r.cache_read_input_tokens, 0);
  const cacheWriteTokenTotal = rows.reduce((s, r) => s + r.cache_write_input_tokens, 0);
  const cacheHitOrReadRatio = computeCacheHitOrReadRatio(
    promptTokenTotal,
    cacheReadTokenTotal,
    sampleCount
  );
  const prior = opts.priorMonthCacheHitOrReadRatio ?? null;
  const multiAttemptCount = rows.filter(
    (r) => (r.provider_attempt_count ?? 1) > 1
  ).length;
  const multiAttemptRatio: RatioOrNotMeasured =
    sampleCount <= 0 ? "NOT_MEASURED" : multiAttemptCount / sampleCount;
  const providerAttemptCountTotal = rows.reduce(
    (s, r) => s + (r.provider_attempt_count ?? 1),
    0
  );
  const reportingStates = [
    ...new Set(rows.map((r) => String(r.cache_reporting_state ?? "null"))),
  ].sort();
  const reportingCounts = new Map<string, number>();
  for (const r of rows) {
    const key = String(r.cache_reporting_state ?? "null");
    reportingCounts.set(key, (reportingCounts.get(key) ?? 0) + 1);
  }
  let dominantCacheReportingState: string | null = null;
  let dominantCount = -1;
  for (const [state, count] of reportingCounts) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantCacheReportingState = state;
    }
  }

  const routingSamples = rows
    .map((r) => r.routing_overhead_ms)
    .filter((n): n is number => n != null);
  const headerSamples = rows
    .map((r) => r.time_to_response_headers_ms)
    .filter((n): n is number => n != null);

  const cacheMechanism = resolveCacheMechanism(modelId);
  const inActiveRegistry = opts.activeRegistryIds
    .map((id) => id.trim().toLowerCase())
    .includes(modelId);
  const catalog = opts.catalog;
  const classification = classifyMonthlyCacheHealth({
    modelId,
    inActiveRegistry,
    sampleCount,
    sufficientSampleThreshold: opts.sufficientSampleThreshold,
    cacheCapabilityAdvertised: catalog?.cacheCapabilityAdvertised ?? false,
    cacheReadTokenTotal,
    cacheHitOrReadRatio,
    dominantCacheReportingState,
    multiAttemptRatio,
    prefixFingerprintChanged: opts.prefixFingerprint?.changed ?? null,
    anthropicExplicitExpected: cacheMechanism.appExplicitCacheControl,
  });

  const sorted = [...rows].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  );

  return {
    modelId,
    sampleCount,
    promptTokenTotal,
    cacheReadTokenTotal,
    cacheWriteTokenTotal,
    cacheHitOrReadRatio,
    priorMonthCacheHitOrReadRatio: prior,
    cacheHitOrReadRatioDelta: computeRatioDelta(cacheHitOrReadRatio, prior),
    cacheReportingStates: reportingStates,
    dominantCacheReportingState,
    providerAttemptCountTotal,
    multiAttemptCount,
    multiAttemptRatio,
    billedCostUsdTotal: sumBilledUsd(rows),
    latency: {
      routing_overhead_ms: {
        sampleCount: routingSamples.length,
        median: median(routingSamples),
        p95: percentile(routingSamples, 0.95),
        meaning: "provider_routing_overhead_before_upstream_response",
      },
      time_to_response_headers_ms: {
        sampleCount: headerSamples.length,
        median: median(headerSamples),
        p95: percentile(headerSamples, 0.95),
        meaning: "elapsed_ms_until_response_headers_not_ttft",
      },
    },
    catalog,
    cacheMechanism,
    prefixFingerprint: opts.prefixFingerprint ?? null,
    classification,
    alertFingerprint: buildAlertFingerprint({
      yearMonth: opts.window.yearMonth,
      modelId,
      classification,
      cacheCapabilityAdvertised: catalog?.cacheCapabilityAdvertised ?? false,
      mechanism: cacheMechanism.kind,
    }),
    persistentIssueFingerprint: buildPersistentIssueFingerprint({
      modelId,
      classification,
      cacheCapabilityAdvertised: catalog?.cacheCapabilityAdvertised ?? false,
      mechanism: cacheMechanism.kind,
    }),
    rawEvidence: {
      recentRows: sorted.slice(-8),
      cacheReadPositiveExamples: sorted
        .filter((r) => r.cache_read_input_tokens > 0)
        .slice(-8),
      multiAttemptExamples: sorted
        .filter((r) => (r.provider_attempt_count ?? 1) > 1)
        .slice(0, 8),
    },
  };
}

export async function fetchUsageRequestsPages(opts: {
  apiKey: string;
  startAt: string;
  endAt: string;
  maxPages?: number;
  fetchImpl?: UsageFetcher;
}): Promise<{
  rows: Record<string, unknown>[];
  pagesScanned: number;
  paginationComplete: boolean;
}> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxPages = Math.max(1, Math.floor(opts.maxPages ?? DEFAULT_MAX_USAGE_PAGES));
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let pagesScanned = 0;

  do {
    const params = new URLSearchParams({
      start_at: opts.startAt,
      end_at: opts.endAt,
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);
    const res = await fetchImpl(`${CI_USAGE_REQUESTS_PATH}?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`usage API HTTP ${res.status}`);
    }
    const payload = (await res.json()) as {
      data?: unknown[];
      next_cursor?: string | null;
    };
    const items = Array.isArray(payload.data) ? payload.data : [];
    for (const item of items) {
      if (item && typeof item === "object") {
        rows.push(item as Record<string, unknown>);
      }
    }
    cursor =
      typeof payload.next_cursor === "string" && payload.next_cursor.trim()
        ? payload.next_cursor.trim()
        : null;
    pagesScanned += 1;
  } while (cursor && pagesScanned < maxPages);

  return {
    rows,
    pagesScanned,
    paginationComplete: !cursor,
  };
}

export async function fetchCatalogPricingForModels(opts: {
  apiKey: string;
  modelIds: readonly string[];
  fetchImpl?: UsageFetcher;
}): Promise<Record<string, CatalogPricingEvidence>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(CI_MODELS_CATALOG_PATH, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`catalog API HTTP ${res.status}`);
  const payload = (await res.json()) as {
    data?: Record<string, unknown>[];
    pricing_version?: unknown;
    pricing_checked_at?: unknown;
    pricing_updated_at?: unknown;
  };
  const meta = {
    pricing_version: payload.pricing_version,
    pricing_checked_at: payload.pricing_checked_at,
    pricing_updated_at: payload.pricing_updated_at,
  };
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of payload.data ?? []) {
    const id = asOptionalString(row.id)?.toLowerCase();
    if (id) byId.set(id, row);
  }
  const out: Record<string, CatalogPricingEvidence> = {};
  for (const modelId of opts.modelIds) {
    const key = modelId.trim().toLowerCase();
    out[key] = parseCatalogPricingEvidence(byId.get(key) ?? null, meta);
  }
  return out;
}

export type BuildMonthlyCacheAuditInput = {
  window: CalendarMonthWindow;
  activeModelIds?: readonly string[];
  /** Models the previous one-off auditor may still list — never audited as Main RP. */
  knownRetiredModelIds?: readonly string[];
  usageRows: Record<string, unknown>[];
  catalogByModel: Record<string, CatalogPricingEvidence>;
  pagesScanned: number;
  paginationComplete: boolean;
  maxPages?: number;
  credentialSource?: string | null;
  priorMonthRatios?: Record<string, RatioOrNotMeasured>;
  prefixFingerprints?: Record<string, PrefixFingerprintEvidence>;
  generatedAt?: string;
  runStatus?: "OK" | "NOT_RUN" | "INCOMPLETE";
  notRunReason?: string | null;
};

/**
 * Pure report builder — injectable rows/catalog for deterministic regression.
 * providerGenerationCalls is always 0.
 */
export function buildMonthlyCacheAuditReport(
  input: BuildMonthlyCacheAuditInput
): MonthlyCacheAuditReport {
  const activeModelIds = resolveMainRpMonthlyCacheAuditModels(
    input.activeModelIds ?? MAIN_RP_MODEL_IDS
  );
  const knownRetired = (input.knownRetiredModelIds ?? []).map((id) =>
    id.trim().toLowerCase()
  );
  const retiredModelsExcluded = knownRetired.filter(
    (id) => !activeModelIds.includes(id)
  );

  const byModel: Record<string, UsageRequestRow[]> = Object.fromEntries(
    activeModelIds.map((id) => [id, []])
  );
  for (const raw of input.usageRows) {
    const picked = pickUsageRequestRow(raw);
    const model = picked.model;
    if (!model) continue;
    if (!Object.prototype.hasOwnProperty.call(byModel, model)) continue;
    byModel[model]!.push(picked);
  }

  const models: Record<string, ModelUsageAggregate> = {};
  const classifications: Record<string, MonthlyCacheHealthClass> = {};
  const alertFingerprints: string[] = [];

  for (const modelId of activeModelIds) {
    const aggregate = aggregateModelUsage({
      modelId,
      rows: byModel[modelId] ?? [],
      catalog: input.catalogByModel[modelId] ?? null,
      window: input.window,
      activeRegistryIds: activeModelIds,
      priorMonthCacheHitOrReadRatio: input.priorMonthRatios?.[modelId] ?? null,
      prefixFingerprint: input.prefixFingerprints?.[modelId] ?? null,
    });
    models[modelId] = aggregate;
    classifications[modelId] = aggregate.classification;
    if (
      aggregate.classification !== "HEALTHY" &&
      aggregate.classification !== "NOT_MEASURED"
    ) {
      alertFingerprints.push(aggregate.alertFingerprint);
    }
  }

  const runStatus =
    input.runStatus ??
    (input.paginationComplete ? "OK" : "INCOMPLETE");

  return {
    auditVersion: MAIN_RP_MONTHLY_CACHE_AUDIT_VERSION,
    audit: "main-rp-monthly-cache-audit",
    owners: MAIN_RP_MONTHLY_CACHE_AUDIT_OWNERS,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    window: input.window,
    activeModelIds,
    retiredModelsExcluded,
    providerGenerationCalls: 0,
    openRouterResponseCachingUsedForMainRp: OPENROUTER_RESPONSE_CACHING_USED_FOR_MAIN_RP,
    query: {
      pagesScanned: input.pagesScanned,
      totalRequestsScanned: input.usageRows.length,
      paginationComplete: input.paginationComplete,
      maxPages: input.maxPages ?? DEFAULT_MAX_USAGE_PAGES,
    },
    credentialSource: input.credentialSource ?? null,
    runStatus,
    notRunReason: input.notRunReason ?? null,
    models,
    classifications,
    alertFingerprints: [...new Set(alertFingerprints)].sort(),
  };
}

export function buildNotRunMonthlyCacheAuditReport(opts: {
  window: CalendarMonthWindow;
  reason: string;
  activeModelIds?: readonly string[];
  knownRetiredModelIds?: readonly string[];
  generatedAt?: string;
}): MonthlyCacheAuditReport {
  const activeModelIds = resolveMainRpMonthlyCacheAuditModels(
    opts.activeModelIds ?? MAIN_RP_MODEL_IDS
  );
  return buildMonthlyCacheAuditReport({
    window: opts.window,
    activeModelIds,
    knownRetiredModelIds: opts.knownRetiredModelIds,
    usageRows: [],
    catalogByModel: Object.fromEntries(
      activeModelIds.map((id) => [
        id,
        parseCatalogPricingEvidence(null, {}),
      ])
    ),
    pagesScanned: 0,
    paginationComplete: true,
    credentialSource: null,
    generatedAt: opts.generatedAt,
    runStatus: "NOT_RUN",
    notRunReason: opts.reason,
  });
}

/** Detect secret leakage in serialized report / logs (redacted placeholders do not count). */
export function countSecretLeakageMarkers(text: string): number {
  const patterns = [
    /CHEAPER_INFERENCE_USAGE_API_KEY=(?!\[REDACTED\])\S+/i,
    /CHEAPER_INFERENCE_BENCHMARK_API_KEY=(?!\[REDACTED\])\S+/i,
    /CHEAPER_INFERENCE_API_KEY=(?!\[REDACTED\])\S+/i,
    /Bearer\s+[A-Za-z0-9._\-]{8,}/i,
  ];
  let count = 0;
  for (const re of patterns) {
    if (re.test(text)) count += 1;
  }
  return count;
}

export function assertActiveModelsTrackRegistry(
  auditModelIds: readonly string[],
  registryIds: readonly string[] = MAIN_RP_MODEL_IDS
): void {
  const a = [...auditModelIds].map((id) => id.toLowerCase()).sort();
  const b = [...registryIds].map((id) => id.toLowerCase()).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(
      `AUDITOR_DRIFT: audit models ${JSON.stringify(a)} != registry ${JSON.stringify(b)}`
    );
  }
}

/** Type-level helper — SelectedAI union stays registry-bound. */
export type MainRpAuditModelId = SelectedAI;

export function renderMonthlyCacheAuditMarkdown(report: MonthlyCacheAuditReport): string {
  const lines: string[] = [
    `# Main RP Monthly Cache Audit — ${report.window.yearMonth}`,
    "",
    `- auditVersion: ${report.auditVersion}`,
    `- generatedAt: ${report.generatedAt}`,
    `- window: ${report.window.startAt} → ${report.window.endAt} (UTC, end exclusive)`,
    `- runStatus: ${report.runStatus}`,
    `- providerGenerationCalls: ${report.providerGenerationCalls}`,
    `- openRouterResponseCachingUsedForMainRp: ${report.openRouterResponseCachingUsedForMainRp}`,
    `- activeModelIds: ${report.activeModelIds.join(", ")}`,
    `- retiredModelsExcluded: ${report.retiredModelsExcluded.join(", ") || "(none listed)"}`,
    `- pagesScanned: ${report.query.pagesScanned} · paginationComplete: ${report.query.paginationComplete}`,
    "",
    "## Classifications (not a quality score)",
    "",
    "| Model | Class | Samples | cache_read ratio | multi-attempt ratio | mechanism |",
    "|---|---|---:|---:|---:|---|",
  ];
  for (const modelId of report.activeModelIds) {
    const m = report.models[modelId]!;
    lines.push(
      `| ${modelId} | ${m.classification} | ${m.sampleCount} | ${m.cacheHitOrReadRatio} | ${m.multiAttemptRatio} | ${m.cacheMechanism.kind} |`
    );
  }
  lines.push(
    "",
    "## Latency field semantics",
    "",
    "- `routing_overhead_ms`: provider routing overhead before upstream response (not TTFT).",
    "- `time_to_response_headers_ms`: elapsed ms until response headers (not TTFT).",
    "",
    "## Alert fingerprints (dedup)",
    ""
  );
  if (report.alertFingerprints.length === 0) {
    lines.push("- (none)");
  } else {
    for (const fp of report.alertFingerprints) {
      lines.push(`- \`${fp}\``);
    }
  }
  lines.push(
    "",
    "## Owners",
    "",
    "```json",
    JSON.stringify(report.owners, null, 2),
    "```",
    ""
  );
  return lines.join("\n");
}
