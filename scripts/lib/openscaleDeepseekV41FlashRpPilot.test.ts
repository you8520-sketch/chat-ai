import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import {
  adaptOpenScalePilotBody,
  buildOpenScalePilotAssembly,
  estimateOpenScaleUsd,
  OPENSCALE_CATALOG_RATES,
  OPENSCALE_CHAT_ENDPOINT,
  OPENSCALE_KEY_ENV,
  OPENSCALE_OFFICIAL_MODEL_ID,
  OPENSCALE_PILOT_SCREENING_BUDGET_USD,
  parseOpenScaleFlashCatalog,
  redactSecretText,
  resolveOpenScalePilotKey,
  runOpenScaleModelsPrevalidation,
  runOpenScaleRpPilot,
  screeningEstimateFromAssembly,
} from "./openscaleDeepseekV41FlashRpPilot";

const POLICY_IMPORT = "./src/lib/test/regularTestEgressPolicy.ts";

function catalogPayload() {
  return {
    data: [
      {
        id: OPENSCALE_OFFICIAL_MODEL_ID,
        is_ready: true,
        input_modalities: [
          {
            type: "text",
            pricing: [
              { type: "prompt", unit: "token", cost_usd: "0.00000006" },
              { type: "cached_prompt", unit: "token", cost_usd: "0.000000003" },
            ],
          },
        ],
        output_modalities: [
          {
            type: "text",
            streaming: true,
            supported_parameters: {
              reasoning_effort: {
                type: "enum",
                values: ["none", "low"],
              },
            },
            pricing: [{ type: "completion", unit: "token", cost_usd: "0.00000024" }],
          },
        ],
      },
    ],
  };
}

