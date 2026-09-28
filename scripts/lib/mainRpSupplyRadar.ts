/**
 * Monthly external Main-RP supply radar (OBSERVE_ONLY).
 *
 * Discovers alternative provider endpoints for the CURRENT Main-RP registry through
 * OpenRouter's provider network, compares objective market endpoint evidence against
 * current CheaperInference catalog procurement rates, and NEVER makes generation calls.
 *
 * This is procurement research only. It does not alter routing, pricing, billing, prompts,
 * model registration, or provider credentials.
 */
import { createHash } from "node:crypto";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  type SelectedAI,
} from "@/lib/chatModels";
import { REPRESENTATIVE_TRACKER_WORKLOAD } from "@/lib/modelPricingTracker";
import type { CatalogPricingEvidence } from "./mainRpMonthlyCacheAudit";

export const MAIN_RP_SUPPLY_RADAR_VERSION = 1;
export const OPENROUTER_SUPPLY_RADAR_ENV = "OPENROUTER_SUPPLY_RADAR_API_KEY";
export const OPENROUTER_COMPAT_ENV = "OPENROUTER_API_KEY";
export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

export const MAIN_RP_SUPPLY_RADAR_OWNERS = Object.freeze({
  activeModelRegistry: "src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS",
  currentProcurementCatalog:
    "scripts/lib/mainRpMonthlyCacheAudit.ts#fetchCatalogPricingForModels",
  representativeWorkload:
    "src/lib/modelPricingTracker.ts#REPRESENTATIVE_TRACKER_WORKLOAD",
  qualificationPacket: "scripts/lib/rpModelQualificationPacket.ts",
  supplyRadar: "scripts/lib/mainRpSupplyRadar.ts",
  marketIndex: "OpenRouter /api/v1/models/:author/:slug/endpoints",
  providerMetadata: "OpenRouter /api/v1/providers",
});

export type SupplyRadarCredentialResolution =
  | { ok: true; apiKey: string; source: typeof OPENROUTER_SUPPLY_RADAR_ENV | typeof OPENROUTER_COMPAT_ENV }
  | { ok: false; status: "NOT_RUN"; reason: "missing_openrouter_supply_radar_credential"; providerGenerationCalls: 0 };

export function resolveOpenRouterSupplyRadarCredential(
  env: NodeJS.ProcessEnv = process.env
): SupplyRadarCredentialResolution {
  const dedicated = env[OPENROUTER_SUPPLY_RADAR_ENV]?.trim();
  if (dedicated) return { ok: true, apiKey: dedicated, source: OPENROUTER_SUPPLY_RADAR_ENV };
  const compat = env[OPENROUTER_COMPAT_ENV]?.trim();
  if (compat) return { ok: true, apiKey: compat, source: OPENROUTER_COMPAT_ENV };
  return {
    ok: false,
    status: "NOT_RUN",
    reason: "missing_openrouter_supply_radar_credential",
    providerGenerationCalls: 0,
  };
}

export function sanitizeOpenRouterSupplyRadarCredentialText(text: string): string {
  return text
    .replace(/OPENROUTER_SUPPLY_RADAR_API_KEY=\S+/gi, "OPENROUTER_SUPPLY_RADAR_API_KEY=[REDACTED]")
    .replace(/OPENROUTER_API_KEY=\S+/gi, "OPENROUTER_API_KEY=[REDACTED]");
}

export type OpenRouterSupplyIdentity = {
  internalModelId: SelectedAI;
  openRouterSlug: string;
};

const OPENROUTER_SLUG_ADAPTER: Record<SelectedAI, string> = {
  "deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash",
  "gemini-3.1-pro-preview": "google/gemini-3.1-pro-preview",
  "gemini-3.7-flash": "google/gemini-3.7-flash",
  "gpt-5.6-terra": "openai/gpt-5.6-terra",
  "claude-opus-5.5": "anthropic/claude-opus-5.5",
};

export function resolveOpenRouterSupplyIdentity(modelId: SelectedAI): OpenRouterSupplyIdentity {
  const openRouterSlug = OPENROUTER_SLUG_ADAPTER[modelId];
  if (!openRouterSlug) {
    throw new Error(`Missing OpenRouter supply identity adapter for active Main RP model: ${modelId}`);
  }
  return { internalModelId: modelId, openRouterSlug };
}

