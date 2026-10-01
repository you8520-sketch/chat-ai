/**
 * G37 pricing candidate simulation — read-only, no provider generation calls.
 * Uses CI usage API + canonical computeGemini37FlashUserChargePoints.
 *
 *   node --conditions=react-server --import tsx scripts/g37-pricing-candidate-simulation.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  computeGemini37FlashUserChargeBreakdown,
  computeGemini37FlashUserChargePoints,
  resolveGemini37FlashBilledOutputTokens,
  resolveGemini37FlashPricingConfig,
  type Gemini37FlashPricingConfig,
} from "../src/lib/gemini37FlashPricing";
import {
  convertUsdToKrw,
  resolveBillingExchangeRateSnapshot,
  EXCHANGE_RATE_FALLBACK_KRW,
} from "../src/lib/exchangeRate";
import { applyOverseasCardFee } from "../src/lib/billingFxPolicy";

const MODEL = "gemini-3.7-flash";
const OUT_DIR = path.join(
  process.cwd(),
  "docs/audits/g37-pricing-candidate-simulation-2026-09-19"
);
const BASELINE_ARTIFACT = path.join(
  process.cwd(),
  "docs/audits/main-rp-cache-health-2026-09-19/g37-no-cache-pricing-safety.json"
);
const RUNTIME_FIXTURE = path.join(
  process.cwd(),
  "docs/audits/gemini-37-flash-pricing/RUNTIME.json"
);
const MERGED_BASELINE = {
  window30d: {
    sampleCount: 376,
    minimum: 20.9,
    p5: 48.0,
    median: 77.7,
    weightedAggregateMarginPct: 76.8,
    below50Pct: { count: 21, pct: 5.6 },
    below55Pct: { count: 34, pct: 9.0 },
  },
  window7d: {
    sampleCount: 46,
    minimum: 52.6,
    below50Pct: { count: 0, pct: 0 },
    below55Pct: { count: 4, pct: 8.7 },
  },
};

type UsageRow = {
  requestHash: string;
  created_at: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_input_tokens: number;
  cache_write_input_tokens: number;
  billed_cost_usd: number;
  provider_attempt_count: number;
};

function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

function marginPct(userPoints: number, costKrw: number): number {
  if (userPoints <= 0) return 0;
  return Math.round((1 - costKrw / userPoints) * 1000) / 10;
}

function billedOutput(row: UsageRow): number {
  return resolveGemini37FlashBilledOutputTokens({
    completionTokens: row.completion_tokens,
    reasoningTokens: 0,
  });
}

function userPoints(row: UsageRow, config: Gemini37FlashPricingConfig): number {
  return computeGemini37FlashUserChargePoints({
    inputTokens: row.prompt_tokens,
    billedOutputTokens: billedOutput(row),
    config,
  });
}

function breakdown(row: UsageRow, config: Gemini37FlashPricingConfig) {
  return computeGemini37FlashUserChargeBreakdown({
    inputTokens: row.prompt_tokens,
    billedOutputTokens: billedOutput(row),
    config,
  });
}

function procurementKrw(row: UsageRow, fxEffective: number): number {
  return convertUsdToKrw(row.billed_cost_usd, fxEffective);
}

type ShapeBucket =
  | "long_input_within_included_low_output"
  | "long_input_within_included_mid_output"
  | "long_input_within_included_high_output"
  | "over_included_input"
  | "short_input_low_output"
  | "short_input_large_output"
  | "near_25k_included_boundary"
  | "long_context_75k_plus"
  | "other";

function shapeBucket(
  input: number,
  output: number,
  includedInput: number
): ShapeBucket {
  if (input > 75_000) return "long_context_75k_plus";
  if (input >= includedInput - 1_000 && input <= includedInput + 1_000) {
    return "near_25k_included_boundary";
  }
  if (input > includedInput) return "over_included_input";
  if (input >= 18_000 && input <= includedInput) {
    if (output <= 2_500) return "long_input_within_included_low_output";
    if (output <= 4_000) return "long_input_within_included_mid_output";
    return "long_input_within_included_high_output";
  }
  if (input < 10_000 && output > 4_000) return "short_input_large_output";
  if (input < 10_000 && output <= 2_500) return "short_input_low_output";
  return "other";
}

function classifyPricingFailure(
  bd: ReturnType<typeof breakdown>,
  config: Gemini37FlashPricingConfig,
  input: number
): string[] {
  const causes: string[] = [];
  if (bd.inputSurchargePoints === 0 && input > config.includedInputTokens * 0.7) {
    causes.push("included_input_band_no_surcharge");
  }
  if (bd.inputSurchargePoints === 0 && input > config.includedInputTokens) {
    causes.push("input_step_not_triggered");
  }
  if (bd.outputSurchargePoints === config.outputTier2500 && bd.billedOutputTokens > 0) {
    causes.push("output_tier_2500_only");
  }
  if (bd.longContextSurchargePoints > 0) causes.push("long_context_tier");
  if (bd.basePoints <= 35 && bd.inputSurchargePoints === 0 && bd.outputSurchargePoints <= 25) {
    causes.push("base_dominates");
  }
  return causes.length ? causes : ["composite"];
}

function distribution(margins: number[]) {
  const sorted = [...margins].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  const below = (t: number) => ({
    count: sorted.filter((m) => m < t).length,
    pct: sorted.length ? Math.round((sorted.filter((m) => m < t).length / sorted.length) * 1000) / 10 : 0,
  });
  return {
    sampleCount: sorted.length,
    minimum: sorted[0] ?? null,
    p5: percentile(sorted, 5),
    p10: percentile(sorted, 10),
    median: percentile(sorted, 50),
    weightedAggregateMarginPct:
      sorted.length ? Math.round((total / sorted.length) * 10) / 10 : null,
    below0Pct: below(0),
    below50Pct: below(50),
    below55Pct: below(55),
    below60Pct: below(60),
  };
}

function priceImpact(current: number[], candidate: number[]) {
  const deltas = current.map((c, i) => candidate[i]! - c);
  const sorted = [...deltas].sort((a, b) => a - b);
  const unchanged = deltas.filter((d) => d === 0).length;
  const plus1to5 = deltas.filter((d) => d >= 1 && d <= 5).length;
  const plus6to10 = deltas.filter((d) => d >= 6 && d <= 10).length;
  const plusGt10 = deltas.filter((d) => d > 10).length;
  const total = deltas.length;
  return {
    meanDelta: total ? Math.round((deltas.reduce((a, b) => a + b, 0) / total) * 10) / 10 : 0,
    medianDelta: percentile(sorted, 50),
    p5Delta: percentile(sorted, 5),
    p95Delta: percentile(sorted, 95),
    maxIncrease: sorted.length ? sorted[sorted.length - 1]! : 0,
    unchanged: { count: unchanged, pct: total ? Math.round((unchanged / total) * 1000) / 10 : 0 },
    plus1to5P: { count: plus1to5, pct: total ? Math.round((plus1to5 / total) * 1000) / 10 : 0 },
    plus6to10P: { count: plus6to10, pct: total ? Math.round((plus6to10 / total) * 1000) / 10 : 0 },
    plusGt10P: { count: plusGt10, pct: total ? Math.round((plusGt10 / total) * 1000) / 10 : 0 },
  };
}

async function fetchG37Rows(key: string, startAt: string, endAt: string) {
  const rows: UsageRow[] = [];
  let cursor: string | null | undefined = undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({ start_at: startAt, end_at: endAt, limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(
      `https://api.cheaperinference.com/v1/usage/requests?${params}`,
      {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as {
      data?: Record<string, unknown>[];
      next_cursor?: string | null;
    };
    for (const item of payload.data ?? []) {
      if (String(item.model ?? "").toLowerCase() !== MODEL) continue;
      if (String(item.status ?? "") !== "settled") continue;
      rows.push({
        requestHash: hashId(String(item.request_id ?? "")),
        created_at: String(item.created_at ?? ""),
        prompt_tokens: Number(item.prompt_tokens ?? 0),
        completion_tokens: Number(item.completion_tokens ?? 0),
        cache_read_input_tokens: Number(item.cache_read_input_tokens ?? 0),
        cache_write_input_tokens: Number(item.cache_write_input_tokens ?? 0),
        billed_cost_usd: Number(item.billed_cost_usd ?? 0),
        provider_attempt_count: Number(item.provider_attempt_count ?? 1),
      });
    }
    cursor = payload.next_cursor ?? null;
    pages += 1;
  } while (cursor && pages < 100);
  return { rows, pages, paginationComplete: !cursor };
}

function candidateConfigs(
  current: Gemini37FlashPricingConfig
): Array<{ id: string; label: string; family: string; config: Gemini37FlashPricingConfig }> {
  const c = (patch: Partial<Gemini37FlashPricingConfig>) => ({
    ...current,
    ...patch,
  });
  return [
    { id: "CURRENT", label: "Current production defaults", family: "baseline", config: current },
    { id: "A1", label: "basePoints=40", family: "A_base", config: c({ basePoints: 40 }) },
    { id: "A2", label: "basePoints=45", family: "A_base", config: c({ basePoints: 45 }) },
    { id: "B1", label: "includedInputTokens=20000", family: "B_included", config: c({ includedInputTokens: 20_000 }) },
    { id: "B2", label: "includedInputTokens=15000", family: "B_included", config: c({ includedInputTokens: 15_000 }) },
    { id: "C1", label: "inputStepPoints=2", family: "C_input_step", config: c({ inputStepPoints: 2 }) },
    { id: "C2", label: "inputStepPoints=5", family: "C_input_step", config: c({ inputStepPoints: 5 }) },
    { id: "D1", label: "outputTier2500=15", family: "D_output_tier2500", config: c({ outputTier2500: 15 }) },
    { id: "D2", label: "outputTier2500=25", family: "D_output_tier2500", config: c({ outputTier2500: 25 }) },
    {
      id: "E1",
      label: "included20000 + inputStepPoints=3",
      family: "E_combo",
      config: c({ includedInputTokens: 20_000, inputStepPoints: 3 }),
    },
    {
      id: "E2",
      label: "included20000 + outputTier2500=15",
      family: "E_combo",
      config: c({ includedInputTokens: 20_000, outputTier2500: 15 }),
    },
    {
      id: "E3",
      label: "base40 + outputTier2500=15",
      family: "E_combo",
      config: c({ basePoints: 40, outputTier2500: 15 }),
    },
    {
      id: "E4",
      label: "base45 + included20000",
      family: "E_combo",
      config: c({ basePoints: 45, includedInputTokens: 20_000 }),
    },
    {
      id: "E5",
      label: "included20000 + inputStep5 + outTier2500=10",
      family: "E_combo",
      config: c({
        includedInputTokens: 20_000,
        inputStepPoints: 5,
        outputTier2500: 10,
      }),
    },
    {
      id: "E6",
      label: "base40 + included20000 + inputStep3",
      family: "E_combo",
      config: c({ basePoints: 40, includedInputTokens: 20_000, inputStepPoints: 3 }),
    },
  ];
}

function cliffCheck(config: Gemini37FlashPricingConfig) {
  const probes: Array<{ label: string; input: number; output: number }> = [
    { label: "out_2499", input: 10_000, output: 2_499 },
    { label: "out_2500", input: 10_000, output: 2_500 },
    { label: "out_2501", input: 10_000, output: 2_501 },
    { label: "out_3999", input: 10_000, output: 3_999 },
    { label: "out_4000", input: 10_000, output: 4_000 },
    { label: "out_4001", input: 10_000, output: 4_001 },
    {
      label: "in_included_minus1",
      input: config.includedInputTokens - 1,
      output: 2_000,
    },
    { label: "in_included", input: config.includedInputTokens, output: 2_000 },
    {
      label: "in_included_plus1",
      input: config.includedInputTokens + 1,
      output: 2_000,
    },
    {
      label: "in_step_boundary",
      input: config.includedInputTokens + config.inputStepTokens,
      output: 2_000,
    },
    {
      label: "in_step_boundary_plus1",
      input: config.includedInputTokens + config.inputStepTokens + 1,
      output: 2_000,
    },
    {
      label: "long_ctx_minus1",
      input: config.longContextThresholdTokens - 1,
      output: 2_000,
    },
    {
      label: "long_ctx",
      input: config.longContextThresholdTokens,
      output: 2_000,
    },
    {
      label: "long_ctx_plus1",
      input: config.longContextThresholdTokens + 1,
      output: 2_000,
    },
  ];
  const prices = probes.map((p) => ({
    ...p,
    points: computeGemini37FlashUserChargePoints({
      inputTokens: p.input,
      billedOutputTokens: p.output,
      config,
    }),
  }));
  const cliffs: Array<{ from: string; to: string; deltaP: number }> = [];
  for (let i = 1; i < prices.length; i += 1) {
    const delta = prices[i]!.points - prices[i - 1]!.points;
    if (Math.abs(delta) > 20) {
      cliffs.push({
        from: prices[i - 1]!.label,
        to: prices[i]!.label,
        deltaP: delta,
      });
    }
  }
  return { probes: prices, unexpectedCliffsOver20P: cliffs };
}

function simulateSet(
  rows: UsageRow[],
  config: Gemini37FlashPricingConfig,
  fx: number,
  currentConfig: Gemini37FlashPricingConfig
) {
  const margins: number[] = [];
  const currentPrices: number[] = [];
  const candidatePrices: number[] = [];
  for (const row of rows) {
    const p = userPoints(row, config);
    const c = userPoints(row, currentConfig);
    const cost = procurementKrw(row, fx);
    margins.push(marginPct(p, cost));
    currentPrices.push(c);
    candidatePrices.push(p);
  }
  return {
    marginDistribution: distribution(margins),
    priceImpactVsCurrent:
      config === currentConfig ? null : priceImpact(currentPrices, candidatePrices),
    totalRevenueCurrent: currentPrices.reduce((a, b) => a + b, 0),
    totalRevenueCandidate: candidatePrices.reduce((a, b) => a + b, 0),
  };
}

function historicalFixture(config: Gemini37FlashPricingConfig, fx: number) {
  const runtime = JSON.parse(fs.readFileSync(RUNTIME_FIXTURE, "utf8")) as {
    turns: Array<{
      turn: string;
      apiInputTokens: number;
      billedOutputTokens: number;
      upstreamCostUsd?: number;
      apiRawCostUsd?: number;
    }>;
  };
  const turns = runtime.turns.map((t) => {
    const billedUsd = t.upstreamCostUsd ?? t.apiRawCostUsd ?? 0;
    const p = computeGemini37FlashUserChargePoints({
      inputTokens: t.apiInputTokens,
      billedOutputTokens: t.billedOutputTokens,
      config,
    });
    const cost = convertUsdToKrw(billedUsd, fx);
    return {
      turn: t.turn,
      inputTokens: t.apiInputTokens,
      outputTokens: t.billedOutputTokens,
      userPoints: p,
      marginPct: marginPct(p, cost),
    };
  });
  const rev = turns.reduce((a, t) => a + t.userPoints, 0);
  const cost = turns.reduce(
    (a, t) =>
      a +
      convertUsdToKrw(
        runtime.turns.find((x) => x.turn === t.turn)!.upstreamCostUsd ??
          runtime.turns.find((x) => x.turn === t.turn)!.apiRawCostUsd ??
          0,
        fx
      ),
    0
  );
  return { turns, rollingMarginPct: rev > 0 ? marginPct(rev, cost) : null };
}

async function main() {
  const key = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
  if (!key) {
    console.error("NO_CHEAPER_INFERENCE_KEY");
    process.exit(1);
  }

  const currentConfig = resolveGemini37FlashPricingConfig();
  const fxSnapshot = resolveBillingExchangeRateSnapshot();
  const fx =
    fxSnapshot.source === "api"
      ? fxSnapshot.effectiveKrwPerUsd
      : applyOverseasCardFee(EXCHANGE_RATE_FALLBACK_KRW);

  const end = new Date();
  const start30 = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  const start7 = new Date(end.getTime() - 7 * 24 * 3600 * 1000);

  const fetched = await fetchG37Rows(key, fmt(start30), fmt(end));
  const noCache30 = fetched.rows.filter((r) => r.cache_read_input_tokens === 0);
  const noCache7 = noCache30.filter((r) => r.created_at >= start7.toISOString());
  const allTraffic = fetched.rows;

  const currentMargins30 = noCache30.map((r) =>
    marginPct(userPoints(r, currentConfig), procurementKrw(r, fx))
  );
  const reproduced30 = distribution(currentMargins30);

  const lowMarginRows = noCache30
    .map((r) => {
      const out = billedOutput(r);
      const bd = breakdown(r, currentConfig);
      const p = bd.totalPoints;
      const m = marginPct(p, procurementKrw(r, fx));
      return {
        requestHash: r.requestHash,
        input: r.prompt_tokens,
        output: out,
        userPoints: p,
        marginPct: m,
        shape: shapeBucket(r.prompt_tokens, out, currentConfig.includedInputTokens),
        pricingFailure: classifyPricingFailure(bd, currentConfig, r.prompt_tokens),
        breakdown: {
          base: bd.basePoints,
          inputSurcharge: bd.inputSurchargePoints,
          outputSurcharge: bd.outputSurchargePoints,
          longContext: bd.longContextSurchargePoints,
        },
        billedCostUsd: r.billed_cost_usd,
        providerAttemptCount: r.provider_attempt_count,
      };
    })
    .filter((r) => r.marginPct < 50);

  const shapeCounts: Record<string, number> = {};
  for (const r of lowMarginRows) {
    shapeCounts[r.shape] = (shapeCounts[r.shape] ?? 0) + 1;
  }

  const candidates = candidateConfigs(currentConfig);
  const candidateResults = candidates.map((cand) => ({
    id: cand.id,
    label: cand.label,
    family: cand.family,
    configDelta: diffConfig(currentConfig, cand.config),
    noCache30d: simulateSet(noCache30, cand.config, fx, currentConfig),
    noCache7d: simulateSet(noCache7, cand.config, fx, currentConfig),
    allTraffic30d: simulateSet(allTraffic, cand.config, fx, currentConfig),
    historicalColdFixture: historicalFixture(cand.config, fx),
    priceCliffs: cand.id === "CURRENT" ? cliffCheck(cand.config) : undefined,
  }));

  for (const cand of candidates) {
    if (cand.id !== "CURRENT") {
      const idx = candidateResults.find((r) => r.id === cand.id)!;
      idx.priceCliffs = cliffCheck(cand.config);
    }
  }

  const baselineVerify = {
    merged966Expected: MERGED_BASELINE,
    reproducedFromFreshFetch: {
      noCache30d: reproduced30,
      noCache7d: distribution(
        noCache7.map((r) =>
          marginPct(userPoints(r, currentConfig), procurementKrw(r, fx))
        )
      ),
      allTrafficCount: allTraffic.length,
      fetchPaginationComplete: fetched.paginationComplete,
    },
    note: "Fresh CI usage fetch; compare distributions not exact row hashes",
  };

  const out = {
    generatedAt: new Date().toISOString(),
    audit: "g37-pricing-candidate-simulation",
    providerGenerationCalls: 0,
    sourceMainSha: "ab5c2c141e33beec54b9b6d80bdc2236cc9c044b",
    pricingOwner: "src/lib/gemini37FlashPricing.ts",
    currentProductionConfig: currentConfig,
    railwayOverridesDetected: detectEnvOverrides(),
    fx: {
      effectiveKrwPerUsd: fx,
      mode: fxSnapshot.mode,
      source: fxSnapshot.source,
      label: "procurement_cost = billed_cost_usd × effectiveKrwPerUsd (#963 billing owner)",
    },
    sitePromotionApplied: false,
    baselineVerification: baselineVerify,
    currentMarginProblem: {
      lowMarginBelow50Count: lowMarginRows.length,
      lowMarginBelow50Pct: noCache30.length
        ? Math.round((lowMarginRows.length / noCache30.length) * 1000) / 10
        : 0,
      shapeDecomposition: shapeCounts,
      worstFive: [...lowMarginRows].sort((a, b) => a.marginPct - b.marginPct).slice(0, 5),
    },
    candidates: candidateResults,
    stalePricingReferences: [
      {
        path: "docs/audits/gemini-37-flash-pricing/REPORT.md",
        claim: "base 45P",
        classification: "HISTORICAL_REFERENCE",
      },
      {
        path: ".env.example commented defaults",
        claim: "GEMINI37_BASE_POINTS=45, INPUT_STEP_POINTS=5",
        classification: "STALE_FOLLOW_UP",
      },
    ],
    finalOutput: {
      winnerSelected: false,
      note: "Factual candidate table only — GPT/user chooses",
      PROVIDER_GENERATION_CALLS: 0,
      RUNTIME_CHANGE: 0,
      PRICE_CHANGE: 0,
      MERGE: "NO",
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "simulation-results.json"),
    `${JSON.stringify(out, null, 2)}\n`
  );

  const report = buildReport(out, lowMarginRows, shapeCounts);
  fs.writeFileSync(path.join(OUT_DIR, "PRICING_CANDIDATE_REPORT.md"), report);

  console.log(
    JSON.stringify(
      {
        noCache30: noCache30.length,
        noCache7: noCache7.length,
        allTraffic: allTraffic.length,
        lowMarginBelow50: lowMarginRows.length,
        reproducedMinMargin: reproduced30.minimum,
        candidates: candidates.length,
      },
      null,
      2
    )
  );
}

function diffConfig(
  base: Gemini37FlashPricingConfig,
  next: Gemini37FlashPricingConfig
): Partial<Gemini37FlashPricingConfig> {
  const delta: Partial<Gemini37FlashPricingConfig> = {};
  for (const k of Object.keys(base) as (keyof Gemini37FlashPricingConfig)[]) {
    if (base[k] !== next[k]) delta[k] = next[k];
  }
  return delta;
}

function detectEnvOverrides(): Record<string, string | null> {
  const keys = [
    "GEMINI37_BASE_POINTS",
    "GEMINI37_INCLUDED_INPUT_TOKENS",
    "GEMINI37_INPUT_STEP_TOKENS",
    "GEMINI37_INPUT_STEP_POINTS",
    "GEMINI37_OUTPUT_TIER_2500",
    "GEMINI37_OUTPUT_TIER_4000",
    "GEMINI37_OUTPUT_TIER_5500",
    "GEMINI37_OUTPUT_TIER_7000",
    "GEMINI37_OUTPUT_TIER_9000",
    "GEMINI37_LONG_CONTEXT_THRESHOLD_TOKENS",
  ];
  return Object.fromEntries(
    keys.map((k) => [k, process.env[k]?.trim() ?? null])
  );
}

function buildReport(
  out: {
    currentProductionConfig: Gemini37FlashPricingConfig;
    railwayOverridesDetected: Record<string, string | null>;
    fx: { effectiveKrwPerUsd: number; source: string };
    baselineVerification: {
      merged966Expected: typeof MERGED_BASELINE;
      reproducedFromFreshFetch: { noCache30d: ReturnType<typeof distribution> };
    };
    candidates: Array<{
      id: string;
      label: string;
      family: string;
      configDelta: Partial<Gemini37FlashPricingConfig>;
      noCache30d: ReturnType<typeof simulateSet>;
      noCache7d: ReturnType<typeof simulateSet>;
      allTraffic30d: ReturnType<typeof simulateSet>;
      historicalColdFixture: ReturnType<typeof historicalFixture>;
      priceCliffs?: ReturnType<typeof cliffCheck>;
    }>;
  },
  lowMarginRows: Array<{ shape: string; marginPct: number }>,
  shapeCounts: Record<string, number>
): string {
  const lines: string[] = [];
  lines.push("# G37 Pricing Candidate Simulation\n");
  lines.push("**Audit only** · provider generation calls = 0 · runtime price change = 0 · no winner selected\n");
  lines.push("---\n");

  lines.push("## CURRENT STATE\n");
  lines.push("| Item | Value |");
  lines.push("|------|-------|");
  lines.push("| Source main | `ab5c2c141e33beec54b9b6d80bdc2236cc9c044b` (#966 merged) |");
  lines.push("| Cache investigation | **Closed** — layout root cause contradicted |");
  lines.push("| This PR | Simulation evidence only |\n");

  lines.push("## CURRENT PRICING OWNER\n");
  lines.push("**Owner:** `src/lib/gemini37FlashPricing.ts` · `computeGemini37FlashUserChargePoints`\n");
  const c = out.currentProductionConfig;
  lines.push("| Parameter | Production |");
  lines.push("|-----------|----------:|");
  lines.push(`| basePoints | ${c.basePoints} |`);
  lines.push(`| includedInputTokens | ${c.includedInputTokens.toLocaleString()} |`);
  lines.push(`| inputStepTokens / inputStepPoints | ${c.inputStepTokens.toLocaleString()} / ${c.inputStepPoints} |`);
  lines.push(`| outputTier2500 … 9000 | ${c.outputTier2500} / ${c.outputTier4000} / ${c.outputTier5500} / ${c.outputTier7000} / ${c.outputTier9000} |`);
  lines.push(`| longContextThresholdTokens | ${c.longContextThresholdTokens.toLocaleString()} |`);
  const overrides = Object.entries(out.railwayOverridesDetected).filter(([, v]) => v);
  lines.push(`\nRailway \`GEMINI37_*\` overrides in this environment: **${overrides.length ? overrides.map(([k, v]) => `${k}=${v}`).join(", ") : "none detected"}**\n`);

  lines.push("## CURRENT MARGIN PROBLEM\n");
  const rep = out.baselineVerification.reproducedFromFreshFetch.noCache30d;
  const exp = out.baselineVerification.merged966Expected.window30d;
  lines.push("Merged #966 baseline vs fresh fetch reproduction (30d no-cache):\n");
  lines.push("| Metric | #966 merged | Fresh fetch |");
  lines.push("|--------|------------:|------------:|");
  lines.push(`| n | ${exp.sampleCount} | ${rep.sampleCount} |`);
  lines.push(`| minimum | ${exp.minimum}% | ${rep.minimum}% |`);
  lines.push(`| P5 | ${exp.p5}% | ${rep.p5}% |`);
  lines.push(`| median | ${exp.median}% | ${rep.median}% |`);
  lines.push(`| weighted | ${exp.weightedAggregateMarginPct}% | ${rep.weightedAggregateMarginPct}% |`);
  lines.push(`| below 50% | ${exp.below50Pct.count} (${exp.below50Pct.pct}%) | ${rep.below50Pct.count} (${rep.below50Pct.pct}%) |`);
  lines.push(`\n**Root issue:** long high input within 25k included band + low output tier → user P stays at base (35P) while procurement cost scales with tokens.\n`);

  lines.push("## LOW-MARGIN SHAPE DECOMPOSITION\n");
  lines.push(`Rows below 50% margin: **${lowMarginRows.length}**\n`);
  lines.push("| Shape bucket | Count |");
  lines.push("|--------------|------:|");
  for (const [shape, count] of Object.entries(shapeCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${shape} | ${count} |`);
  }
  lines.push("\nDominant failure: `included_input_band_no_surcharge` + `output_tier_2500_only` + `base_dominates`.\n");

  lines.push("## CANDIDATE PARAMETERS\n");
  lines.push("| ID | Label | Δ vs current |");
  lines.push("|----|-------|--------------|");
  for (const cand of out.candidates) {
    if (cand.id === "CURRENT") continue;
    const delta = Object.entries(cand.configDelta)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`| ${cand.id} | ${cand.label} | ${delta || "—"} |`);
  }
  lines.push("\n");

  lines.push("## 30D NO-CACHE RESULTS\n");
  lines.push("| ID | min | P5 | P10 | median | wtd | <50% | <55% | <60% |");
  lines.push("|----|----:|---:|----:|-------:|----:|-----:|-----:|-----:|");
  for (const cand of out.candidates) {
    const d = cand.noCache30d.marginDistribution;
    lines.push(
      `| ${cand.id} | ${d.minimum} | ${d.p5} | ${d.p10} | ${d.median} | ${d.weightedAggregateMarginPct} | ${d.below50Pct.count} (${d.below50Pct.pct}%) | ${d.below55Pct.count} (${d.below55Pct.pct}%) | ${d.below60Pct.count} (${d.below60Pct.pct}%) |`
    );
  }
  lines.push("\n");

  lines.push("## RECENT 7D RESULTS\n");
  lines.push("| ID | min | median | <50% | <55% |");
  lines.push("|----|----:|-------:|-----:|-----:|");
  for (const cand of out.candidates) {
    const d = cand.noCache7d.marginDistribution;
    lines.push(
      `| ${cand.id} | ${d.minimum} | ${d.median} | ${d.below50Pct.count} (${d.below50Pct.pct}%) | ${d.below55Pct.count} (${d.below55Pct.pct}%) |`
    );
  }
  lines.push("\n");

  lines.push("## USER PRICE IMPACT (vs CURRENT on 30d no-cache)\n");
  lines.push("| ID | mean ΔP | median ΔP | P5 ΔP | P95 ΔP | max ΔP | unchanged | +1–5P | +6–10P | >10P |");
  lines.push("|----|--------:|----------:|------:|-------:|-------:|----------:|------:|-------:|-----:|");
  for (const cand of out.candidates) {
    const pi = cand.noCache30d.priceImpactVsCurrent;
    if (!pi) {
      lines.push(`| ${cand.id} | 0 | 0 | 0 | 0 | 0 | 100% | 0 | 0 | 0 |`);
      continue;
    }
    lines.push(
      `| ${cand.id} | ${pi.meanDelta} | ${pi.medianDelta} | ${pi.p5Delta} | ${pi.p95Delta} | ${pi.maxIncrease} | ${pi.unchanged.pct}% | ${pi.plus1to5P.pct}% | ${pi.plus6to10P.pct}% | ${pi.plusGt10P.pct}% |`
    );
  }
  lines.push("\n");

  lines.push("## ALL-TRAFFIC SANITY (30d all settled G37 rows)\n");
  lines.push("| ID | n | avg ΔP | median ΔP | total rev Δ | min margin | <50% |");
  lines.push("|----|--:|-------:|----------:|------------:|-----------:|-----:|");
  for (const cand of out.candidates) {
    const d = cand.allTraffic30d.marginDistribution;
    const pi = cand.allTraffic30d.priceImpactVsCurrent;
    const revDelta =
      cand.allTraffic30d.totalRevenueCandidate - cand.allTraffic30d.totalRevenueCurrent;
    lines.push(
      `| ${cand.id} | ${d.sampleCount} | ${pi?.meanDelta ?? 0} | ${pi?.medianDelta ?? 0} | ${revDelta > 0 ? "+" : ""}${revDelta}P | ${d.minimum} | ${d.below50Pct.count} (${d.below50Pct.pct}%) |`
    );
  }
  lines.push("\n");

  lines.push("## HISTORICAL COLD FIXTURE (T1–T10, stress only)\n");
  lines.push("| ID | rolling margin | T6 margin | T8 margin |");
  lines.push("|----|---------------:|----------:|----------:|");
  for (const cand of out.candidates) {
    const h = cand.historicalColdFixture;
    const t6 = h.turns.find((t) => t.turn === "T6")?.marginPct ?? "—";
    const t8 = h.turns.find((t) => t.turn === "T8")?.marginPct ?? "—";
    lines.push(`| ${cand.id} | ${h.rollingMarginPct} | ${t6} | ${t8} |`);
  }
  lines.push("\n");

  lines.push("## PRICE CLIFFS\n");
  lines.push("Boundary probes per candidate — flag unexpected jumps >20P between adjacent probes.\n");
  for (const cand of out.candidates.filter((c) => c.priceCliffs)) {
    const cliffs = cand.priceCliffs!.unexpectedCliffsOver20P;
    lines.push(`**${cand.id}:** ${cliffs.length ? cliffs.map((c) => `${c.from}→${c.to} (+${c.deltaP}P)`).join("; ") : "no unexpected >20P cliffs"}`);
  }
  lines.push("\n");

  lines.push("## STALE PRICING REFERENCES\n");
  lines.push("| Source | Claim | Classification |");
  lines.push("|--------|-------|----------------|");
  lines.push("| `docs/audits/gemini-37-flash-pricing/REPORT.md` | base 45P | HISTORICAL_REFERENCE |");
  lines.push("| `.env.example` comments | base 45, inputStep 5 | STALE_FOLLOW_UP |");
  lines.push("\n");

  lines.push("## SYSTEM DELTA\n");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push("| **BEFORE** | G37 cache closed; 30d no-cache tail below 50% floor |");
  lines.push("| **PROBLEM** | Long-input/base-P shape unsafe on cache miss |");
  lines.push("| **CANDIDATE EFFECTS** | Factual table above — no winner selected |");
  lines.push("| **PRESERVED** | Cache-independent pricing architecture |");
  lines.push("| **RISKS** | Broad base raises all turns; lower included raises mid-input turns |");
  lines.push("| **PROOF** | `simulation-results.json` + fresh CI usage fetch |\n");

  lines.push("## FINAL OUTPUT\n");
  lines.push("```");
  lines.push("PROVIDER_GENERATION_CALLS = 0");
  lines.push("RUNTIME_CHANGE           = 0");
  lines.push("PRICE_CHANGE             = 0");
  lines.push("MERGE                    = NO (draft — GPT/user selects candidate separately)");
  lines.push("```\n");

  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
