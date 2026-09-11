/**
 * 4-model Korean summary quality benchmark — exactly 80 primary CheaperInference calls.
 * No retry, fallback, continuation, regeneration, or recovery.
 */
import { createWriteStream } from "node:fs";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "../../src/lib/cheaperInferenceConfig";
import { parseCompatibleUsage } from "../../src/lib/openRouterUsage";
import { buildBenchmarkCheaperInferenceBody } from "./benchRequestBody";
import {
  BENCH_REQUEST_KIND,
  SUMMARY_QUALITY_BENCH_MODELS,
} from "./models";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

const OUT_DIR = join(process.cwd(), "docs/audits/4-model-korean-summary-quality");
const FIXTURES_PATH = join(OUT_DIR, "fixtures.json");
const RAW_PATH = join(OUT_DIR, "raw-results.jsonl");
const TIMEOUT_MS = 180_000;

type FrozenFixture = {
  fixture_id: string;
  production_style: {
    system_prompt: string;
    user_prompt: string;
  };
  source_hash_sha256: string;
};

type BenchResult = {
  fixture_id: string;
  requested_model_id: string;
  model_label: string;
  call_index: number;
  status: "ok" | "CALL_FAILED";
  reported_model_id: string | "NOT_AVAILABLE";
  provider: string | "NOT_AVAILABLE";
  route_metadata: Record<string, unknown>;
  request_started_at: string;
  first_token_at: string | "NOT_AVAILABLE";
  completed_at: string;
  ttft_ms: number | "NOT_AVAILABLE";
  total_latency_ms: number;
  input_tokens: number | "NOT_AVAILABLE";
  output_tokens: number | "NOT_AVAILABLE";
  reasoning_tokens: number | "NOT_AVAILABLE";
  cached_tokens: number | "NOT_AVAILABLE";
  finish_reason: string | "NOT_AVAILABLE";
  http_status: number | null;
  error_type: string | null;
  provider_message: string | null;
  timeout: boolean;
  rate_limited_429: boolean;
  server_error_5xx: boolean;
  provider_error: boolean;
  connection_error: boolean;
  empty_response: boolean;
  malformed_response: boolean;
  reported_cost_usd: number | "NOT_AVAILABLE";
  actual_cost_usd: number | "NOT_AVAILABLE";
  request_body_sent: Record<string, unknown>;
  raw_provider_response: unknown | null;
  parsed_output_text: string | null;
  source_hash_sha256: string;
};

function loadFixtures(): FrozenFixture[] {
  const raw = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as {
    fixtures: FrozenFixture[];
  };
  if (raw.fixtures.length !== 20) {
    throw new Error(`Expected 20 frozen fixtures, got ${raw.fixtures.length}`);
  }
  return raw.fixtures;
}

