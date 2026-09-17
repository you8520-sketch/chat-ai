/**
 * 3-model summary reliability/speed benchmark — 180 primary CheaperInference calls.
 * 20 frozen fixtures × 3 rounds × 3 models, interleaved. No retry/fallback.
 */
import { createWriteStream } from "node:fs";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "../../src/lib/cheaperInferenceConfig";
import { parseCompatibleUsage } from "../../src/lib/openRouterUsage";
import { estimateTokens } from "../../src/lib/tokenEstimate";
import { adaptCheaperInferenceChatBody } from "../../src/lib/cheaperInferenceConfig";
import { buildBenchmarkCheaperInferenceBody } from "../summary-quality-bench/benchRequestBody";
import {
  BENCH_MODEL_ORDER,
  BENCH_REQUEST_KIND,
  BENCH_TIMEOUT_MS,
  PRODUCTION_LUNA_MODEL_ID,
  RELIABILITY_BENCH_MODELS,
} from "./models";

const QUALITY_FIXTURES_PATH = join(
  process.cwd(),
  "docs/audits/4-model-korean-summary-quality/fixtures.json"
);
const OUT_DIR = join(process.cwd(), "docs/audits/3-model-summary-reliability-speed-60");
const RAW_PATH = join(OUT_DIR, "raw-results.jsonl");

type FrozenFixture = {
  fixture_id: string;
  production_style: {
    system_prompt: string;
    user_prompt: string;
  };
  source_hash_sha256: string;
};

export type ReliabilityClassification =
  | "VALID_SUCCESS"
  | "EMPTY_RESPONSE"
  | "TIMEOUT"
  | "HTTP_ERROR"
  | "PROVIDER_ERROR"
  | "MALFORMED_RESPONSE";

export type BenchRecord = {
  call_index: number;
  fixture_id: string;
  round: number;
  model_label: string;
  model_requested: string;
  model_reported: string | "NOT_AVAILABLE";
  provider: string | "NOT_AVAILABLE";
  started_at: string;
  finished_at: string;
  total_latency_ms: number;
  ttft_ms: number | "TTFT_NOT_MEASURABLE";
  http_status: number | null;
  finish_reason: string | "NOT_AVAILABLE";
  input_tokens: number | "NOT_AVAILABLE";
  output_tokens: number | "NOT_AVAILABLE";
  reasoning_tokens: number | "NOT_AVAILABLE";
  cached_tokens: number | "NOT_AVAILABLE";
  cache_read_tokens: number | "NOT_AVAILABLE";
  cache_write_tokens: number | "NOT_AVAILABLE";
  reported_cost_usd: number | "NOT_AVAILABLE";
  actual_cost_usd: number | "NOT_AVAILABLE";
  visible_output_chars: number;
  visible_output_token_count: number | "NOT_AVAILABLE";
  empty_response: boolean;
  timeout: boolean;
  error_type: string | null;
  provider_message: string | null;
  classification: ReliabilityClassification;
  length_truncated: boolean;
  request_kind: string;
  request_body_sent: Record<string, unknown>;
  route_metadata: Record<string, unknown>;
  raw_provider_response: unknown | null;
  source_hash_sha256: string;
  execution_order: "interleaved_round_fixture_model";
  model_order: readonly string[];
};

function loadFixtures(): FrozenFixture[] {
  const raw = JSON.parse(readFileSync(QUALITY_FIXTURES_PATH, "utf8")) as {
    fixtures: FrozenFixture[];
  };
  if (raw.fixtures.length !== 20) {
    throw new Error(`Expected 20 frozen fixtures, got ${raw.fixtures.length}`);
  }
  return raw.fixtures;
}

function hasHangul(text: string): boolean {
  return /[\uAC00-\uD7A3]/.test(text);
}

function classify(opts: {
  httpStatus: number | null;
  visibleText: string;
  timeout: boolean;
  malformed: boolean;
  providerError: boolean;
  finishReason: string | null;
}): { classification: ReliabilityClassification; length_truncated: boolean } {
  const length_truncated =
    !!opts.visibleText && opts.finishReason === "length";
  if (opts.timeout) return { classification: "TIMEOUT", length_truncated: false };
  if (opts.malformed) return { classification: "MALFORMED_RESPONSE", length_truncated: false };
  if (opts.providerError && opts.httpStatus && opts.httpStatus >= 400) {
    return {
      classification: opts.httpStatus >= 500 ? "HTTP_ERROR" : "PROVIDER_ERROR",
      length_truncated: false,
    };
  }
  if (opts.httpStatus && opts.httpStatus >= 400) {
    return { classification: "HTTP_ERROR", length_truncated: false };
  }
  if (!opts.visibleText.trim()) {
    return { classification: "EMPTY_RESPONSE", length_truncated: false };
  }
  if (!hasHangul(opts.visibleText)) {
    return { classification: "EMPTY_RESPONSE", length_truncated: length_truncated };
  }
  return { classification: "VALID_SUCCESS", length_truncated };
}

