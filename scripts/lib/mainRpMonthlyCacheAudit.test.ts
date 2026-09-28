import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { MAIN_RP_MODEL_IDS, MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import {
  BENCHMARK_CHEAPER_INFERENCE_ENV,
} from "./benchmarkCheaperInferenceCredential";
import {
  USAGE_REPORTING_CHEAPER_INFERENCE_ENV,
  resolveUsageReportingCheaperInferenceApiKey,
  sanitizeUsageReportingCredentialText,
} from "./cheaperInferenceUsageReportingCredential";
import {
  MAIN_RP_MONTHLY_CACHE_AUDIT_OWNERS,
  aggregateModelUsage,
  assertActiveModelsTrackRegistry,
  buildAlertFingerprint,
  buildMonthlyCacheAuditReport,
  buildNotRunMonthlyCacheAuditReport,
  buildPersistentIssueFingerprint,
  buildPriorMonthCacheReadRatios,
  calendarMonthWindowFromYearMonth,
  classifyMonthlyCacheHealth,
  computeCacheHitOrReadRatio,
  countSecretLeakageMarkers,
  fetchUsageRequestsPages,
  parseCatalogPricingEvidence,
  previousCalendarMonthWindow,
  priorCalendarMonthWindow,
  resolveCacheMechanism,
  resolveMainRpMonthlyCacheAuditModels,
} from "./mainRpMonthlyCacheAudit";

const WINDOW = calendarMonthWindowFromYearMonth("2026-08");

function catalog(opts: {
  id: string;
  cacheRead?: string | null;
  pricingVersion?: string;
}): ReturnType<typeof parseCatalogPricingEvidence> {
  return parseCatalogPricingEvidence(
    {
      id: opts.id,
      pricing: {
        input_per_million: "1.0",
        output_per_million: "2.0",
        cache_read_input_per_million: opts.cacheRead === null ? undefined : (opts.cacheRead ?? "0.1"),
        cache_write_input_per_million: "0.2",
      },
    },
    {
      pricing_version: opts.pricingVersion ?? "pv-1",
      pricing_checked_at: "2026-09-01T00:00:00Z",
      pricing_updated_at: "2026-08-15T00:00:00Z",
    }
  );
}

function usageRow(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    request_id: "req-1",
    created_at: "2026-08-15 12:00:00",
    model: "deepseek-v4.1-flash",
    endpoint: "/v1/chat/completions",
    status: "settled",
    prompt_tokens: 1000,
    completion_tokens: 100,
    cache_read_input_tokens: 0,
    cache_write_input_tokens: 0,
    billed_cost_usd: "0.01",
    provider_attempt_count: 1,
    cache_reporting_state: "hit",
    routing_overhead_ms: 10,
    time_to_response_headers_ms: 20,
    ...partial,
  };
}

test("1+2+3 active registry change auto-updates auditor targets; retired excluded; new active included", () => {
  const current = resolveMainRpMonthlyCacheAuditModels(MAIN_RP_MODEL_IDS);
  assert.deepEqual(current, [...MAIN_RP_MODEL_IDS]);
  assert.ok(!current.includes("deepseek-v4-pro-0813"));

  const expanded = resolveMainRpMonthlyCacheAuditModels([
    ...MAIN_RP_MODEL_IDS,
    "new-active-model-x",
  ]);
  assert.ok(expanded.includes("new-active-model-x"));
  assert.equal(expanded.length, MAIN_RP_MODEL_IDS.length + 1);

  const shrunk = resolveMainRpMonthlyCacheAuditModels(
    MAIN_RP_MODEL_IDS.filter((id) => id !== "gpt-5.6-terra")
  );
  assert.ok(!shrunk.includes("gpt-5.6-terra"));
  assert.ok(!shrunk.includes("deepseek-v4-pro-0813"));

  assertActiveModelsTrackRegistry(current, MAIN_RP_MODEL_IDS);

  const report = buildMonthlyCacheAuditReport({
    window: WINDOW,
    activeModelIds: expanded,
    knownRetiredModelIds: ["deepseek-v4-pro-0813"],
    usageRows: [
      usageRow({ model: "deepseek-v4-pro-0813", cache_read_input_tokens: 900 }),
      usageRow({ model: "new-active-model-x", cache_read_input_tokens: 500 }),
    ],
    catalogByModel: Object.fromEntries(
      expanded.map((id) => [id, catalog({ id })])
    ),
    pagesScanned: 1,
    paginationComplete: true,
  });
  assert.ok(!("deepseek-v4-pro-0813" in report.models));
  assert.ok("new-active-model-x" in report.models);
  assert.deepEqual(report.retiredModelsExcluded, ["deepseek-v4-pro-0813"]);
  assert.equal(report.providerGenerationCalls, 0);
});