export function listMainRpSupplyIdentities(): OpenRouterSupplyIdentity[] {
  return MAIN_RP_MODEL_IDS.map(resolveOpenRouterSupplyIdentity);
}

type FetchLike = typeof fetch;
type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function perTokenToPerMillion(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : n * 1_000_000;
}
function metricP50(v: unknown): number | null {
  return num(asObj(v)?.p50);
}
function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type ProviderMetadata = {
  name: string;
  slug: string | null;
  headquarters: string | null;
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  statusPageUrl: string | null;
  datacenters: string[];
};

export type SupplyEndpointEvidence = {
  modelId: string;
  providerName: string;
  providerTag: string | null;
  quantization: string | null;
  contextLength: number | null;
  maxPromptTokens: number | null;
  maxCompletionTokens: number | null;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  supportsImplicitCaching: boolean | null;
  latencyP50SecondsLast30m: number | null;
  throughputP50TokensPerSecondLast30m: number | null;
  uptimeLast1dPercent: number | null;
  uptimeLast30mPercent: number | null;
  status: number | null;
  supportedParameters: string[];
  provider: ProviderMetadata | null;
};

export type ProcurementBaseline = {
  provider: "cheaperinference";
  modelId: string;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  cacheCapabilityAdvertised: boolean;
  pricingVersion: string | null;
  pricingCheckedAt: string | null;
  pricingUpdatedAt: string | null;
};

export type SupplyComparison = SupplyEndpointEvidence & {
  rawEndpointRepresentativeUncachedRateUsd: number | null;
  currentCiRepresentativeUncachedProcurementUsd: number | null;
  rawEndpointRateDeltaVsCurrentCiPercent: number | null;
  inputPriceDeltaPercent: number | null;
  outputPriceDeltaPercent: number | null;
  cacheReadPriceDeltaPercent: number | null;
  lowerRawEndpointRateThanCurrentCi: boolean | null;
  evidenceFlags: string[];
};

export type SupplyModelReport = {
  modelId: SelectedAI;
  label: string;
  openRouterSlug: string;
  currentProcurement: ProcurementBaseline | null;
  endpointCount: number;
  providersDiscovered: string[];
  comparisons: SupplyComparison[];
  lowerRawEndpointRateCount: number;
  evidenceFingerprint: string;
};

export type MainRpSupplyRadarReport = {
  version: number;
  generatedAt: string;
  status: "OK" | "PARTIAL" | "NOT_RUN";
  providerGenerationCalls: 0;
  activeModelIds: readonly SelectedAI[];
  credentialSource: string | null;
  currentProcurementEvidence: "cheaperinference_catalog" | "unavailable";
  marketEvidence: "openrouter_endpoint_metrics" | "unavailable";
  notes: string[];
  models: SupplyModelReport[];
};

export function parseProviderMetadata(payload: unknown): Map<string, ProviderMetadata> {
  const root = asObj(payload);
  const data = Array.isArray(root?.data) ? root!.data as unknown[] : [];
  const out = new Map<string, ProviderMetadata>();
  for (const raw of data) {
    const row = asObj(raw);
    if (!row) continue;
    const name = str(row.name);
    if (!name) continue;
    const meta: ProviderMetadata = {
      name,
      slug: str(row.slug),
      headquarters: str(row.headquarters),
      privacyPolicyUrl: str(row.privacy_policy_url),
      termsOfServiceUrl: str(row.terms_of_service_url),
      statusPageUrl: str(row.status_page_url),
      datacenters: Array.isArray(row.datacenters)
        ? row.datacenters.filter((x): x is string => typeof x === "string")
        : [],
    };
    out.set(name.toLowerCase(), meta);
    if (meta.slug) out.set(meta.slug.toLowerCase(), meta);
  }
  return out;
}

