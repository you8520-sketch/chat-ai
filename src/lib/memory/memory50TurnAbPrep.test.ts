import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import { resolveBackgroundPrimaryModelId } from "@/lib/ai";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import { isMainModelRelationshipSelfExtractModel } from "@/lib/relationshipMemoryTailPrompt";
import { estimateTokens, estimateTokensFromCharCount } from "@/lib/tokenEstimate";
import { DEFAULT_USER_AUTHORING_LEVEL } from "@/lib/userAuthoringPolicy";
import { buildContext } from "@/services/contextBuilder";
import {
  AB_ANSWER_KEY,
  AB_CALL_PLAN,
  AB_SYSTEM_DELTA,
  buildOracleDiagnosticMemory,
} from "./memory50TurnAbAnswerKey";
import {
  AB_CHARACTER_CARD,
  AB_CHARACTER_NAME,
  AB_GREETING,
  AB_PERSONA_CARD,
  AB_PERSONA_NAME,
  AB_PROBES,
  AB_SCRIPT,
  AB_SCRIPT_ID,
} from "./memory50TurnAbScript";
import { ARCHIVE_CAPACITY_FIXED, MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import {
  __formatBatchDialogueForTests,
  __setSummarizeTurnBatchCallerForTests,
  buildRollingSummarySystemPrompt,
  summarizeTurnBatch,
} from "./memory-rolling-summary";

const LIVE_MODEL_IDS = [
  "deepseek-v4.1-flash",
  "gemini-3.8-flash",
  "gpt-6.1-sol",
  "claude-opus-5.5",
] as const;

after(() => {
  __setSummarizeTurnBatchCallerForTests(null);
});

function usd(tokens: number, perMillion: number): number {
  return (tokens / 1_000_000) * perMillion;
}

describe("50-turn memory A/B preflight (provider-free)", () => {
  it("builds the script, summary requests, and arm difference without a provider POST", async () => {
    assert.equal(AB_CALL_PLAN.paidPostsExecutedInThisPrep, 0);
    assert.equal(AI_LEARNING_LIMIT, 10000);
    assert.equal(MEMORY_CAPACITY_FIXED, 10000);
    assert.equal(ARCHIVE_CAPACITY_FIXED, 3000);
    assert.ok(AB_CHARACTER_CARD.length < AI_LEARNING_LIMIT);
    assert.equal(DEFAULT_USER_AUTHORING_LEVEL, "NORMAL");
    assert.equal(AB_SCRIPT.length, 50);
    assert.deepEqual(
      AB_SCRIPT.map((turn) => turn.turn),
      Array.from({ length: 50 }, (_, index) => index + 1)
    );
    assert.equal(new Set(AB_SCRIPT.map((turn) => turn.user)).size, 50);
    assert.equal(AB_PROBES.length, AB_CALL_PLAN.probes);
    assert.deepEqual(
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => option.id),
      [...LIVE_MODEL_IDS]
    );
    for (const modelId of LIVE_MODEL_IDS) {
      assert.equal(isMainModelRelationshipSelfExtractModel(modelId), false, modelId);
    }
    assert.equal(resolveBackgroundPrimaryModelId(null), AB_CALL_PLAN.summaryModelDefault);
    assert.equal(resolveBackgroundPrimaryModelId(""), AB_CALL_PLAN.summaryModelDefault);

    const oracle = buildOracleDiagnosticMemory();
    const rawHistory = AB_SCRIPT.filter((turn) => turn.turn >= 47).flatMap((turn) => [
      { role: "user" as const, content: turn.user },
      { role: "assistant" as const, content: turn.assistant },
    ]);
    const rawJoined = rawHistory.map((message) => message.content).join("\n");
    for (const fact of AB_ANSWER_KEY) {
      if (!fact.oracleText) continue;
      assert.equal(rawJoined.includes(fact.oracleText), false, fact.id);
      for (const probe of AB_PROBES) {
        assert.equal(probe.user.includes(fact.oracleText), false, `${fact.id} ${probe.id}`);
      }
    }
    assert.equal(rawJoined.includes("열아홉"), false);
    assert.equal(rawJoined.includes("예비 인장"), false);
    assert.equal(AB_SCRIPT.some((turn) => turn.user.includes("혈연")), false);
    assert.equal(AB_SCRIPT.some((turn) => turn.assistant.includes("혈연")), false);

    const captured: { system: string; user: string; requestKind: string }[] = [];
    __setSummarizeTurnBatchCallerForTests(async (system, history, _trace, requestKind) => {
      captured.push({
        system,
        user: history.map((message) => message.content).join("\n"),
        requestKind,
      });
      throw new Error("DRY_RUN_NO_PROVIDER");
    });

    for (let start = 1; start <= 50; start += 5) {
      const entries = AB_SCRIPT.filter((turn) => turn.turn >= start && turn.turn <= start + 4).map(
        (turn) => ({
          turnIndex: turn.turn,
          turn: { user: turn.user, assistant: turn.assistant },
        })
      );
      const dialogue = __formatBatchDialogueForTests(entries, AB_CHARACTER_NAME);
      const summary = await summarizeTurnBatch({
        dialogue,
        charName: AB_CHARACTER_NAME,
        startTurn: start,
        endTurn: start + 4,
        openingPrelude: start === 1 ? AB_GREETING : null,
        characterIdentity: AB_CHARACTER_CARD,
        userPersona: AB_PERSONA_CARD,
      });
      assert.equal(summary, "");
    }
    __setSummarizeTurnBatchCallerForTests(null);

    assert.equal(captured.length, AB_CALL_PLAN.summaryMaxCallsIfUnmodifiedOwner);
    const firstAttempts = captured.filter((_, index) => index % 3 === 0);
    assert.equal(firstAttempts.length, AB_CALL_PLAN.summaryPlannedCalls);
    assert.equal(firstAttempts[0]?.requestKind, "background-memory-extract");
    assert.equal(captured[1]?.requestKind, "background-memory-extract-retry");
    assert.match(firstAttempts[0]?.system ?? "", /CANONICAL GROUNDING/);
    assert.match(buildRollingSummarySystemPrompt(5), /5턴 히스토리 요약/);
    assert.match(firstAttempts[0]?.system ?? "", /5턴 히스토리 요약/);
    assert.match(firstAttempts[0]?.user ?? "", /시 의회에는 넘기지 않는다/);
    assert.match(firstAttempts[4]?.user ?? "", /서기, 장부만 놓고 가시오/);
    assert.match(firstAttempts[6]?.user ?? "", /밤 나룻배/);
    assert.match(firstAttempts[8]?.user ?? "", /예비 인장/);
    assert.match(firstAttempts[9]?.user ?? "", /열아홉/);

    const chunks = [
      {
        id: "synthetic-core",
        characterId: "synthetic-harbor",
        content: AB_CHARACTER_CARD,
        category: "identity" as const,
        importance: "CRITICAL" as const,
        tokenCount: AB_CHARACTER_CARD.length,
        keywords: [AB_CHARACTER_NAME],
      },
    ];

    const assemblies = [];
    for (const model of MAIN_RP_USER_SELECTABLE_OPTIONS) {
      for (const probe of AB_PROBES) {
        const shared = {
          charName: AB_CHARACTER_NAME,
          chunks,
          userNickname: AB_PERSONA_NAME,
          userPersona: AB_PERSONA_CARD,
          shortTermHistory: rawHistory,
          currentUserMessage: probe.user,
          nsfw: false as const,
          provider: model.provider,
          modelId: model.id,
          completedTurns: 50,
          summarizedTurnCount: 0,
        };
        const armA = buildContext({ ...shared, longTermMemory: null });
        const armB = buildContext({ ...shared, longTermMemory: oracle });
        const historyA = armA.history.map((message) => message.content).join("\n");
        const historyB = armB.history.map((message) => message.content).join("\n");
        assert.equal(historyA, historyB, `${model.id} ${probe.id}`);
        assert.equal(armA.meta.truncatedMemory, false, model.id);
        assert.equal(armB.meta.truncatedMemory, false, model.id);
        assert.equal(armA.systemPrompt.includes(AB_CHARACTER_CARD), true, model.id);
        assert.equal(armB.systemPrompt.includes(AB_CHARACTER_CARD), true, model.id);
        for (const fact of AB_ANSWER_KEY) {
          if (!fact.oracleText) continue;
          assert.equal(armA.systemPrompt.includes(fact.oracleText), false, `${model.id} ${fact.id}`);
          assert.equal(armB.systemPrompt.includes(fact.oracleText), true, `${model.id} ${fact.id}`);
        }
        const sectionA = (armA.meta.trackedSections ?? []).find((section) => section.id === "current-memory");
        const sectionB = (armB.meta.trackedSections ?? []).find((section) => section.id === "current-memory");
        assert.equal(sectionA, undefined);
        assert.equal(sectionB?.text.includes("[진단 메모]"), true);
        assemblies.push({
          modelId: model.id,
          probeId: probe.id,
          armATokens: estimateTokens(armA.systemPrompt) + estimateTokens(historyA),
          armBTokens: estimateTokens(armB.systemPrompt) + estimateTokens(historyB),
        });
      }
    }

    const summaryInputTokens = firstAttempts.reduce(
      (sum, attempt) => sum + estimateTokens(attempt.system) + estimateTokens(attempt.user),
      0
    );
    const summaryOutputTokens = estimateTokensFromCharCount(600);
    const luna = resolveOpenRouterModelRates(AB_CALL_PLAN.summaryModelDefault);
    const aimOutputTokens = estimateTokensFromCharCount(AB_CALL_PLAN.outputAimChars);
    const rpByModel = LIVE_MODEL_IDS.map((modelId) => {
      const rows = assemblies.filter((row) => row.modelId === modelId);
      const calls = rows.length * 2;
      const inputTokens = rows.reduce((sum, row) => sum + row.armATokens + row.armBTokens, 0);
      const outputTokens = calls * aimOutputTokens;
      const pricing = getPublishedPricing(modelId);
      return {
        modelId,
        calls,
        inputTokens,
        outputTokensAtAim: outputTokens,
        provider: MAIN_RP_USER_SELECTABLE_OPTIONS.find((option) => option.id === modelId)?.provider,
        inputUsdPerMillion: pricing.billingReferenceInputUsdPerMillion,
        outputUsdPerMillion: pricing.billingReferenceOutputUsdPerMillion,
        expectedUsdAtAim:
          usd(inputTokens, pricing.billingReferenceInputUsdPerMillion) +
          usd(outputTokens, pricing.billingReferenceOutputUsdPerMillion),
        contingencyUsdAtDoubleOutput:
          usd(inputTokens, pricing.billingReferenceInputUsdPerMillion) +
          usd(outputTokens * 2, pricing.billingReferenceOutputUsdPerMillion),
      };
    });
    const summaryExpectedUsd =
      usd(summaryInputTokens, luna.inputUsdPerM) +
      usd(AB_CALL_PLAN.summaryPlannedCalls * summaryOutputTokens, luna.outputUsdPerM);
    const summaryMaxAttemptUsd =
      usd(summaryInputTokens * 3, luna.inputUsdPerM) +
      usd(AB_CALL_PLAN.summaryMaxCallsIfUnmodifiedOwner * summaryOutputTokens, luna.outputUsdPerM);
    assert.equal(
      rpByModel.reduce((sum, row) => sum + row.calls, 0),
      AB_CALL_PLAN.rpPlannedCalls
    );
    const rpExpectedUsd = rpByModel.reduce((sum, row) => sum + row.expectedUsdAtAim, 0);
    const rpContingencyUsd = rpByModel.reduce((sum, row) => sum + row.contingencyUsdAtDoubleOutput, 0);

    const report = {
      mainSha: "88d277f868c4a445e8dd7d24ea50f322fff1483d",
      scriptId: AB_SCRIPT_ID,
      liveCanonBound: false,
      liveCanonBlocker:
        "LIVE_DEPLOYED_ROW_PROOF is hashes for deploy 2f5cb0b4. Current main was not re-read from /data/app.db. Historical dump hashes do not match that proof.",
      authoringLevel: DEFAULT_USER_AUTHORING_LEVEL,
      contentMode: "safe",
      nsfwListingDoesNotForceAdultRp: true,
      paidPostsExecuted: 0,
      owners: {
        summaryRequest: "summarizeTurnBatch",
        summaryModel: "resolveBackgroundPrimaryModelId",
        assembly: "buildContext",
        publishedPrice: "getPublishedPricing",
        lunaRateSnapshot: "resolveOpenRouterModelRates",
      },
      attributionThisPrep: AB_ANSWER_KEY.map((fact) => ({
        id: fact.id,
        sourceTurn: fact.sourceTurn,
        status: fact.status,
        inRawHistory: fact.oracleText ? rawJoined.includes(fact.oracleText) : false,
        inSummaryRequest: fact.id === "never_given" ? false : "SEE_BATCH_ASSERTIONS",
        storedSummary: "NOT_TESTED",
        persistedDb: "NOT_TESTED",
        armAFinalInput: false,
        armBFinalInput: fact.oracleText != null,
        modelOutput: "NOT_TESTED",
        failureIfModelMissesCurrentFact: "NOT_TESTED",
      })),
      armDifference: {
        sameRawHistory: true,
        sameCharacterCard: true,
        samePersona: true,
        sameProbes: true,
        armALongTermMemory: "empty",
        armBLongTermMemory: "oracle diagnostic text",
        ledgerBothArms: "empty",
        relationshipExtract: "NOT_TESTED",
        semanticEpisodic: "NOT_TESTED",
        unavoidable: [
          "Arm A has no summary text because the summary model was not called.",
          "Arm B is denser than a 600-character rolling summary and is not produced by gpt-6-luna.",
          "Both arms leave the relationship ledger empty. Exact promise removal is not part of this comparison.",
          "Production output has no hard character cap, so the double-aim figure is a runner contingency rather than a platform maximum.",
        ],
      },
      callPlan: AB_CALL_PLAN,
      summaryRequests: {
        plannedCalls: firstAttempts.length,
        capturedAttemptsIncludingUnmodifiedRetry: captured.length,
        inputTokensPlanned: summaryInputTokens,
        outputTokensPerCallAt600Chars: summaryOutputTokens,
        model: AB_CALL_PLAN.summaryModelDefault,
        inputUsdPerMillion: luna.inputUsdPerM,
        outputUsdPerMillion: luna.outputUsdPerM,
        expectedUsd: summaryExpectedUsd,
        unmodifiedRetryUsd: summaryMaxAttemptUsd,
      },
      rpEstimates: rpByModel,
      totals: {
        plannedPosts: AB_CALL_PLAN.plannedPostsIfSingleAttempt,
        expectedUsdAtAim: summaryExpectedUsd + rpExpectedUsd,
        contingencyUsd: summaryMaxAttemptUsd + rpContingencyUsd,
        hardMaximumUsd: "UNBOUNDED_WITHOUT_RUNNER_OUTPUT_CAP",
      },
      systemDelta: AB_SYSTEM_DELTA,
      blocking: {
        duplicateRetryFallback: "Approved runner must call the summary transport once per batch. summarizeTurnBatch itself loops three times.",
        resultStore: "Not created in this prep. A later approved run should write prompts, outputs, and provider usage beside the answer key without mixing them into the script.",
      },
    };
    console.log(`MEMORY_50TURN_AB_PREP ${JSON.stringify(report.totals)}`);
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(
        "/opt/cursor/artifacts/memory_50turn_ab_prep.json",
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );
    } catch {
      // CI does not need the artifact file.
    }
    assert.equal(report.paidPostsExecuted, 0);
    assert.ok(report.totals.expectedUsdAtAim > 0);
  });
});