test("4 cache read positive → HEALTHY", () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    usageRow({
      request_id: `r-${i}`,
      prompt_tokens: 1000,
      cache_read_input_tokens: 800,
      cache_reporting_state: "hit",
    })
  );
  const agg = aggregateModelUsage({
    modelId: "deepseek-v4.1-flash",
    rows: rows.map((r) => ({
      request_id: String(r.request_id),
      created_at: String(r.created_at),
      model: "deepseek-v4.1-flash",
      endpoint: "/v1/chat/completions",
      status: "settled",
      prompt_tokens: 1000,
      completion_tokens: 100,
      cache_read_input_tokens: 800,
      cache_write_input_tokens: 0,
      standard_input_tokens: 200,
      billed_cost_usd: "0.01",
      provider_attempt_count: 1,
      cache_reporting_state: "hit",
      routing_overhead_ms: 10,
      time_to_response_headers_ms: 20,
    })),
    catalog: catalog({ id: "deepseek-v4.1-flash" }),
    window: WINDOW,
    activeRegistryIds: MAIN_RP_MODEL_IDS,
  });
  assert.equal(agg.classification, "HEALTHY");
  assert.equal(agg.cacheHitOrReadRatio, 0.8);
});

test("5 advertised capability + sufficient samples + cache read 0", () => {
  const classif = classifyMonthlyCacheHealth({
    modelId: "gemini-3.7-flash",
    inActiveRegistry: true,
    sampleCount: 40,
    cacheCapabilityAdvertised: true,
    cacheReadTokenTotal: 0,
    cacheHitOrReadRatio: 0,
    dominantCacheReportingState: "zero",
    multiAttemptRatio: 0.05,
    prefixFingerprintChanged: null,
    anthropicExplicitExpected: false,
  });
  assert.equal(classif, "PREFIX_INSTABILITY");

  const anthropic = classifyMonthlyCacheHealth({
    modelId: "claude-opus-5.5",
    inActiveRegistry: true,
    sampleCount: 40,
    cacheCapabilityAdvertised: true,
    cacheReadTokenTotal: 0,
    cacheHitOrReadRatio: 0,
    dominantCacheReportingState: "zero",
    multiAttemptRatio: 0.05,
    prefixFingerprintChanged: null,
    anthropicExplicitExpected: true,
  });
  assert.equal(anthropic, "CACHE_CONFIG_MISSING");
});

test("6 prefix fingerprint changed → PREFIX_INSTABILITY", () => {
  const classif = classifyMonthlyCacheHealth({
    modelId: "gemini-3.1-pro-preview",
    inActiveRegistry: true,
    sampleCount: 30,
    cacheCapabilityAdvertised: true,
    cacheReadTokenTotal: 0,
    cacheHitOrReadRatio: 0,
    dominantCacheReportingState: "zero",
    multiAttemptRatio: 0.01,
    prefixFingerprintChanged: true,
    anthropicExplicitExpected: false,
  });
  assert.equal(classif, "PREFIX_INSTABILITY");
});

test("7 multi-attempt increase → ROUTING_INSTABILITY", () => {
  const classif = classifyMonthlyCacheHealth({
    modelId: "gpt-5.6-terra",
    inActiveRegistry: true,
    sampleCount: 50,
    cacheCapabilityAdvertised: true,
    cacheReadTokenTotal: 10,
    cacheHitOrReadRatio: 0.01,
    dominantCacheReportingState: "hit",
    multiAttemptRatio: 0.4,
    prefixFingerprintChanged: false,
    anthropicExplicitExpected: false,
  });
  assert.equal(classif, "ROUTING_INSTABILITY");
});

test("8 cache reporting unknown → REPORTING_GAP", () => {
  const classif = classifyMonthlyCacheHealth({
    modelId: "gemini-3.7-flash",
    inActiveRegistry: true,
    sampleCount: 30,
    cacheCapabilityAdvertised: true,
    cacheReadTokenTotal: 0,
    cacheHitOrReadRatio: 0,
    dominantCacheReportingState: "unknown",
    multiAttemptRatio: 0.02,
    prefixFingerprintChanged: null,
    anthropicExplicitExpected: false,
  });
  assert.equal(classif, "REPORTING_GAP");
});