export function parseOpenRouterEndpoints(
  payload: unknown,
  providerMetadata: Map<string, ProviderMetadata> = new Map()
): SupplyEndpointEvidence[] {
  const root = asObj(payload);
  const data = asObj(root?.data);
  const endpoints = Array.isArray(data?.endpoints) ? data!.endpoints as unknown[] : [];
  const out: SupplyEndpointEvidence[] = [];
  for (const raw of endpoints) {
    const row = asObj(raw);
    if (!row) continue;
    const providerName = str(row.provider_name) ?? str(row.name) ?? "unknown";
    const tag = str(row.tag);
    const pricing = asObj(row.pricing) ?? {};
    const provider =
      providerMetadata.get(providerName.toLowerCase()) ??
      (tag ? providerMetadata.get(tag.toLowerCase()) ?? null : null);
    out.push({
      modelId: str(row.model_id) ?? str(data?.id) ?? "",
      providerName,
      providerTag: tag,
      quantization: str(row.quantization),
      contextLength: num(row.context_length),
      maxPromptTokens: num(row.max_prompt_tokens),
      maxCompletionTokens: num(row.max_completion_tokens),
      inputUsdPerMillion: perTokenToPerMillion(pricing.prompt),
      outputUsdPerMillion: perTokenToPerMillion(pricing.completion),
      cacheReadUsdPerMillion: perTokenToPerMillion(
        pricing.input_cache_read ?? pricing.cache_read
      ),
      cacheWriteUsdPerMillion: perTokenToPerMillion(
        pricing.input_cache_write ?? pricing.cache_write
      ),
      supportsImplicitCaching:
        typeof row.supports_implicit_caching === "boolean"
          ? row.supports_implicit_caching
          : null,
      latencyP50SecondsLast30m: metricP50(row.latency_last_30m),
      throughputP50TokensPerSecondLast30m: metricP50(row.throughput_last_30m),
      uptimeLast1dPercent: num(row.uptime_last_1d),
      uptimeLast30mPercent: num(row.uptime_last_30m),
      status: num(row.status),
      supportedParameters: Array.isArray(row.supported_parameters)
        ? row.supported_parameters.filter((x): x is string => typeof x === "string")
        : [],
      provider,
    });
  }
  return out;
}

function baselineFromCatalog(
  modelId: SelectedAI,
  catalog: CatalogPricingEvidence | null | undefined
): ProcurementBaseline | null {
  if (!catalog || !catalog.id) return null;
  return {
    provider: "cheaperinference",
    modelId,
    inputUsdPerMillion: num(catalog.input_per_million),
    outputUsdPerMillion: num(catalog.output_per_million),
    cacheReadUsdPerMillion: num(catalog.cache_read_input_per_million),
    cacheWriteUsdPerMillion: num(catalog.cache_write_input_per_million),
    cacheCapabilityAdvertised: catalog.cacheCapabilityAdvertised,
    pricingVersion: catalog.pricing_version,
    pricingCheckedAt: catalog.pricing_checked_at,
    pricingUpdatedAt: catalog.pricing_updated_at,
  };
}

function representativeUncachedCost(inputPerM: number | null, outputPerM: number | null): number | null {
  if (inputPerM == null || outputPerM == null) return null;
  return (
    inputPerM * REPRESENTATIVE_TRACKER_WORKLOAD.promptTokens / 1_000_000 +
    outputPerM * REPRESENTATIVE_TRACKER_WORKLOAD.outputTokens / 1_000_000
  );
}
function deltaPct(candidate: number | null, baseline: number | null): number | null {
  if (candidate == null || baseline == null || baseline <= 0) return null;
  return (candidate - baseline) / baseline;
}

