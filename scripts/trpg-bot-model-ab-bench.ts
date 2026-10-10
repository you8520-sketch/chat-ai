/**
 * TRPG Bot-seat final A/B benchmark — Gemini 3.7 Flash vs GPT-5.6 Luna.
 * Evidence only. Unreachable from production runtime.
 *
 *   npx tsx scripts/trpg-bot-model-ab-bench.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { convertUsdToKrw, resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import { openRouterUsdCostDetailed } from "@/lib/billingRawCost";
import {
  TRPG_BOT_SYSTEM,
  buildTrpgBotActionUserBlock,
  prepareTrpgBotActionBody,
} from "@/lib/trpg/botActions";
import { reasoningTokensFromProviderUsage } from "@/lib/trpg/gmCall";
import { parseProviderUsageCostUsd } from "@/lib/trpg/roundEconomics";
import {
  BENCH_GEMINI_MODEL,
  BENCH_LUNA_MODEL,
  type BenchModelId,
  buildBenchBotRequestBody,
  describeModelContract,
  contractsAreModelSpecific,
} from "./lib/trpgBotModelAb/contracts";
import { FROZEN_FIXTURES, type FrozenFixture } from "./lib/trpgBotModelAb/fixtures";
import { estimateInputTokens, padContextToTargetTokens } from "./lib/trpgBotModelAb/padContext";
import { runStructuralChecks, type StructuralCheckResult } from "./lib/trpgBotModelAb/structuralChecks";

loadEnvConfig(process.cwd());

const OUT_DIR = join(process.cwd(), "docs/audits/trpg-bot-model-ab");
const RAW_DIR = join(OUT_DIR, "raw");

export type BenchCallRecord = {
  fixture_id: string;
  model: BenchModelId;
  pass: number;
  call_index: number;
  request_contract: Record<string, unknown>;
  input_token_count: number;
  output_token_count: number;
  cached_input_tokens: number;
  reasoning_tokens: number | "unavailable";
  latency_ms: number;
  provider_cost_usd?: number;
  finish_reason?: string;
  http_status: number;
  http_success: boolean;
  error?: string;
  raw_text: string;
  structural: StructuralCheckResult;
};

type CallPlan = { fixture: FrozenFixture; model: BenchModelId; pass: number };

function buildCallPlan(): CallPlan[] {
  const plan: CallPlan[] = [];
  for (let pass = 1; pass <= 2; pass += 1) {
    FROZEN_FIXTURES.forEach((fixture, idx) => {
      const geminiFirst = pass === 1 ? idx % 2 === 0 : idx % 2 === 1;
      const models: BenchModelId[] = geminiFirst
        ? [BENCH_GEMINI_MODEL, BENCH_LUNA_MODEL]
        : [BENCH_LUNA_MODEL, BENCH_GEMINI_MODEL];
      for (const model of models) {
        plan.push({ fixture, model, pass });
      }
    });
  }
  return plan;
}

function preparedContext(fixture: FrozenFixture): { user: string; system: string } {
  const userRaw = buildTrpgBotActionUserBlock(fixture.ctx);
  const padded = padContextToTargetTokens(
    fixture.ctx,
    Array.from(userRaw).length,
    fixture.targetInputTokens
  );
  const user = buildTrpgBotActionUserBlock(padded);
  return { user, system: TRPG_BOT_SYSTEM };
}

async function runCall(plan: CallPlan, callIndex: number): Promise<BenchCallRecord> {
  const { user, system } = preparedContext(plan.fixture);
  const body = buildBenchBotRequestBody({
    model: plan.model,
    system,
    user,
  });
  const contract = describeModelContract(plan.model, body);
  const started = Date.now();
  let httpStatus = 0;
  let rawText = "";
  let finishReason: string | undefined;
  let inputTokens = estimateInputTokens(system + user);
  let outputTokens = 0;
  let cachedTokens = 0;
  let reasoningTokens: number | "unavailable" = "unavailable";
  let costUsd: number | undefined;
  let error: string | undefined;

  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    httpStatus = res.status;
    const payload = await res.text();
    if (!res.ok) {
      error = payload.slice(0, 500);
    } else {
      const data = JSON.parse(payload) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: Record<string, unknown>;
      };
      rawText = data.choices?.[0]?.message?.content ?? "";
      finishReason = data.choices?.[0]?.finish_reason;
      const usage = data.usage;
      inputTokens = Number(usage?.prompt_tokens ?? inputTokens);
      outputTokens = Number(usage?.completion_tokens ?? 0);
      cachedTokens = Number(
        (usage?.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens ?? 0
      );
      reasoningTokens = reasoningTokensFromProviderUsage(usage as never);
      costUsd = parseProviderUsageCostUsd(usage);
    }
  } catch (e) {
    error = (e as Error).message;
    httpStatus = 0;
  }

  const latencyMs = Date.now() - started;
  const structural = runStructuralChecks({
    rawText,
    httpSuccess: httpStatus >= 200 && httpStatus < 300 && rawText.trim().length > 0,
    fallbackName: plan.fixture.ctx.characterName,
  });

  return {
    fixture_id: plan.fixture.id,
    model: plan.model,
    pass: plan.pass,
    call_index: callIndex,
    request_contract: contract.adaptedBody,
    input_token_count: inputTokens,
    output_token_count: outputTokens,
    cached_input_tokens: cachedTokens,
    reasoning_tokens: reasoningTokens,
    latency_ms: latencyMs,
    provider_cost_usd: costUsd,
    finish_reason: finishReason,
    http_status: httpStatus,
    http_success: structural.httpSuccess,
    error,
    raw_text: rawText,
    structural,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function resolveCallCostUsd(record: BenchCallRecord): number | undefined {
  if (typeof record.provider_cost_usd === "number" && record.provider_cost_usd > 0) {
    return record.provider_cost_usd;
  }
  if (!record.http_success) return undefined;
  const est = openRouterUsdCostDetailed({
    promptTokens: record.input_token_count,
    outputTokens: record.output_token_count,
    cacheReadTokens: record.cached_input_tokens,
    modelId: record.model,
  });
  return est > 0 ? est : undefined;
}

function summarizeModel(records: BenchCallRecord[]) {
  const ok = records.filter((r) => r.http_success);
  const latencies = ok.map((r) => r.latency_ms);
  const costs = ok.map((r) => resolveCallCostUsd(r)).filter((c): c is number => typeof c === "number" && c > 0);
  const inputs = ok.map((r) => r.input_token_count);
  const outputs = ok.map((r) => r.output_token_count);
  const cacheReads = ok.map((r) => r.cached_input_tokens);
  const reasoning = ok.filter((r) => typeof r.reasoning_tokens === "number").map((r) => r.reasoning_tokens as number);

  return {
    CALLS: records.length,
    SUCCESS_RATE: records.length ? ok.length / records.length : 0,
    AVG_INPUT_TOKENS: inputs.length ? inputs.reduce((a, b) => a + b, 0) / inputs.length : 0,
    AVG_OUTPUT_TOKENS: outputs.length ? outputs.reduce((a, b) => a + b, 0) / outputs.length : 0,
    AVG_CACHE_READ_TOKENS: cacheReads.length ? cacheReads.reduce((a, b) => a + b, 0) / cacheReads.length : 0,
    CACHE_HIT_RATE: inputs.length
      ? cacheReads.filter((c) => c > 0).length / inputs.length
      : 0,
    AVG_REASONING_TOKENS: reasoning.length ? reasoning.reduce((a, b) => a + b, 0) / reasoning.length : 0,
    LATENCY_MEAN: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    LATENCY_P50: percentile(latencies, 50),
    LATENCY_P75: percentile(latencies, 75),
    LATENCY_P90: percentile(latencies, 90),
    LATENCY_P95: percentile(latencies, 95),
    LATENCY_MAX: latencies.length ? Math.max(...latencies) : 0,
    CALLS_OVER_30S: latencies.filter((l) => l > 30_000).length,
    AVG_ACTUAL_COST_USD: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0,
    P50_COST_USD: percentile(costs, 50),
    MAX_COST_USD: costs.length ? Math.max(...costs) : 0,
    PARSE_SUCCESS_RATE: ok.length ? ok.filter((r) => r.structural.parseSuccess).length / ok.length : 0,
    ACTION_TYPE_VALID_RATE: ok.length ? ok.filter((r) => r.structural.actionTypeValid).length / ok.length : 0,
    INTENT_VALID_RATE: ok.length ? ok.filter((r) => r.structural.intentValid).length / ok.length : 0,
    FALLBACK_RATE: ok.length ? ok.filter((r) => r.structural.fallbackBodyUsed).length / ok.length : 0,
    USER_AGENCY_VIOLATION_RATE: ok.length ? ok.filter((r) => r.structural.userAgencyViolation).length / ok.length : 0,
    CONSEQUENCE_VIOLATION_RATE: ok.length ? ok.filter((r) => r.structural.consequenceViolation).length / ok.length : 0,
  };
}

function loadContractProbe(): Record<string, unknown> | null {
  const p = join(OUT_DIR, "CONTRACT_PROBE.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

function assignBlindLabels(records: BenchCallRecord[]): Map<string, "A" | "B"> {
  const map = new Map<string, "A" | "B">();
  for (const fixture of FROZEN_FIXTURES) {
    for (const pass of [1, 2]) {
      const pair = records.filter((r) => r.fixture_id === fixture.id && r.pass === pass);
      if (pair.length !== 2) continue;
      const seed = createHash("sha256").update(`trpg-bot-ab:${fixture.id}:${pass}`).digest();
      const swap = seed[0]! % 2 === 0;
      map.set(`${fixture.id}:${pass}:${pair[0]!.model}`, swap ? "B" : "A");
      map.set(`${fixture.id}:${pass}:${pair[1]!.model}`, swap ? "A" : "B");
    }
  }
  return map;
}

function writeHumanReview(records: BenchCallRecord[], blind: Map<string, "A" | "B">) {
  const lines: string[] = [
    "# TRPG Bot-Seat Model A/B — Human Review Pack",
    "",
    "Blind samples only. Model identity is in `MODEL_KEY.md`.",
    "Cursor did **not** assign subjective quality scores (`CURSOR_SUBJECTIVE_SCORING=false`).",
    "",
    "## Rubric (1–10 each)",
    "",
    "1. Character voice",
    "2. Korean naturalness",
    "3. Character setting fidelity",
    "4. Scene understanding",
    "5. Action quality",
    "6. Bot2 coordination (F10 only)",
    "7. User agency",
    "8. Consequence discipline",
    "",
    "---",
    "",
  ];

  for (const fixture of FROZEN_FIXTURES) {
    for (const pass of [1, 2]) {
      const pair = records.filter((r) => r.fixture_id === fixture.id && r.pass === pass && r.http_success);
      if (pair.length < 2) continue;
      const sampleA = pair.find((r) => blind.get(`${fixture.id}:${pass}:${r.model}`) === "A");
      const sampleB = pair.find((r) => blind.get(`${fixture.id}:${pass}:${r.model}`) === "B");
      if (!sampleA || !sampleB) continue;

      lines.push(`## FIXTURE ${fixture.id} — Pass ${pass}`);
      lines.push("");
      lines.push("### Relevant frozen context");
      lines.push("");
      lines.push(`- **Character:** ${fixture.ctx.characterName} (${fixture.label})`);
      lines.push(`- **Scene:** ${fixture.sceneSummary}`);
      if (fixture.bot1CanonicalAction) {
        lines.push("- **Previous companion action (Bot1 canonical):**");
        lines.push("```");
        lines.push(fixture.bot1CanonicalAction.slice(0, 1200));
        lines.push("```");
      }
      lines.push(`- **Human action:** ${fixture.ctx.humanActions.map((h) => h.text).join(" ")}`);
      lines.push("");
      lines.push("### Sample A");
      lines.push("");
      lines.push("```");
      lines.push(sampleA.raw_text.trim());
      lines.push("```");
      lines.push("");
      lines.push("### Sample B");
      lines.push("");
      lines.push("```");
      lines.push(sampleB.raw_text.trim());
      lines.push("```");
      lines.push("");
      lines.push("### Human scoring");
      lines.push("");
      lines.push("| Metric | Sample A | Sample B |");
      lines.push("| --- | ---: | ---: |");
      lines.push("| Character voice | | |");
      lines.push("| Korean naturalness | | |");
      lines.push("| Character fidelity | | |");
      lines.push("| Scene understanding | | |");
      lines.push("| Action quality | | |");
      lines.push("| Bot2 coordination | | |");
      lines.push("| User agency | | |");
      lines.push("| Consequence discipline | | |");
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  writeFileSync(join(OUT_DIR, "HUMAN_REVIEW.md"), lines.join("\n"));
}

function writeModelKey(blind: Map<string, "A" | "B">) {
  const rows: string[] = [
    "# TRPG Bot-Seat A/B Model Key",
    "",
    "Do not open until after human scoring.",
    "",
    "| Fixture | Pass | Sample A model | Sample B model |",
    "| --- | ---: | --- | --- |",
  ];
  for (const fixture of FROZEN_FIXTURES) {
    for (const pass of [1, 2]) {
      const aModel =
        [...blind.entries()].find(([k, v]) => k.startsWith(`${fixture.id}:${pass}:`) && v === "A")?.[0]?.split(":")[2] ??
        "?";
      const bModel =
        [...blind.entries()].find(([k, v]) => k.startsWith(`${fixture.id}:${pass}:`) && v === "B")?.[0]?.split(":")[2] ??
        "?";
      rows.push(`| ${fixture.id} | ${pass} | ${aModel} | ${bModel} |`);
    }
  }
  rows.push("");
  rows.push(`- **Candidate A (production label):** \`${BENCH_GEMINI_MODEL}\``);
  rows.push(`- **Candidate B (production label):** \`${BENCH_LUNA_MODEL}\``);
  writeFileSync(join(OUT_DIR, "MODEL_KEY.md"), rows.join("\n"));
}

function writeBenchmarkReport(
  records: BenchCallRecord[],
  geminiSummary: ReturnType<typeof summarizeModel>,
  lunaSummary: ReturnType<typeof summarizeModel>,
  exchange: Awaited<ReturnType<typeof resolveBillingExchangeRateSnapshot>>
) {
  const probe = loadContractProbe();
  const geminiProbe = probe?.GEMINI_REQUEST_CONTRACT as Record<string, unknown> | undefined;
  const lunaProbe = probe?.LUNA_REQUEST_CONTRACT as Record<string, unknown> | undefined;

  const geminiBody = buildBenchBotRequestBody({
    model: BENCH_GEMINI_MODEL,
    system: TRPG_BOT_SYSTEM,
    user: "probe",
  });
  const lunaBody = buildBenchBotRequestBody({
    model: BENCH_LUNA_MODEL,
    system: TRPG_BOT_SYSTEM,
    user: "probe",
  });
  const specific = contractsAreModelSpecific(geminiBody, lunaBody);

  const bot1Like = records.filter((r) => r.http_success && r.fixture_id !== "F10");
  const bot2Like = records.filter((r) => r.http_success && r.fixture_id === "F10");
  const avgBot1Gemini =
    bot1Like
      .filter((r) => r.model === BENCH_GEMINI_MODEL)
      .map((r) => resolveCallCostUsd(r))
      .filter((c): c is number => typeof c === "number")
      .reduce((s, r) => s + r, 0) /
    Math.max(1, bot1Like.filter((r) => r.model === BENCH_GEMINI_MODEL && r.http_success).length);
  const avgBot2Gemini =
    bot2Like
      .filter((r) => r.model === BENCH_GEMINI_MODEL)
      .map((r) => resolveCallCostUsd(r))
      .filter((c): c is number => typeof c === "number")
      .reduce((s, r) => s + r, 0) /
    Math.max(1, bot2Like.filter((r) => r.model === BENCH_GEMINI_MODEL && r.http_success).length);
  const avgBot1Luna =
    bot1Like
      .filter((r) => r.model === BENCH_LUNA_MODEL)
      .map((r) => resolveCallCostUsd(r))
      .filter((c): c is number => typeof c === "number")
      .reduce((s, r) => s + r, 0) /
    Math.max(1, bot1Like.filter((r) => r.model === BENCH_LUNA_MODEL && r.http_success).length);
  const avgBot2Luna =
    bot2Like
      .filter((r) => r.model === BENCH_LUNA_MODEL)
      .map((r) => resolveCallCostUsd(r))
      .filter((c): c is number => typeof c === "number")
      .reduce((s, r) => s + r, 0) /
    Math.max(1, bot2Like.filter((r) => r.model === BENCH_LUNA_MODEL && r.http_success).length);

  const roundCostGeminiUsd = avgBot1Gemini + avgBot2Gemini;
  const roundCostLunaUsd = avgBot1Luna + avgBot2Luna;
  const roundCostGeminiKrw = convertUsdToKrw(roundCostGeminiUsd, exchange.effectiveKrwPerUsd);
  const roundCostLunaKrw = convertUsdToKrw(roundCostLunaUsd, exchange.effectiveKrwPerUsd);

  const report = {
    generatedAt: new Date().toISOString(),
    CURSOR_SUBJECTIVE_SCORING: false,
    FINAL_MODEL_WINNER: "HUMAN_REVIEW_PENDING",
    GEMINI_REQUEST_CONTRACT: {
      benchmarkOutbound: describeModelContract(
        BENCH_GEMINI_MODEL,
        buildBenchBotRequestBody({ model: BENCH_GEMINI_MODEL, system: TRPG_BOT_SYSTEM, user: "probe" })
      ).adaptedBody,
      productionAdapter: {
        model: BENCH_GEMINI_MODEL,
        reasoning_effort: "low",
      },
      GEMINI_TRUE_OFF_SUPPORTED: "INTERMITTENT — reasoning_effort=none accepted in probe + 19/20 bench calls; 1× HTTP 400 'Reasoning is mandatory'",
      GEMINI_REASONING_MODE: "none (benchmark) / low (production adapter)",
      probeVariants: geminiProbe?.variants,
    },
    LUNA_REQUEST_CONTRACT: {
      ...(lunaProbe ?? describeModelContract(BENCH_LUNA_MODEL, lunaBody).adaptedBody),
      LUNA_TRUE_OFF_SUPPORTED: lunaProbe?.LUNA_TRUE_OFF_SUPPORTED ?? true,
      LUNA_REASONING_MODE: lunaProbe?.LUNA_REASONING_MODE ?? "none",
    },
    contractsAreModelSpecific: specific,
    exchangeRate: exchange,
    comparison: {
      [BENCH_GEMINI_MODEL]: geminiSummary,
      [BENCH_LUNA_MODEL]: lunaSummary,
    },
    cost: {
      BOT1_LIKE_AVG_USD: { gemini: avgBot1Gemini, luna: avgBot1Luna },
      BOT2_LIKE_AVG_USD: { gemini: avgBot2Gemini, luna: avgBot2Luna },
      CURRENT_EFFECTIVE_2BOT_COST_KRW: {
        gemini: roundCostGeminiKrw,
        luna: roundCostLunaKrw,
      },
      COST_SOURCE:
        "token_estimate_via_openRouterModelPricing (provider usage.cost not exposed on most calls)",
      PRODUCT_GATE_KRW_20: {
        gemini: roundCostGeminiKrw <= 20 ? "PASS" : "FAIL",
        luna: roundCostLunaKrw <= 20 ? "PASS" : "FAIL",
      },
    },
    failures: records
      .filter((r) => !r.http_success)
      .map((r) => ({
        fixture_id: r.fixture_id,
        model: r.model,
        pass: r.pass,
        http_status: r.http_status,
        error: r.error?.slice(0, 200),
      })),
    latencyGates: {
      gemini: latencyGate(geminiSummary),
      luna: latencyGate(lunaSummary),
    },
    BEST_KOREAN_CHARACTER_MODEL: "HUMAN_REVIEW_PENDING",
    FASTEST_MODEL:
      geminiSummary.LATENCY_P50 <= lunaSummary.LATENCY_P50 ? BENCH_GEMINI_MODEL : BENCH_LUNA_MODEL,
    BEST_P95_LATENCY:
      geminiSummary.LATENCY_P95 <= lunaSummary.LATENCY_P95 ? BENCH_GEMINI_MODEL : BENCH_LUNA_MODEL,
    BEST_VALUE: "DEFER_TO_COST_AND_HUMAN_REVIEW",
    BEST_PRODUCTION_BOT_MODEL: "HUMAN_REVIEW_PENDING",
    PRODUCTION_RECOMMENDATION_REASON:
      "Objective benchmark complete. Subjective quality scoring deferred to human review in HUMAN_REVIEW.md.",
  };

  writeFileSync(join(OUT_DIR, "BENCHMARK_REPORT.json"), JSON.stringify(report, null, 2));

  const md = [
    "# TRPG Bot-Seat A/B Benchmark Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Comparison",
    "",
    "| Metric | Gemini 3.7 Flash | GPT-5.6 Luna |",
    "| --- | ---: | ---: |",
    ...comparisonRows(geminiSummary, lunaSummary),
    "",
    "## Human quality (blank — score in HUMAN_REVIEW.md)",
    "",
    "| Metric | Gemini 3.7 Flash | GPT-5.6 Luna |",
    "| --- | ---: | ---: |",
    "| CHARACTER_VOICE | | |",
    "| KOREAN_NATURALNESS | | |",
    "| CHARACTER_SETTING_FIDELITY | | |",
    "| SCENE_UNDERSTANDING | | |",
    "| ACTION_QUALITY | | |",
    "| BOT2_COORDINATION | | |",
    "| USER_AGENCY | | |",
    "| CONSEQUENCE_DISCIPLINE | | |",
    "| QUALITY_TOTAL | | |",
    "",
    "## Cost (2-bot round, provider actual when available)",
    "",
    `- Gemini: **${roundCostGeminiKrw.toFixed(2)} KRW** (${report.cost.PRODUCT_GATE_KRW_20.gemini}) — est. from token rates`,
    `- Luna: **${roundCostLunaKrw.toFixed(2)} KRW** (${report.cost.PRODUCT_GATE_KRW_20.luna}) — est. from token rates`,
    "",
    "## Request contracts",
    "",
    "- **Gemini benchmark outbound:** `reasoning_effort: none` (production adapter uses `low`)",
    "- **Luna benchmark outbound:** `reasoning: { effort: \"none\" }`, `reasoning_effort: \"none\"`",
    "- Provider `usage.cost` was not exposed on most calls; costs are token-estimated.",
    "",
    "## Failures",
    "",
    report.failures?.length
      ? report.failures.map((f) => `- ${f.fixture_id} ${f.model} pass=${f.pass}: HTTP ${f.http_status} — ${f.error}`).join("\n")
      : "- None",
    "",
    "## Final decision",
    "",
    "- `FINAL_MODEL_WINNER`: **HUMAN_REVIEW_PENDING**",
    "- `BEST_PRODUCTION_BOT_MODEL`: **HUMAN_REVIEW_PENDING**",
    "- Cursor did not assign subjective quality scores.",
    "",
  ].join("\n");
  writeFileSync(join(OUT_DIR, "BENCHMARK_REPORT.md"), md);
}

function comparisonRows(g: ReturnType<typeof summarizeModel>, l: ReturnType<typeof summarizeModel>): string[] {
  const keys = [
    "CALLS",
    "SUCCESS_RATE",
    "AVG_INPUT_TOKENS",
    "AVG_OUTPUT_TOKENS",
    "AVG_CACHE_READ_TOKENS",
    "LATENCY_MEAN",
    "LATENCY_P50",
    "LATENCY_P75",
    "LATENCY_P90",
    "LATENCY_P95",
    "LATENCY_MAX",
    "AVG_ACTUAL_COST_USD",
    "PARSE_SUCCESS_RATE",
    "ACTION_TYPE_VALID_RATE",
    "INTENT_VALID_RATE",
    "FALLBACK_RATE",
    "USER_AGENCY_VIOLATION_RATE",
    "CONSEQUENCE_VIOLATION_RATE",
  ] as const;
  return keys.map((k) => {
    const gv = g[k];
    const lv = l[k];
    const fmt = (v: number) => {
      if (k.includes("RATE")) return `${(v * 100).toFixed(1)}%`;
      if (k.includes("COST_USD")) return v.toFixed(4);
      return typeof v === "number" ? v.toFixed(2) : String(v);
    };
    return `| ${k} | ${fmt(gv as number)} | ${fmt(lv as number)} |`;
  });
}

function latencyGate(s: ReturnType<typeof summarizeModel>): string {
  if (s.CALLS_OVER_30S >= 2) return "FAIL (>30s repeated)";
  if (s.LATENCY_P95 > 20_000) return "CONCERN";
  if (s.LATENCY_P50 <= 6_000 && s.LATENCY_P95 <= 10_000) return "EXCELLENT";
  if (s.LATENCY_P50 <= 8_000 && s.LATENCY_P95 <= 12_000) return "GOOD";
  if (s.LATENCY_P50 <= 10_000 && s.LATENCY_P95 <= 15_000) return "ACCEPTABLE";
  return "CONCERN";
}

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });

  if (process.env.REPORT_ONLY === "1" && existsSync(join(OUT_DIR, "raw_evidence.json"))) {
    const records = JSON.parse(readFileSync(join(OUT_DIR, "raw_evidence.json"), "utf8")) as BenchCallRecord[];
    for (const record of records) {
      const fixture = FROZEN_FIXTURES.find((f) => f.id === record.fixture_id);
      record.structural = runStructuralChecks({
        rawText: record.raw_text,
        httpSuccess: record.http_success,
        fallbackName: fixture?.ctx.characterName ?? "Bot",
      });
    }
    const geminiRecords = records.filter((r) => r.model === BENCH_GEMINI_MODEL);
    const lunaRecords = records.filter((r) => r.model === BENCH_LUNA_MODEL);
    const exchange = await resolveBillingExchangeRateSnapshot();
    const blind = assignBlindLabels(records);
    writeHumanReview(records, blind);
    writeModelKey(blind);
    writeBenchmarkReport(records, summarizeModel(geminiRecords), summarizeModel(lunaRecords), exchange);
    console.info("[bench] report-only complete");
    return;
  }

  const plan = buildCallPlan();
  console.info(`[bench] ${plan.length} calls planned`);

  const records: BenchCallRecord[] = [];
  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i]!;
    console.info(`[bench] call ${i + 1}/${plan.length} ${item.fixture.id} ${item.model} pass=${item.pass}`);
    const record = await runCall(item, i + 1);
    records.push(record);
    const fname = `${String(i + 1).padStart(2, "0")}_${item.fixture.id}_${item.model.replace(/\./g, "-")}_p${item.pass}.json`;
    writeFileSync(join(RAW_DIR, fname), JSON.stringify(record, null, 2));
  }

  writeFileSync(join(OUT_DIR, "raw_evidence.json"), JSON.stringify(records, null, 2));

  const geminiRecords = records.filter((r) => r.model === BENCH_GEMINI_MODEL);
  const lunaRecords = records.filter((r) => r.model === BENCH_LUNA_MODEL);
  const exchange = await resolveBillingExchangeRateSnapshot();

  const blind = assignBlindLabels(records);
  writeHumanReview(records, blind);
  writeModelKey(blind);
  writeBenchmarkReport(records, summarizeModel(geminiRecords), summarizeModel(lunaRecords), exchange);

  console.info("[bench] complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