function buildCallPlan(fixtures: FrozenFixture[]) {
  const plan: Array<{
    fixture: FrozenFixture;
    round: number;
    model: (typeof RELIABILITY_BENCH_MODELS)[number];
  }> = [];
  for (let round = 1; round <= 3; round += 1) {
    for (const fixture of fixtures) {
      for (const label of BENCH_MODEL_ORDER) {
        const model = RELIABILITY_BENCH_MODELS.find((m) => m.label === label);
        if (!model) throw new Error(`Missing model config for ${label}`);
        plan.push({ fixture, round, model });
      }
    }
  }
  return plan;
}

async function callOnce(opts: {
  callIndex: number;
  fixture: FrozenFixture;
  round: number;
  model: (typeof RELIABILITY_BENCH_MODELS)[number];
}): Promise<BenchRecord> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const messages = [
    { role: "system" as const, content: opts.fixture.production_style.system_prompt },
    { role: "user" as const, content: opts.fixture.production_style.user_prompt },
  ];
  let requestBody = buildBenchmarkCheaperInferenceBody({
    requestedModelId: opts.model.requestedModelId,
    messages,
    reasoningParams: { ...opts.model.reasoningParams },
  });
  if (opts.model.requestedModelId === PRODUCTION_LUNA_MODEL_ID) {
    requestBody = adaptCheaperInferenceChatBody(requestBody);
  }

  const base: BenchRecord = {
    call_index: opts.callIndex,
    fixture_id: opts.fixture.fixture_id,
    round: opts.round,
    model_label: opts.model.label,
    model_requested: opts.model.requestedModelId,
    model_reported: "NOT_AVAILABLE",
    provider: "NOT_AVAILABLE",
    started_at: startedAt,
    finished_at: startedAt,
    total_latency_ms: 0,
    ttft_ms: "TTFT_NOT_MEASURABLE",
    http_status: null,
    finish_reason: "NOT_AVAILABLE",
    input_tokens: "NOT_AVAILABLE",
    output_tokens: "NOT_AVAILABLE",
    reasoning_tokens: "NOT_AVAILABLE",
    cached_tokens: "NOT_AVAILABLE",
    cache_read_tokens: "NOT_AVAILABLE",
    cache_write_tokens: "NOT_AVAILABLE",
    reported_cost_usd: "NOT_AVAILABLE",
    actual_cost_usd: "NOT_AVAILABLE",
    visible_output_chars: 0,
    visible_output_token_count: "NOT_AVAILABLE",
    empty_response: true,
    timeout: false,
    error_type: null,
    provider_message: null,
    classification: "EMPTY_RESPONSE",
    length_truncated: false,
    request_kind: BENCH_REQUEST_KIND,
    request_body_sent: requestBody,
    route_metadata: {},
    raw_provider_response: null,
    source_hash_sha256: opts.fixture.source_hash_sha256,
    execution_order: "interleaved_round_fixture_model",
    model_order: BENCH_MODEL_ORDER,
  };

  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(BENCH_TIMEOUT_MS),
    });
    const finished = Date.now();
    base.finished_at = new Date(finished).toISOString();
    base.total_latency_ms = finished - started;
    base.http_status = res.status;

    const bodyText = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(bodyText) as Record<string, unknown>;
      base.raw_provider_response = data;
    } catch {
      base.error_type = "MALFORMED_JSON";
      base.provider_message = bodyText.slice(0, 500);
      base.classification = "MALFORMED_RESPONSE";
      return base;
    }

    if (!res.ok) {
      base.error_type = `HTTP_${res.status}`;
      base.provider_message =
        typeof data.error === "object" && data.error && "message" in data.error
          ? String((data.error as { message?: unknown }).message)
          : bodyText.slice(0, 500);
      base.classification = res.status >= 500 ? "HTTP_ERROR" : "PROVIDER_ERROR";
      return base;
    }

    const choices = data.choices as
      | { message?: { content?: string }; finish_reason?: string }[]
      | undefined;
    const text = choices?.[0]?.message?.content?.trim() ?? "";
    base.visible_output_chars = text.length;
    base.visible_output_token_count = text ? estimateTokens(text) : 0;
    base.empty_response = !text;
    base.finish_reason = choices?.[0]?.finish_reason ?? "NOT_AVAILABLE";
    base.model_reported = typeof data.model === "string" ? data.model : "NOT_AVAILABLE";
    base.provider = typeof data.provider === "string" ? data.provider : "NOT_AVAILABLE";
    base.route_metadata = {
      service_tier: data.service_tier ?? null,
      system_fingerprint: data.system_fingerprint ?? null,
      id: data.id ?? null,
    };

    const usage = parseCompatibleUsage({
      usage: data.usage as Record<string, unknown> | undefined,
      cheaperInference: data.cheaper_inference as Record<string, unknown> | undefined,
      headers: res.headers,
    });
    base.input_tokens = usage.promptTokens || "NOT_AVAILABLE";
    base.output_tokens = usage.completionTokens || "NOT_AVAILABLE";
    base.reasoning_tokens = usage.reasoningTokens || "NOT_AVAILABLE";
    base.cached_tokens = usage.cacheReadTokens || "NOT_AVAILABLE";
    base.cache_read_tokens = usage.cacheReadTokens || "NOT_AVAILABLE";
    base.cache_write_tokens = usage.cacheWriteTokens || "NOT_AVAILABLE";
    base.reported_cost_usd = usage.cheaperInferenceBilledCostUsd ?? "NOT_AVAILABLE";
    base.actual_cost_usd = usage.upstreamCostUsd ?? "NOT_AVAILABLE";

    const finishReason =
      base.finish_reason === "NOT_AVAILABLE" ? null : String(base.finish_reason);
    const { classification, length_truncated } = classify({
      httpStatus: res.status,
      visibleText: text,
      timeout: false,
      malformed: false,
      providerError: false,
      finishReason,
    });
    base.classification = classification;
    base.length_truncated = length_truncated;
    return base;
  } catch (e) {
    const finished = Date.now();
    base.finished_at = new Date(finished).toISOString();
    base.total_latency_ms = finished - started;
    const msg = (e as Error).message ?? String(e);
    base.provider_message = msg.slice(0, 500);
    if (/timeout|AbortError|aborted/i.test(msg)) {
      base.timeout = true;
      base.error_type = "TIMEOUT";
      base.classification = "TIMEOUT";
    } else {
      base.error_type = "CONNECTION_ERROR";
      base.classification = "PROVIDER_ERROR";
    }
    return base;
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixtures = loadFixtures();
  const plan = buildCallPlan(fixtures);
  if (plan.length !== 180) throw new Error(`Expected 180 calls, got ${plan.length}`);

  const results: BenchRecord[] = [];
  const jsonl = createWriteStream(RAW_PATH, { flags: "w" });

  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i]!;
    const callIndex = i + 1;
    console.log(
      `[${callIndex}/180] R${step.round} ${step.fixture.fixture_id} × ${step.model.label}`
    );
    const result = await callOnce({
      callIndex,
      fixture: step.fixture,
      round: step.round,
      model: step.model,
    });
    results.push(result);
    jsonl.write(`${JSON.stringify(result)}\n`);
    console.log(
      `  → ${result.classification} latency=${result.total_latency_ms}ms chars=${result.visible_output_chars}`
    );
  }
  jsonl.end();

  const byModel = new Map<string, number>();
  for (const m of RELIABILITY_BENCH_MODELS) {
    byModel.set(m.requestedModelId, 0);
  }
  for (const r of results) {
    byModel.set(r.model_requested, (byModel.get(r.model_requested) ?? 0) + 1);
  }

  const invariants = {
    fixture_count: fixtures.length,
    rounds: 3,
    model_count: RELIABILITY_BENCH_MODELS.length,
    calls_per_model: Object.fromEntries(
      RELIABILITY_BENCH_MODELS.map((m) => [m.label, byModel.get(m.requestedModelId) ?? 0])
    ),
    expected_primary_calls: 180,
    actual_primary_calls: results.length,
    retry_calls: 0,
    fallback_calls: 0,
    continuation_calls: 0,
    recovery_calls: 0,
    regeneration_calls: 0,
    execution_order: "interleaved_round_fixture_model",
    model_order: BENCH_MODEL_ORDER,
    fixtures_source: QUALITY_FIXTURES_PATH,
  };

  writeFileSync(join(OUT_DIR, "run-invariants.json"), JSON.stringify(invariants, null, 2));

  if (results.length !== 180) throw new Error(`Call count ${results.length}`);
  for (const m of RELIABILITY_BENCH_MODELS) {
    const n = byModel.get(m.requestedModelId) ?? 0;
    if (n !== 60) throw new Error(`${m.label}: ${n}/60 calls`);
  }

  console.log("BENCH_COMPLETE", JSON.stringify(invariants));
}

void main();