export function compareSupplyEndpoint(
  endpoint: SupplyEndpointEvidence,
  baseline: ProcurementBaseline | null
): SupplyComparison {
  const candidateCost = representativeUncachedCost(
    endpoint.inputUsdPerMillion,
    endpoint.outputUsdPerMillion
  );
  const baselineCost = representativeUncachedCost(
    baseline?.inputUsdPerMillion ?? null,
    baseline?.outputUsdPerMillion ?? null
  );
  const costDelta = deltaPct(candidateCost, baselineCost);
  const flags: string[] = [];
  if (endpoint.status === 0) flags.push("ENDPOINT_STATUS_OK");
  if (endpoint.latencyP50SecondsLast30m != null) flags.push("LATENCY_EVIDENCE_PRESENT");
  if (endpoint.throughputP50TokensPerSecondLast30m != null) flags.push("THROUGHPUT_EVIDENCE_PRESENT");
  if (endpoint.uptimeLast1dPercent != null) flags.push("UPTIME_EVIDENCE_PRESENT");
  if (endpoint.cacheReadUsdPerMillion != null || endpoint.supportsImplicitCaching === true) {
    flags.push("CACHE_EVIDENCE_PRESENT");
  }
  if (costDelta != null && costDelta < 0) flags.push("LOWER_RAW_ENDPOINT_RATE_THAN_CURRENT_CI");
  if (!endpoint.quantization) flags.push("QUANTIZATION_UNSPECIFIED");
  if (!endpoint.provider?.privacyPolicyUrl) flags.push("PRIVACY_POLICY_METADATA_MISSING");
  if (!endpoint.provider?.statusPageUrl) flags.push("STATUS_PAGE_METADATA_MISSING");

  return {
    ...endpoint,
    rawEndpointRepresentativeUncachedRateUsd: candidateCost,
    currentCiRepresentativeUncachedProcurementUsd: baselineCost,
    rawEndpointRateDeltaVsCurrentCiPercent: costDelta,
    inputPriceDeltaPercent: deltaPct(
      endpoint.inputUsdPerMillion,
      baseline?.inputUsdPerMillion ?? null
    ),
    outputPriceDeltaPercent: deltaPct(
      endpoint.outputUsdPerMillion,
      baseline?.outputUsdPerMillion ?? null
    ),
    cacheReadPriceDeltaPercent: deltaPct(
      endpoint.cacheReadUsdPerMillion,
      baseline?.cacheReadUsdPerMillion ?? null
    ),
    lowerRawEndpointRateThanCurrentCi:
      costDelta == null ? null : costDelta < 0,
    evidenceFlags: flags,
  };
}

export function buildMainRpSupplyRadarReport(input: {
  endpointsByModel: Partial<Record<SelectedAI, SupplyEndpointEvidence[]>>;
  ciCatalogByModel?: Record<string, CatalogPricingEvidence> | null;
  credentialSource?: string | null;
  generatedAt?: string;
}): MainRpSupplyRadarReport {
  const models: SupplyModelReport[] = MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => {
    const identity = resolveOpenRouterSupplyIdentity(option.id);
    const baseline = baselineFromCatalog(
      option.id,
      input.ciCatalogByModel?.[option.id]
    );
    const endpoints = input.endpointsByModel[option.id] ?? [];
    const comparisons = endpoints
      .map((endpoint) => compareSupplyEndpoint(endpoint, baseline))
      .sort((a, b) => {
        const ac = a.rawEndpointRepresentativeUncachedRateUsd ?? Number.POSITIVE_INFINITY;
        const bc = b.rawEndpointRepresentativeUncachedRateUsd ?? Number.POSITIVE_INFINITY;
        if (ac !== bc) return ac - bc;
        return a.providerName.localeCompare(b.providerName);
      });
    return {
      modelId: option.id,
      label: option.label,
      openRouterSlug: identity.openRouterSlug,
      currentProcurement: baseline,
      endpointCount: comparisons.length,
      providersDiscovered: [...new Set(comparisons.map((x) => x.providerName))].sort(),
      comparisons,
      lowerRawEndpointRateCount: comparisons.filter(
        (x) => x.lowerRawEndpointRateThanCurrentCi === true
      ).length,
      evidenceFingerprint: sha(
        comparisons.map((x) => ({
          providerName: x.providerName,
          providerTag: x.providerTag,
          quantization: x.quantization,
          input: x.inputUsdPerMillion,
          output: x.outputUsdPerMillion,
          cacheRead: x.cacheReadUsdPerMillion,
          latency: x.latencyP50SecondsLast30m,
          throughput: x.throughputP50TokensPerSecondLast30m,
          uptime: x.uptimeLast1dPercent,
          status: x.status,
        }))
      ),
    };
  });

  const hasAnyMarket = models.some((m) => m.endpointCount > 0);
  const hasAnyCi = models.some((m) => m.currentProcurement != null);
  const hasAllMarket = models.every((m) => m.endpointCount > 0);
  const hasAllCi = models.every((m) => m.currentProcurement != null);
  const status: MainRpSupplyRadarReport["status"] =
    hasAllMarket && hasAllCi
      ? "OK"
      : hasAnyMarket || hasAnyCi
        ? "PARTIAL"
        : "NOT_RUN";

  return {
    version: MAIN_RP_SUPPLY_RADAR_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status,
    providerGenerationCalls: 0,
    activeModelIds: MAIN_RP_MODEL_IDS,
    credentialSource: input.credentialSource ?? null,
    currentProcurementEvidence: hasAnyCi ? "cheaperinference_catalog" : "unavailable",
    marketEvidence: hasAnyMarket ? "openrouter_endpoint_metrics" : "unavailable",
    notes: [
      "OBSERVE_ONLY: no production routing/pricing/model registry mutation.",
      "OpenRouter endpoint metrics are market-observed evidence, not this site's own live provider benchmark.",
      "OpenRouter endpoint rates are screening evidence only: they exclude account/platform fees and are not assumed to equal a provider's direct-contract price or final cash procurement cost.",
      "No composite quality score or automatic provider winner is produced.",
      "Paid live qualification is a separate follow-up using the canonical RP qualification fixture.",
    ],
    models,
  };
}

