import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  GEMINI_38_FLASH_MODEL,
  MAIN_RP_MODEL_IDS,
  selectedAIProvider,
} from "@/lib/chatModels";
import {
  buildCanonicalRpQualificationCases,
  buildCanonicalRpQualificationContextInput,
} from "./rpModelQualificationFixture";
import {
  RP_ACTIVE_MODEL_QUALITY_DEFAULT_CASE_IDS,
  RP_ACTIVE_MODEL_QUALITY_EXCLUDED,
  RP_ACTIVE_MODEL_QUALITY_MAX_CALLS,
  RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
  buildRpActiveModelQualityPlan,
  buildRpActiveModelQualityRequest,
  executeRpActiveModelQualityProbe,
} from "./rpActiveModelQualityLive";

describe("rpActiveModelQualityLive", () => {
  it("derives the quality model set exactly from the active Main RP picker", () => {
    assert.deepEqual(RP_ACTIVE_MODEL_QUALITY_MODEL_IDS, MAIN_RP_MODEL_IDS);
    assert.deepEqual(RP_ACTIVE_MODEL_QUALITY_EXCLUDED, []);
  });

  it("can bound a focused false-canon resmoke to the requested active subset", () => {
    const focusedModels = [
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      GEMINI_38_FLASH_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    ] as const;
    const plan = buildRpActiveModelQualityPlan(
      ["false_canon_trap"],
      focusedModels
    );
    assert.equal(plan.length, 4);
    assert.deepEqual(
      plan.map((row) => row.modelId),
      [...focusedModels]
    );
    assert.ok(plan.every((row) => row.caseId === "false_canon_trap"));
  });

  it("bounds the default monthly run to two memory cases across all active models", () => {
    const plan = buildRpActiveModelQualityPlan();
    assert.deepEqual(RP_ACTIVE_MODEL_QUALITY_DEFAULT_CASE_IDS, [
      "memory_current_state_priority",
      "memory_false_shared_event",
    ]);
    assert.equal(
      plan.length,
      MAIN_RP_MODEL_IDS.length * RP_ACTIVE_MODEL_QUALITY_DEFAULT_CASE_IDS.length
    );
    assert.ok(plan.length <= RP_ACTIVE_MODEL_QUALITY_MAX_CALLS);
    for (const modelId of RP_ACTIVE_MODEL_QUALITY_MODEL_IDS) {
      assert.deepEqual(
        plan.filter((row) => row.modelId === modelId).map((row) => row.caseId),
        [...RP_ACTIVE_MODEL_QUALITY_DEFAULT_CASE_IDS]
      );
    }
  });

  it("builds memory-continuity cases through the canonical memory input layers", () => {
    const cases = new Map(buildCanonicalRpQualificationCases().map((entry) => [entry.id, entry]));
    const stateCase = cases.get("memory_current_state_priority")!;
    const falseShared = cases.get("memory_false_shared_event")!;

    const stateContext = buildCanonicalRpQualificationContextInput({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      caseData: stateCase,
      provider: "cheaperinference",
    });
    assert.match(stateContext.longTermMemory ?? "", /약속은 이미 이행되어 종료/);
    assert.match(stateContext.memoryMeta ?? "", /다음 정기 검진 날 넥서스 로비/);

    const falseSharedContext = buildCanonicalRpQualificationContextInput({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      caseData: falseShared,
      provider: "cheaperinference",
    });
    assert.match(falseSharedContext.episodicMemoryBlock ?? "", /복잡한 단말기를 잘못 조작/);
    assert.doesNotMatch(falseSharedContext.episodicMemoryBlock ?? "", /반지/);
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

  it("schedules only the bounded memory evidence while PR live calls remain opt-in", () => {
    const yml = readFileSync(".github/workflows/validate-rp-active-model-quality.yml", "utf8");
    assert.match(yml, /cron: "17 4 4 \* \*"/);
    assert.match(
      yml,
      /RP_ACTIVE_MODEL_QUALITY_CASE_IDS=memory_current_state_priority,memory_false_shared_event/
    );
    assert.match(yml, /github\.event_name == 'schedule'/);
    assert.match(yml, /\.github\/rp-active-model-quality-live\.trigger/);
    assert.match(yml, /RP_ACTIVE_MODEL_QUALITY_MODEL_IDS_OVERRIDE/);
    assert.match(yml, /PR trigger absent; provider calls=0/);
    assert.doesNotMatch(yml, /gh pr merge|--auto\b|ready-for-review/);
  });

  it("parses one bounded fake SSE generation without retry/fallback", async () => {
    const caseData = buildCanonicalRpQualificationCases()[1]!;
    const probe = buildRpActiveModelQualityPlan([caseData.id]).find(
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
