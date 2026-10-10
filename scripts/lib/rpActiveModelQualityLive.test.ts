import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
  MAIN_RP_MODEL_IDS,
  selectedAIProvider,
} from "@/lib/chatModels";
import { MainRpStyleLengthFixtureError } from "@/lib/rpMainRpStyleLengthFixture";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
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
  renderRpActiveModelQualityMarkdown,
  resolveRpActiveModelQualitySource,
  runRpActiveModelQualityLive,
} from "./rpActiveModelQualityLive";

describe("rpActiveModelQualityLive", () => {
  it("derives the quality model set exactly from the active Main RP picker", () => {
    assert.deepEqual(RP_ACTIVE_MODEL_QUALITY_MODEL_IDS, MAIN_RP_MODEL_IDS);
    assert.deepEqual(RP_ACTIVE_MODEL_QUALITY_EXCLUDED, []);
  });

  it("can bound a focused false-canon resmoke to the requested active subset", () => {
    const focusedModels = [
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      GEMINI_38_FLASH_MODEL,
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    ] as const;
    const plan = buildRpActiveModelQualityPlan(
      ["false_canon_trap"],
      focusedModels,
      "HISTORICAL_ONLY"
    );
    assert.equal(plan.length, 4);
    assert.deepEqual(
      plan.map((row) => row.modelId),
      [...focusedModels]
    );
    assert.ok(plan.every((row) => row.caseId === "false_canon_trap"));
  });

  it("bounds the default monthly run to two memory cases across all active models", () => {
    const plan = buildRpActiveModelQualityPlan(
      RP_ACTIVE_MODEL_QUALITY_DEFAULT_CASE_IDS,
      RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
      "HISTORICAL_ONLY"
    );
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
        source: "HISTORICAL_ONLY",
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
    assert.match(yml, /RP_ACTIVE_MODEL_QUALITY_SOURCE: HISTORICAL_ONLY/);
    assert.doesNotMatch(yml, /gh pr merge|--auto\b|ready-for-review/);
  });

  it("does not title HISTORICAL_ONLY evidence as current-site memory quality", () => {
    const markdown = renderRpActiveModelQualityMarkdown({
      version: 2,
      generatedAt: "2026-10-10T00:00:00.000Z",
      source: CANONICAL_RP_QUALIFICATION_SOURCE,
      modelIds: RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
      excludedModels: RP_ACTIVE_MODEL_QUALITY_EXCLUDED,
      ordinaryInputAuthoringLevel: "NORMAL",
      providerCalls: 0,
      maxProviderCalls: RP_ACTIVE_MODEL_QUALITY_MAX_CALLS,
      qualityScoreGenerated: false,
      results: [],
      notes: ["HISTORICAL_ONLY: 2026-08-25 character id=10 dump."],
      memoryEvidenceProvenance: "HISTORICAL_ONLY",
      canClaimCurrentLiveProvider: false,
    });
    assert.match(markdown, /^# HISTORICAL_ONLY memory evidence — not current-site quality/m);
    assert.match(markdown, /memory evidence provenance: \*\*HISTORICAL_ONLY\*\*/);
    assert.match(markdown, /character: id=10/);
    assert.match(markdown, /CURRENT_LIVE_PROVIDER claim: \*\*false\*\*/);
    assert.doesNotMatch(markdown, /# Active Main RP — Human Quality Review Evidence/);
  });

  it("keeps Phase 1 retrieve fixtures in research and episodic CI gates", () => {
    const research = readFileSync(".github/workflows/memory-research-cycle.yml", "utf8");
    const episodic = readFileSync(".github/workflows/validate-memory-episodic.yml", "utf8");
    assert.match(research, /monthlyRpMemoryQualityPhase1\.test\.ts/);
    assert.match(research, /memoryEvidenceProvenance\.test\.ts/);
    assert.match(episodic, /monthlyRpMemoryQualityPhase1\.test\.ts/);
    assert.match(episodic, /memoryEvidenceProvenance\.test\.ts/);
  });

  it("parses one bounded fake SSE generation without retry/fallback", async () => {
    const caseData = buildCanonicalRpQualificationCases()[1]!;
    const probe = buildRpActiveModelQualityPlan(
      [caseData.id],
      RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
      "HISTORICAL_ONLY"
    ).find(
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
      source: "HISTORICAL_ONLY",
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

  it("connects MAIN_RP_STYLE_LENGTH to a Golden snapshot instead of throwing only", async () => {
    assert.equal(resolveRpActiveModelQualitySource("GOLDEN_SNAPSHOT"), "GOLDEN_SNAPSHOT");
    const previous = process.env.MAIN_RP_STYLE_LENGTH;
    process.env.MAIN_RP_STYLE_LENGTH = "1";
    try {
      assert.equal(resolveRpActiveModelQualitySource(), "GOLDEN_SNAPSHOT");
      await assert.rejects(
        () =>
          runRpActiveModelQualityLive({
            credentials: { cheaperinference: "", openrouter: "" },
            runId: "style-length-missing-golden",
            source: "GOLDEN_SNAPSHOT",
            goldenRoot: "/tmp/main-rp-style-length-missing",
            goldenVersion: 1,
          }),
        (error: unknown) =>
          error instanceof MainRpStyleLengthFixtureError && error.code === "GOLDEN_VERSION_MISSING"
      );
    } finally {
      if (previous == null) delete process.env.MAIN_RP_STYLE_LENGTH;
      else process.env.MAIN_RP_STYLE_LENGTH = previous;
    }
  });

  it("fail-before A: omitted source without MAIN_RP_STYLE_LENGTH rejects historical id10", () => {
    assert.throws(
      () => resolveRpActiveModelQualitySource(undefined, {}),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "HISTORICAL_ID10_REJECTED"
    );
    assert.throws(
      () => buildRpActiveModelQualityPlan(),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "HISTORICAL_ID10_REJECTED"
    );
    const previous = process.env.MAIN_RP_STYLE_LENGTH;
    process.env.MAIN_RP_STYLE_LENGTH = "1";
    try {
      assert.throws(
        () => buildRpActiveModelQualityPlan(),
        (error: unknown) =>
          error instanceof MainRpStyleLengthFixtureError && error.code === "HISTORICAL_ID10_REJECTED"
      );
    } finally {
      if (previous == null) delete process.env.MAIN_RP_STYLE_LENGTH;
      else process.env.MAIN_RP_STYLE_LENGTH = previous;
    }
  });
});