async function callOnce(opts: {
  fixture: FrozenFixture;
  modelLabel: string;
  requestedModelId: string;
  reasoningParams: Record<string, unknown>;
  callIndex: number;
}): Promise<BenchResult> {
  const started = Date.now();
  const requestStartedAt = new Date(started).toISOString();
  const messages = [
    { role: "system" as const, content: opts.fixture.production_style.system_prompt },
    { role: "user" as const, content: opts.fixture.production_style.user_prompt },
  ];
  const requestBody = buildBenchmarkCheaperInferenceBody({
    requestedModelId: opts.requestedModelId,
    messages,
    reasoningParams: opts.reasoningParams,
  });

  const base: BenchResult = {
    fixture_id: opts.fixture.fixture_id,
    requested_model_id: opts.requestedModelId,
    model_label: opts.modelLabel,
    call_index: opts.callIndex,
    status: "CALL_FAILED",
    reported_model_id: "NOT_AVAILABLE",
    provider: "NOT_AVAILABLE",
    route_metadata: {},
    request_started_at: requestStartedAt,
    first_token_at: "NOT_AVAILABLE",
    completed_at: new Date().toISOString(),
    ttft_ms: "NOT_AVAILABLE",
    total_latency_ms: 0,
    input_tokens: "NOT_AVAILABLE",
    output_tokens: "NOT_AVAILABLE",
    reasoning_tokens: "NOT_AVAILABLE",
    cached_tokens: "NOT_AVAILABLE",
    finish_reason: "NOT_AVAILABLE",
    http_status: null,
    error_type: null,
    provider_message: null,
    timeout: false,
    rate_limited_429: false,
    server_error_5xx: false,
    provider_error: false,
    connection_error: false,
    empty_response: false,
    malformed_response: false,
    reported_cost_usd: "NOT_AVAILABLE",
    actual_cost_usd: "NOT_AVAILABLE",
    request_body_sent: requestBody,
    raw_provider_response: null,
    parsed_output_text: null,
    source_hash_sha256: opts.fixture.source_hash_sha256,
  };

  try {
    const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const completed = Date.now();
    base.completed_at = new Date(completed).toISOString();
    base.total_latency_ms = completed - started;
    base.http_status = res.status;

    const bodyText = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(bodyText) as Record<string, unknown>;
      base.raw_provider_response = data;
    } catch {
      base.malformed_response = true;
      base.provider_message = bodyText.slice(0, 500);
      base.error_type = "MALFORMED_JSON";
      return base;
    }

    if (!res.ok) {
      base.provider_error = true;
      base.provider_message =
        typeof data.error === "object" && data.error && "message" in data.error
          ? String((data.error as { message?: unknown }).message)
          : bodyText.slice(0, 500);
      base.error_type = `HTTP_${res.status}`;
      base.rate_limited_429 = res.status === 429;
      base.server_error_5xx = res.status >= 500;
      return base;
    }

    const choices = data.choices as
      | { message?: { content?: string }; finish_reason?: string }[]
      | undefined;
    const message = choices?.[0]?.message;
    const text = message?.content?.trim() ?? "";
    base.parsed_output_text = text || null;
    base.finish_reason = choices?.[0]?.finish_reason ?? "NOT_AVAILABLE";
    base.reported_model_id = typeof data.model === "string" ? data.model : "NOT_AVAILABLE";
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
    base.reported_cost_usd = usage.cheaperInferenceBilledCostUsd ?? "NOT_AVAILABLE";
    base.actual_cost_usd = usage.upstreamCostUsd ?? "NOT_AVAILABLE";

    if (!text) {
      base.empty_response = true;
      base.error_type = "EMPTY_RESPONSE";
      return base;
    }

    base.status = "ok";
    return base;
  } catch (e) {
    const completed = Date.now();
    base.completed_at = new Date(completed).toISOString();
    base.total_latency_ms = completed - started;
    const msg = (e as Error).message ?? String(e);
    base.provider_message = msg.slice(0, 500);
    if (/timeout|AbortError|aborted/i.test(msg)) {
      base.timeout = true;
      base.error_type = "TIMEOUT";
    } else {
      base.connection_error = true;
      base.error_type = "CONNECTION_ERROR";
    }
    return base;
  }
}

function validateResults(results: BenchResult[]) {
  const byModel = new Map<string, number>();
  for (const m of SUMMARY_QUALITY_BENCH_MODELS) {
    byModel.set(m.requestedModelId, 0);
  }
  for (const r of results) {
    byModel.set(r.requested_model_id, (byModel.get(r.requested_model_id) ?? 0) + 1);
  }
  return {
    fixture_count: new Set(results.map((r) => r.fixture_id)).size,
    model_count: SUMMARY_QUALITY_BENCH_MODELS.length,
    calls_per_model: Object.fromEntries(
      SUMMARY_QUALITY_BENCH_MODELS.map((m) => [
        m.label,
        byModel.get(m.requestedModelId) ?? 0,
      ])
    ),
    expected_primary_calls: 80,
    actual_primary_calls: results.length,
    retry_calls: 0,
    fallback_calls: 0,
    continuation_calls: 0,
    recovery_calls: 0,
    regeneration_calls: 0,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixtures = loadFixtures();
  const results: BenchResult[] = [];
  const jsonl = createWriteStream(RAW_PATH, { flags: "w" });

  let callIndex = 0;
  for (const fixture of fixtures) {
    for (const model of SUMMARY_QUALITY_BENCH_MODELS) {
      callIndex += 1;
      console.log(
        `[${callIndex}/80] ${fixture.fixture_id} × ${model.label} (${model.requestedModelId})`
      );
      const result = await callOnce({
        fixture,
        modelLabel: model.label,
        requestedModelId: model.requestedModelId,
        reasoningParams: { ...model.reasoningParams },
        callIndex,
      });
      results.push(result);
      jsonl.write(`${JSON.stringify(result)}\n`);
      console.log(
        `  → ${result.status} latency=${result.total_latency_ms}ms output_chars=${result.parsed_output_text?.length ?? 0}`
      );
    }
  }
  jsonl.end();

  const invariants = validateResults(results);
  writeFileSync(join(OUT_DIR, "run-invariants.json"), JSON.stringify(invariants, null, 2));

  if (invariants.actual_primary_calls !== 80) {
    throw new Error(`Call count mismatch: ${invariants.actual_primary_calls}`);
  }
  for (const model of SUMMARY_QUALITY_BENCH_MODELS) {
    const count = invariants.calls_per_model[model.label];
    if (count !== 20) {
      throw new Error(`${model.label} calls=${count}, expected 20`);
    }
  }

  console.log("BENCH_COMPLETE", JSON.stringify(invariants));
}

void main();