export async function fetchOpenRouterProviderMetadata(opts: {
  apiKey: string;
  fetchImpl?: FetchLike;
}): Promise<Map<string, ProviderMetadata>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${OPENROUTER_API_BASE}/providers`, {
    method: "GET",
    headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenRouter providers HTTP ${res.status}`);
  return parseProviderMetadata(await res.json());
}

export async function fetchOpenRouterEndpointsForModel(opts: {
  apiKey: string;
  openRouterSlug: string;
  providerMetadata?: Map<string, ProviderMetadata>;
  fetchImpl?: FetchLike;
}): Promise<SupplyEndpointEvidence[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const parts = opts.openRouterSlug.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid OpenRouter model slug: ${opts.openRouterSlug}`);
  }
  const url = `${OPENROUTER_API_BASE}/models/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/endpoints`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenRouter endpoints HTTP ${res.status} for ${opts.openRouterSlug}`);
  return parseOpenRouterEndpoints(await res.json(), opts.providerMetadata);
}

export function renderMainRpSupplyRadarMarkdown(report: MainRpSupplyRadarReport): string {
  const lines: string[] = [];
  lines.push("# Monthly Main RP Supply Radar", "");
  lines.push(`- status: **${report.status}**`);
  lines.push(`- generated: ${report.generatedAt}`);
  lines.push(`- provider generation calls: **${report.providerGenerationCalls}**`);
  lines.push(`- active models: ${report.activeModelIds.join(", ")}`);
  lines.push("");
  for (const model of report.models) {
    lines.push(`## ${model.label} (${model.modelId})`, "");
    const ci = model.currentProcurement;
    lines.push(
      ci
        ? `Current CI: input $${ci.inputUsdPerMillion ?? "?"}/M · output $${ci.outputUsdPerMillion ?? "?"}/M · cache read $${ci.cacheReadUsdPerMillion ?? "?"}/M`
        : "Current CI: unavailable"
    );
    lines.push(`OpenRouter market endpoints: ${model.endpointCount} · lower raw endpoint-rate candidates: ${model.lowerRawEndpointRateCount}`, "");
    lines.push("| Provider | In/M | Out/M | Cache/M | Latency p50 | TPS p50 | Uptime 1d | Δ raw endpoint rate |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
    for (const e of model.comparisons) {
      const pct =
        e.rawEndpointRateDeltaVsCurrentCiPercent == null
          ? "n/a"
          : `${(e.rawEndpointRateDeltaVsCurrentCiPercent * 100).toFixed(1)}%`;
      lines.push(
        `| ${e.providerName} | ${e.inputUsdPerMillion ?? "n/a"} | ${e.outputUsdPerMillion ?? "n/a"} | ${e.cacheReadUsdPerMillion ?? "n/a"} | ${e.latencyP50SecondsLast30m ?? "n/a"} | ${e.throughputP50TokensPerSecondLast30m ?? "n/a"} | ${e.uptimeLast1dPercent ?? "n/a"} | ${pct} |`
      );
    }
    lines.push("");
  }
  lines.push("## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
