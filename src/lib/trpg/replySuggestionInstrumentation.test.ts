import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  diagnoseReplySuggestionParseStage,
  executeTrpgReplySuggestionProviderRound,
  extractReplySuggestionResponseShape,
  logTrpgReplySuggestionProviderTelemetry,
  resolvePrimaryTimeoutObservability,
  TRPG_REPLY_SUGGESTION_PROVIDER_ATTEMPTS_MAX,
  type TrpgReplySuggestionProviderTelemetry,
} from "./replySuggestions";

const CI_URL = "https://api.cheaperinference.com/v1/chat/completions";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

const validJson = JSON.stringify({
  suggestions: [
    { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
    { stance: "neutral", actionType: "investigate", text: "경첩부터 살핀다." },
    { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
  ],
});

function completion(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function providerEnvelope(content: unknown, extra?: { finish_reason?: string; completion_tokens?: number }) {
  return {
    choices: [{ message: { content }, finish_reason: extra?.finish_reason ?? "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: extra?.completion_tokens ?? 6 },
  };
}

async function withKeys<T>(fn: () => Promise<T>): Promise<T> {
  const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
  const previousOr = process.env.OPENROUTER_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
  process.env.OPENROUTER_API_KEY = "test-or";
  try {
    return await fn();
  } finally {
    if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
    if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOr;
  }
}

function captureProviderTelemetry(
  fn: () => Promise<unknown>
): Promise<TrpgReplySuggestionProviderTelemetry | null> {
  const logs: TrpgReplySuggestionProviderTelemetry[] = [];
  const previous = console.info;
  console.info = ((label: unknown, payload: TrpgReplySuggestionProviderTelemetry) => {
    if (label === "[trpg-reply-suggestion-provider]") logs.push(payload);
  }) as typeof console.info;
  return fn()
    .then(() => logs.at(-1) ?? null)
    .catch(() => logs.at(-1) ?? null)
    .finally(() => {
      console.info = previous;
    });
}

describe("TRPG reply suggestion failure instrumentation", () => {
  it("A: backup 200 + malformed JSON → fallback_parse_stage=json_parse", () => {
    assert.equal(diagnoseReplySuggestionParseStage("not-json"), "json_parse");
    const shape = extractReplySuggestionResponseShape(
      providerEnvelope("not-json", { completion_tokens: 42 })
    );
    assert.equal(shape.has_choices, true);
    assert.equal(shape.content_kind, "string");
    assert.equal(shape.output_tokens, 42);
  });

  it("B: backup 200 + object but suggestions not array → suggestions_not_array", () => {
    assert.equal(
      diagnoseReplySuggestionParseStage(JSON.stringify({ suggestions: "bad" })),
      "suggestions_not_array"
    );
  });

  it("C: backup valid → valid", () => {
    assert.equal(diagnoseReplySuggestionParseStage(validJson), "valid");
  });

  it("D: primary body timeout after headers → primary_headers_received=true", async () => {
    const obs = resolvePrimaryTimeoutObservability(
      Object.assign(new Error("body completion deadline exceeded"), {
        trigger: "body_timeout",
        httpStatus: 200,
      }),
      15_001
    );
    assert.equal(obs.primary_headers_received, true);
    assert.equal(obs.primary_http_status, 200);
    assert.equal(obs.primary_timeout_stage, "body");
    assert.equal(obs.primary_elapsed_ms, 15_001);

    await withKeys(async () => {
      const telemetry = await captureProviderTelemetry(async () => {
        await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "inst-d",
          deps: {
            fetchCompletion: async (fetchOpts) => {
              if (String(fetchOpts.request.endpoint).includes("cheaperinference")) {
                throw Object.assign(new Error("body completion deadline exceeded"), {
                  trigger: "body_timeout",
                  httpStatus: 200,
                });
              }
              return {
                response: completion(providerEnvelope(validJson)),
                latencyMs: 120,
              };
            },
          },
        });
      });
      assert.ok(telemetry);
      assert.equal(telemetry?.primary_failure_class, "body_timeout");
      assert.equal(telemetry?.primary_headers_received, true);
      assert.equal(telemetry?.primary_timeout_stage, "body");
      assert.equal(telemetry?.fallback_parse_stage, "valid");
      assert.equal(telemetry?.provider_attempt_count, 2);
    });
  });

  it("E: primary before headers timeout → primary_headers_received=false", async () => {
    const obs = resolvePrimaryTimeoutObservability(
      Object.assign(new Error("headers deadline exceeded"), {
        trigger: "headers_timeout",
      }),
      15_000
    );
    assert.equal(obs.primary_headers_received, false);
    assert.equal(obs.primary_http_status, null);
    assert.equal(obs.primary_timeout_stage, "headers");

    await withKeys(async () => {
      const telemetry = await captureProviderTelemetry(async () => {
        await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "inst-e",
          deps: {
            fetchCompletion: async (fetchOpts) => {
              if (String(fetchOpts.request.endpoint).includes("cheaperinference")) {
                throw Object.assign(new Error("headers deadline exceeded"), {
                  trigger: "headers_timeout",
                });
              }
              return {
                response: completion(providerEnvelope(validJson)),
                latencyMs: 120,
              };
            },
          },
        });
      });
      assert.ok(telemetry);
      assert.equal(telemetry?.primary_headers_received, false);
      assert.equal(telemetry?.primary_timeout_stage, "headers");
      assert.equal(telemetry?.provider_attempt_count, 2);
    });
  });

  it("logs sanitized backup shape fields without suggestion body text", () => {
    const lines: string[] = [];
    const previous = console.info;
    console.info = ((label: unknown, payload: Record<string, unknown>) => {
      lines.push(`${String(label)} ${JSON.stringify(payload)}`);
    }) as typeof console.info;
    try {
      logTrpgReplySuggestionProviderTelemetry({
        logical_request_id: "req-log",
        round_id: 83,
        primary_provider: "cheaperinference",
        primary_status: null,
        primary_latency_ms: null,
        primary_failure_class: "body_timeout",
        semantic_failure_class: "malformed_json",
        fallback_attempted: true,
        fallback_provider: "openrouter",
        fallback_model: "deepseek/deepseek-v4-flash-0731",
        fallback_latency_ms: 4578,
        fallback_success: false,
        provider_attempt_count: TRPG_REPLY_SUGGESTION_PROVIDER_ATTEMPTS_MAX,
        fallback_status: 200,
        fallback_finish_reason: "stop",
        fallback_output_tokens: 12,
        fallback_has_choices: true,
        fallback_content_kind: "string",
        fallback_parse_stage: "json_parse",
        primary_headers_received: true,
        primary_http_status: 200,
        primary_elapsed_ms: 15001,
        primary_timeout_stage: "body",
      });
    } finally {
      console.info = previous;
    }
    const joined = lines.join("\n");
    assert.match(joined, /"fallback_parse_stage":"json_parse"/);
    assert.match(joined, /"primary_headers_received":true/);
    assert.doesNotMatch(joined, /부상자/);
    assert.doesNotMatch(joined, /PERSONA_DESC/);
    assert.doesNotMatch(joined, /"stage":/);
  });

  it("integration: backup malformed_json path records shape telemetry and keeps two attempts", async () => {
    await withKeys(async () => {
      const urls: string[] = [];
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) {
          throw Object.assign(new Error("body completion deadline exceeded"), {
            trigger: "body_timeout",
            httpStatus: 200,
          });
        }
        return completion(providerEnvelope("{bad-json", { completion_tokens: 9 }));
      }) as typeof fetch;
      try {
        const telemetry = await captureProviderTelemetry(async () => {
          await executeTrpgReplySuggestionProviderRound({
            system: "sys",
            user: "user",
            logicalRequestId: "inst-malformed",
          });
        });
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.equal(telemetry?.fallback_status, 200);
        assert.equal(telemetry?.fallback_parse_stage, "json_parse");
        assert.equal(telemetry?.semantic_failure_class, "malformed_json");
        assert.equal(telemetry?.provider_attempt_count, 2);
        assert.equal(telemetry?.fallback_output_tokens, 9);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });
});
