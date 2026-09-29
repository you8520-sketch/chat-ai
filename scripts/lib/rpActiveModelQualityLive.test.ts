import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  selectedAIProvider,
} from "@/lib/chatModels";
import {
  buildCanonicalRpQualificationCases,
  buildCanonicalRpQualificationContextInput,
} from "./rpModelQualificationFixture";
import {
  RP_ACTIVE_MODEL_QUALITY_EXCLUDED,
  RP_ACTIVE_MODEL_QUALITY_MAX_CALLS,
  RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
  buildRpActiveModelQualityPlan,
  buildRpActiveModelQualityRequest,
  executeRpActiveModelQualityProbe,
} from "./rpActiveModelQualityLive";

describe("rpActiveModelQualityLive", () => {
  it("qualifies only the three requested models this round", () => {
    assert.deepEqual(RP_ACTIVE_MODEL_QUALITY_MODEL_IDS, [
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    ]);
    assert.equal(
      RP_ACTIVE_MODEL_QUALITY_MODEL_IDS.includes(
        CHEAPER_INFERENCE_GPT_56_TERRA_MODEL as never
      ),
      false
    );
    assert.equal(
      RP_ACTIVE_MODEL_QUALITY_MODEL_IDS.includes(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL as never
      ),
      false
    );
    assert.deepEqual(
      RP_ACTIVE_MODEL_QUALITY_EXCLUDED.map((row) => row.modelId),
      [
        CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      ]
    );
  });

  it("can bound a focused false-canon resmoke to exactly three calls", () => {
    const plan = buildRpActiveModelQualityPlan(["false_canon_trap"]);
    assert.equal(plan.length, 3);
    assert.deepEqual(
      plan.map((row) => row.caseId),
      ["false_canon_trap", "false_canon_trap", "false_canon_trap"]
    );
  });

  it("bounds the initial run to one call per model/case", () => {
    const plan = buildRpActiveModelQualityPlan();
    assert.equal(plan.length, 12);
    assert.equal(plan.length, RP_ACTIVE_MODEL_QUALITY_MAX_CALLS);
    for (const modelId of RP_ACTIVE_MODEL_QUALITY_MODEL_IDS) {
      assert.equal(plan.filter((row) => row.modelId === modelId).length, 4);
    }
  });

  it("uses the current NORMAL ordinary-input authoring scope", () => {
    const caseData = buildCanonicalRpQualificationCases()[0]!;
    const context = buildCanonicalRpQualificationContextInput({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      caseData,
      provider: "cheaperinference",
    });
    assert.equal(context.currentTurnAuthoringDelegation?.source, "chat_setting");
    assert.equal(context.currentTurnAuthoringDelegation?.allowDialogue, true);
    assert.equal(context.currentTurnAuthoringDelegation?.allowMajorActions, true);
    assert.equal(context.currentTurnAuthoringDelegation?.allowInnerPov, false);
    assert.equal(
      context.currentTurnAuthoringDelegation?.allowIrreversibleFate,
      false
    );
  });

  it("builds the real current-main provider wire for every requested model", () => {
    const caseData = buildCanonicalRpQualificationCases()[0]!;
    for (const modelId of RP_ACTIVE_MODEL_QUALITY_MODEL_IDS) {
      const request = buildRpActiveModelQualityRequest({
        modelId,
        caseData,
        sessionId: "quality-test-session",
      });
      const provider = selectedAIProvider(modelId);
      assert.equal(request.provider, provider);
      assert.equal(request.evidence.provider, provider);
      assert.equal(request.body.stream, true);
      assert.deepEqual(request.body.stream_options, { include_usage: true });
      assert.equal(request.evidence.authoringLevel, "NORMAL");
      assert.equal(request.evidence.targetResponseChars, caseData.targetResponseChars);
      assert.ok(request.evidence.systemPromptChars > 0);
      if (provider === "openrouter") {
        assert.match(request.url, /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions$/);
        assert.match(String(request.body.model), /^google\//);
        assert.ok(request.body.provider);
      } else {
        assert.equal(request.body.model, modelId);
        assert.match(request.url, /^https:\/\/api\.cheaperinference\.com\/v1\/chat\/completions\?/);
      }
    }
  });

  it("parses one bounded fake SSE generation without retry/fallback", async () => {
    const caseData = buildCanonicalRpQualificationCases()[1]!;
    const probe = buildRpActiveModelQualityPlan().find(
      (row) =>
        row.modelId === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL &&
        row.caseId === caseData.id
    )!;

    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      const body = [
        'data: {"id":"gen-test","model":"deepseek-v4.1-flash","choices":[{"delta":{"content":"태형은 고개를 기울였다."},"finish_reason":null}]}',
        'data: {"id":"gen-test","model":"deepseek-v4.1-flash","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":20}}',
        "data: [DONE]",
        "",
      ].join("\n");
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const result = await executeRpActiveModelQualityProbe({
      credentials: {
        cheaperinference: "benchmark-test-key",
        openrouter: "openrouter-test-key",
      },
      probe,
      caseData,
      sessionId: "quality-test-session",
      fetchImpl,
      now: () => 1_000,
    });

    assert.equal(calls, 1);
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.httpStatus, 200);
    assert.equal(result.provider, "cheaperinference");
    assert.equal(result.text, "태형은 고개를 기울였다.");
    assert.equal(result.promptTokens, 100);
    assert.equal(result.completionTokens, 20);
  });
});