function sseResponse(text: string, usage?: Record<string, unknown>) {
  const events = [
    `data: ${JSON.stringify({
      id: "synthetic-os",
      model: OPENSCALE_OFFICIAL_MODEL_ID,
      choices: [{ delta: { content: text } }],
    })}\n`,
    `data: ${JSON.stringify({
      choices: [{ finish_reason: "stop", delta: {} }],
      usage: usage ?? {
        prompt_tokens: 1200,
        completion_tokens: 800,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    })}\n`,
    "data: [DONE]\n",
  ].join("");
  return new Response(events, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("OpenScale DeepSeek V4.1 Flash isolated RP pilot", () => {
  it("never falls back to CheaperInference or other production keys", () => {
    const blocked = resolveOpenScalePilotKey({
      CHEAPER_INFERENCE_API_KEY: "ci-prod",
      CHEAPER_INFERENCE_BENCHMARK_API_KEY: "ci-bench",
      OPENROUTER_API_KEY: "or-prod",
      OPENAI_API_KEY: "oai-prod",
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) throw new Error("expected blocked");
    assert.equal(blocked.reason, "openscale_key_missing");
    const ok = resolveOpenScalePilotKey({ [OPENSCALE_KEY_ENV]: "openscale-only" });
    assert.equal(ok.ok, true);
  });

  it("does not add OpenScale to the production model picker", () => {
    assert.ok(
      MAIN_RP_USER_SELECTABLE_OPTIONS.every((option) => option.provider !== ("openscale" as string))
    );
    assert.ok(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((option) => option.id === "deepseek-v4.1-flash")
    );
  });

  it("parses the official catalog model id and token prices", () => {
    const catalog = parseOpenScaleFlashCatalog(catalogPayload());
    assert.equal(catalog.modelId, OPENSCALE_OFFICIAL_MODEL_ID);
    assert.equal(catalog.inputUsdPerMillion, 0.06);
    assert.equal(catalog.cachedInputUsdPerMillion, 0.003);
    assert.equal(catalog.outputUsdPerMillion, 0.24);
    assert.equal(catalog.streaming, true);
    assert.deepEqual(catalog.reasoningEffortValues, ["none", "low"]);
  });

  it("keeps production sampling and omits a forced max_tokens ceiling", () => {
    const assembly = buildOpenScalePilotAssembly();
    assert.equal(assembly.fixtureId, "B03a");
    assert.equal(assembly.candidateBody.model, OPENSCALE_OFFICIAL_MODEL_ID);
    assert.equal(assembly.candidateBody.stream, true);
    assert.equal(assembly.candidateBody.max_tokens, undefined);
    assert.equal(assembly.productionRequestBody.max_tokens, undefined);
    assert.equal(assembly.candidateBody.temperature, 0.92);
    assert.equal(assembly.candidateBody.top_p, 0.92);
    assert.equal(assembly.candidateBody.reasoning_effort, "none");
    assert.equal("thinking" in assembly.candidateBody, false);
    assert.ok(Array.isArray(assembly.candidateBody.messages));
    const screening = screeningEstimateFromAssembly(assembly.estimatedPromptTokens);
    assert.equal(screening.underScreeningBudget, true);
    assert.ok(screening.estimatedUsd < OPENSCALE_PILOT_SCREENING_BUDGET_USD);
  });

  it("does not treat a screening estimate as an invoice cap", () => {
    const usd = estimateOpenScaleUsd({
      promptTokens: 10_000,
      cachedTokens: 2_000,
      outputTokens: 4_000,
      rates: OPENSCALE_CATALOG_RATES,
    });
    assert.ok(usd < 0.01);
    assert.match(
      screeningEstimateFromAssembly(1000).note,
      /not an invoice/i
    );
  });

  it("redacts secrets from stored text", () => {
    assert.equal(
      redactSecretText("Bearer secret-key and secret-key", ["secret-key"]),
      "Bearer [REDACTED] and [REDACTED]"
    );
  });

  it("stops after GET /v1/models auth failure without a generation POST", async () => {
    let posts = 0;
    const result = await runOpenScaleRpPilot({
      env: { [OPENSCALE_KEY_ENV]: "synthetic-os", OPENSCALE_RP_PILOT: "1" },
      allowLivePost: true,
      fetchImpl: async (url, init) => {
        if (String(init?.method ?? "GET").toUpperCase() === "POST") posts += 1;
        assert.match(String(url), /\/models$/);
        return new Response(JSON.stringify({ error: { message: "unauthorized" } }), {
          status: 401,
        });
      },
    });
    assert.equal(result.status, "PREVALIDATION_FAILED");
    assert.equal(result.providerInferencePosts, 0);
    assert.equal(result.stopReason, "auth_or_billing_401");
    assert.equal(posts, 0);
  });

  it("does not POST when live opt-in is absent", async () => {
    let posts = 0;
    const result = await runOpenScaleRpPilot({
      env: { [OPENSCALE_KEY_ENV]: "synthetic-os" },
      fetchImpl: async (url, init) => {
        if (String(init?.method ?? "GET").toUpperCase() === "POST") posts += 1;
        return new Response(JSON.stringify(catalogPayload()), { status: 200 });
      },
    });
    assert.equal(result.status, "BLOCKED_OPT_IN");
    assert.equal(result.providerInferencePosts, 0);
    assert.equal(posts, 0);
  });

  it("records one mocked stream without retry or CI fallback", async () => {
    const calls: string[] = [];
    const result = await runOpenScaleRpPilot({
      env: {
        [OPENSCALE_KEY_ENV]: "synthetic-os",
        OPENSCALE_RP_PILOT: "1",
        CHEAPER_INFERENCE_API_KEY: "must-not-be-used",
      },
      allowLivePost: true,
      fetchImpl: async (url, init) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        calls.push(`${method} ${String(url)}`);
        if (method === "GET") {
          return new Response(JSON.stringify(catalogPayload()), { status: 200 });
        }
        assert.equal(String(url), OPENSCALE_CHAT_ENDPOINT);
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        assert.equal(body.model, OPENSCALE_OFFICIAL_MODEL_ID);
        assert.equal(body.max_tokens, undefined);
        return sseResponse("한서린은 버튼을 보고 짧게 고개를 끄덕였다.");
      },
    });
    assert.equal(result.status, "LIVE_COMPLETED");
    assert.equal(result.providerInferencePosts, 1);
    assert.equal(calls.filter((row) => row.startsWith("POST")).length, 1);
    assert.ok(!calls.some((row) => row.includes("cheaperinference")));
    assert.equal(result.rawOutput, "한서린은 버튼을 보고 짧게 고개를 끄덕였다.");
    assert.equal(result.finishReason, "stop");
  });

  it("treats GET /v1/models as zero inference POSTs", async () => {
    const result = await runOpenScaleModelsPrevalidation({
      env: { [OPENSCALE_KEY_ENV]: "synthetic-os" },
      fetchImpl: async () =>
        new Response(JSON.stringify(catalogPayload()), { status: 200 }),
    });
    assert.equal(result.status, "PREVALIDATION_ONLY");
    assert.equal(result.providerInferencePosts, 0);
    assert.equal(result.catalog?.modelId, OPENSCALE_OFFICIAL_MODEL_ID);
  });

  it("strips OPENSCALE_KEY in the regular-test egress policy", () => {
    const policy = readFileSync(POLICY_IMPORT, "utf8");
    assert.match(policy, /delete process\.env\.OPENSCALE_KEY/);
    const out = execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--import",
        POLICY_IMPORT,
        "-e",
        "console.log(JSON.stringify({ os: process.env.OPENSCALE_KEY ?? null, ci: process.env.CHEAPER_INFERENCE_API_KEY ?? null }))",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OPENSCALE_KEY: "must-be-stripped",
          CHEAPER_INFERENCE_API_KEY: "must-be-stripped",
        },
        encoding: "utf8",
      }
    );
    const seen = JSON.parse(out.trim()) as { os: string | null; ci: string | null };
    assert.equal(seen.os, null);
    assert.equal(seen.ci, null);
  });

  it("preserves production prompt text while remapping only the wire model", () => {
    const assembly = buildOpenScalePilotAssembly();
    const remapped = adaptOpenScalePilotBody(assembly.productionRequestBody);
    const original = assembly.productionRequestBody.messages as Array<{
      role: string;
      content: unknown;
    }>;
    const remappedMessages = remapped.messages as Array<{ role: string; content: string }>;
    assert.equal(remappedMessages.length, original.length);
    assert.equal(remapped.model, OPENSCALE_OFFICIAL_MODEL_ID);
    assert.notEqual(assembly.productionRequestBody.model, OPENSCALE_OFFICIAL_MODEL_ID);
    assert.ok(remappedMessages.some((message) => message.content.includes("한서린")));
    assert.ok(remappedMessages.some((message) => message.content.includes("엘리베이터")));
  });
});