test("9 zero sample → NOT_MEASURED (never 0% ratio)", () => {
  assert.equal(computeCacheHitOrReadRatio(0, 0, 0), "NOT_MEASURED");
  const classif = classifyMonthlyCacheHealth({
    modelId: "gpt-5.6-terra",
    inActiveRegistry: true,
    sampleCount: 0,
    cacheCapabilityAdvertised: true,
    cacheReadTokenTotal: 0,
    cacheHitOrReadRatio: "NOT_MEASURED",
    dominantCacheReportingState: null,
    multiAttemptRatio: "NOT_MEASURED",
    prefixFingerprintChanged: null,
    anthropicExplicitExpected: false,
  });
  assert.equal(classif, "NOT_MEASURED");
});

test("10 pagination multi-page", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          data: [usageRow({ request_id: "p1" })],
          next_cursor: "cursor-2",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        data: [usageRow({ request_id: "p2" })],
        next_cursor: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const result = await fetchUsageRequestsPages({
    apiKey: "usage-only-key",
    startAt: WINDOW.startAt,
    endAt: WINDOW.endAt,
    fetchImpl,
  });
  assert.equal(result.pagesScanned, 2);
  assert.equal(result.paginationComplete, true);
  assert.equal(result.rows.length, 2);
  assert.equal(calls, 2);
});

test("11 pricing/catalog version change preserved on evidence", () => {
  const a = catalog({ id: "gemini-3.7-flash", pricingVersion: "pv-1" });
  const b = catalog({ id: "gemini-3.7-flash", pricingVersion: "pv-2" });
  assert.equal(a.pricing_version, "pv-1");
  assert.equal(b.pricing_version, "pv-2");
  assert.notEqual(a.pricing_version, b.pricing_version);
  assert.equal(a.pricing_checked_at, "2026-09-01T00:00:00Z");
  assert.equal(a.cacheCapabilityAdvertised, true);

  const missing = parseCatalogPricingEvidence(
    { id: "x", pricing: { input_per_million: "1", output_per_million: "2" } },
    {}
  );
  assert.equal(missing.cacheCapabilityAdvertised, false);
  assert.equal(
    classifyMonthlyCacheHealth({
      modelId: "x",
      inActiveRegistry: true,
      sampleCount: 30,
      cacheCapabilityAdvertised: false,
      cacheReadTokenTotal: 0,
      cacheHitOrReadRatio: 0,
      dominantCacheReportingState: "zero",
      multiAttemptRatio: 0,
      prefixFingerprintChanged: null,
      anthropicExplicitExpected: false,
    }),
    "CACHE_CAPABILITY_MISSING"
  );
});

test("12 missing/invalid reporting credential → NOT_RUN without inference fallback", () => {
  const env = {
    CHEAPER_INFERENCE_API_KEY: "prod-inference-must-never-be-used",
  } as NodeJS.ProcessEnv;
  const missing = resolveUsageReportingCheaperInferenceApiKey(env);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.status, "NOT_RUN");
    assert.equal(missing.providerGenerationCalls, 0);
  }

  const report = buildNotRunMonthlyCacheAuditReport({
    window: WINDOW,
    reason: "missing_usage_reporting_credential",
  });
  assert.equal(report.runStatus, "NOT_RUN");
  assert.equal(report.providerGenerationCalls, 0);
  assert.equal(report.notRunReason?.includes("missing_usage_reporting_credential"), true);

  env[USAGE_REPORTING_CHEAPER_INFERENCE_ENV] = "usage-key";
  const usage = resolveUsageReportingCheaperInferenceApiKey(env);
  assert.equal(usage.ok, true);
  if (usage.ok) {
    assert.equal(usage.source, USAGE_REPORTING_CHEAPER_INFERENCE_ENV);
    assert.equal(usage.apiKey, "usage-key");
  }

  delete env[USAGE_REPORTING_CHEAPER_INFERENCE_ENV];
  env[BENCHMARK_CHEAPER_INFERENCE_ENV] = "bench-key";
  const bench = resolveUsageReportingCheaperInferenceApiKey(env);
  assert.equal(bench.ok, true);
  if (bench.ok) {
    assert.equal(bench.source, BENCHMARK_CHEAPER_INFERENCE_ENV);
  }
});

test("13 provider generation calls = 0", () => {
  const report = buildMonthlyCacheAuditReport({
    window: WINDOW,
    usageRows: [usageRow({ cache_read_input_tokens: 100 })],
    catalogByModel: Object.fromEntries(
      MAIN_RP_MODEL_IDS.map((id) => [id, catalog({ id })])
    ),
    pagesScanned: 1,
    paginationComplete: true,
  });
  assert.equal(report.providerGenerationCalls, 0);
  assert.equal(report.openRouterResponseCachingUsedForMainRp, false);
});

test("14 secret leakage = 0", () => {
  const sanitized = sanitizeUsageReportingCredentialText(
    "CHEAPER_INFERENCE_USAGE_API_KEY=secret-usage CHEAPER_INFERENCE_BENCHMARK_API_KEY=secret-bench CHEAPER_INFERENCE_API_KEY=secret-prod"
  );
  assert.equal(countSecretLeakageMarkers(sanitized), 0);
  assert.doesNotMatch(sanitized, /secret-/);
  assert.match(sanitized, /CHEAPER_INFERENCE_USAGE_API_KEY=\[REDACTED\]/);

  const report = buildMonthlyCacheAuditReport({
    window: WINDOW,
    usageRows: [],
    catalogByModel: Object.fromEntries(
      MAIN_RP_MODEL_IDS.map((id) => [id, catalog({ id })])
    ),
    pagesScanned: 0,
    paginationComplete: true,
    credentialSource: USAGE_REPORTING_CHEAPER_INFERENCE_ENV,
  });
  const text = JSON.stringify(report);
  assert.equal(countSecretLeakageMarkers(text), 0);
  assert.doesNotMatch(text, /Bearer\s+/i);
});

test("cache mechanisms differ for Anthropic vs implicit models", () => {
  const opus = resolveCacheMechanism("claude-opus-5.5");
  const flash = resolveCacheMechanism("deepseek-v4.1-flash");
  assert.equal(opus.kind, "anthropic_explicit_cache_control");
  assert.equal(opus.appExplicitCacheControl, true);
  assert.equal(flash.kind, "provider_implicit_kv_cache");
  assert.equal(flash.appExplicitCacheControl, false);
  assert.equal(opus.openRouterResponseCachingUsed, false);
  assert.equal(flash.openRouterResponseCachingUsed, false);
});

test("alert fingerprint dedup is stable for same issue across identical inputs", () => {
  const a = buildAlertFingerprint({
    yearMonth: "2026-08",
    modelId: "gemini-3.7-flash",
    classification: "PREFIX_INSTABILITY",
    cacheCapabilityAdvertised: true,
    mechanism: "provider_implicit_kv_cache",
  });
  const b = buildAlertFingerprint({
    yearMonth: "2026-08",
    modelId: "gemini-3.7-flash",
    classification: "PREFIX_INSTABILITY",
    cacheCapabilityAdvertised: true,
    mechanism: "provider_implicit_kv_cache",
  });
  assert.equal(a, b);
  const persistent = buildPersistentIssueFingerprint({
    modelId: "gemini-3.7-flash",
    classification: "PREFIX_INSTABILITY",
    cacheCapabilityAdvertised: true,
    mechanism: "provider_implicit_kv_cache",
  });
  assert.equal(persistent.length, 16);
  assert.notEqual(
    persistent,
    buildPersistentIssueFingerprint({
      modelId: "gemini-3.7-flash",
      classification: "HEALTHY",
      cacheCapabilityAdvertised: true,
      mechanism: "provider_implicit_kv_cache",
    })
  );
});

test("latency fields preserve source names and are not labeled TTFT", () => {
  const agg = aggregateModelUsage({
    modelId: "gemini-3.1-pro-preview",
    rows: [
      {
        request_id: "1",
        created_at: "2026-08-01 00:00:00",
        model: "gemini-3.1-pro-preview",
        endpoint: "/v1/chat/completions",
        status: "settled",
        prompt_tokens: 100,
        completion_tokens: 10,
        cache_read_input_tokens: 50,
        cache_write_input_tokens: 0,
        standard_input_tokens: 50,
        billed_cost_usd: "0.1",
        provider_attempt_count: 1,
        cache_reporting_state: "hit",
        routing_overhead_ms: 100,
        time_to_response_headers_ms: 200,
      },
    ],
    catalog: catalog({ id: "gemini-3.1-pro-preview" }),
    window: WINDOW,
    activeRegistryIds: MAIN_RP_MODEL_IDS,
  });
  assert.equal(agg.latency.routing_overhead_ms.median, 100);
  assert.equal(agg.latency.time_to_response_headers_ms.median, 200);
  assert.match(agg.latency.time_to_response_headers_ms.meaning, /not_ttft/);
  assert.doesNotMatch(JSON.stringify(agg.latency), /\bTTFT\b/);
});

test("previous calendar month window is UTC exclusive end", () => {
  const w = previousCalendarMonthWindow(new Date(Date.UTC(2026, 8, 28, 12, 0, 0)));
  assert.equal(w.yearMonth, "2026-08");
  assert.equal(w.startAt, "2026-08-01 00:00:00");
  assert.equal(w.endAt, "2026-09-01 00:00:00");
});

test("owners map + no manual MODELS in monthly auditor or legacy wrapper", () => {
  assert.equal(
    MAIN_RP_MONTHLY_CACHE_AUDIT_OWNERS.activeModelRegistry,
    "src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS"
  );
  assert.deepEqual(
    resolveMainRpMonthlyCacheAuditModels(),
    MAIN_RP_USER_SELECTABLE_OPTIONS.map((o) => o.id)
  );

  const monthlySrc = readFileSync(
    resolve(process.cwd(), "scripts/lib/mainRpMonthlyCacheAudit.ts"),
    "utf8"
  );
  assert.doesNotMatch(monthlySrc, /const MODELS\s*=\s*\[/);
  assert.doesNotMatch(monthlySrc, /deepseek-v4-pro-0813/);

  const legacySrc = readFileSync(
    resolve(process.cwd(), "scripts/main-rp-cache-health-readonly.ts"),
    "utf8"
  );
  assert.doesNotMatch(legacySrc, /const MODELS\s*=\s*\[/);
  assert.doesNotMatch(legacySrc, /main-rp-cache-health-2026-09-19/);
  assert.match(legacySrc, /main-rp-monthly-cache-audit/);

  const cliSrc = readFileSync(
    resolve(process.cwd(), "scripts/main-rp-monthly-cache-audit.ts"),
    "utf8"
  );
  assert.doesNotMatch(cliSrc, /resolveCheaperInferenceApiKey/);
  assert.match(cliSrc, /resolveUsageReportingCheaperInferenceApiKey/);
  assert.match(cliSrc, /CHEAPER_INFERENCE_USAGE_API_KEY/);
  assert.match(cliSrc, /no inference fallback/);
});

test("AUDITOR_DRIFT when model not in active registry", () => {
  assert.equal(
    classifyMonthlyCacheHealth({
      modelId: "deepseek-v4-pro-0813",
      inActiveRegistry: false,
      sampleCount: 100,
      cacheCapabilityAdvertised: true,
      cacheReadTokenTotal: 50,
      cacheHitOrReadRatio: 0.5,
      dominantCacheReportingState: "hit",
      multiAttemptRatio: 0.1,
      prefixFingerprintChanged: false,
      anthropicExplicitExpected: false,
    }),
    "AUDITOR_DRIFT"
  );
});


test("monthly comparison computes actual prior-month ratio and delta", () => {
  const priorWindow = priorCalendarMonthWindow(WINDOW);
  assert.equal(priorWindow.yearMonth, "2026-07");
  assert.equal(priorWindow.startAt, "2026-07-01 00:00:00");
  assert.equal(priorWindow.endAt, "2026-08-01 00:00:00");

  const priorRows = Array.from({ length: 4 }, (_, i) =>
    usageRow({
      request_id: `prior-${i}`,
      created_at: "2026-07-15 12:00:00",
      model: "deepseek-v4.1-flash",
      prompt_tokens: 1000,
      cache_read_input_tokens: 250,
    })
  );
  const priorRatios = buildPriorMonthCacheReadRatios(priorRows, MAIN_RP_MODEL_IDS);
  assert.equal(priorRatios["deepseek-v4.1-flash"], 0.25);
  assert.equal(priorRatios["gemini-3.1-pro-preview"], "NOT_MEASURED");

  const report = buildMonthlyCacheAuditReport({
    window: WINDOW,
    activeModelIds: MAIN_RP_MODEL_IDS,
    usageRows: Array.from({ length: 4 }, (_, i) =>
      usageRow({
        request_id: `current-${i}`,
        model: "deepseek-v4.1-flash",
        prompt_tokens: 1000,
        cache_read_input_tokens: 500,
      })
    ),
    catalogByModel: Object.fromEntries(
      MAIN_RP_MODEL_IDS.map((id) => [id, catalog({ id })])
    ),
    pagesScanned: 1,
    paginationComplete: true,
    priorMonthRatios: priorRatios,
  });
  assert.equal(report.models["deepseek-v4.1-flash"]!.priorMonthCacheHitOrReadRatio, 0.25);
  assert.equal(report.models["deepseek-v4.1-flash"]!.cacheHitOrReadRatio, 0.5);
  assert.equal(report.models["deepseek-v4.1-flash"]!.cacheHitOrReadRatioDelta, 0.25);
});
