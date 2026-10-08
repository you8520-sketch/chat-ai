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
import { after, before, describe, it } from "node:test";
import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import { MAIN_RP_USER_SELECTABLE_OPTIONS } from "@/lib/chatModels";
import { RP_QUALITY_PAID_PRODUCTION_KEY_ENVS } from "@/lib/rpQualityPaidRunner";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { buildContext } from "@/services/contextBuilder";
import {
  AB_ANSWER_KEY,
  AB_CALL_PLAN,
  buildOracleDiagnosticMemory,
} from "./memory50TurnAbAnswerKey";
import {
  AB_CHARACTER_CARD,
  AB_CHARACTER_NAME,
  AB_PERSONA_CARD,
  AB_PERSONA_NAME,
  AB_PROBES,
  AB_SCRIPT,
} from "./memory50TurnAbScript";
import {
  AB_COMPLETED_TURNS,
  AB_EXPERIMENT_SCOPE,
  AB_LIVE_MODEL_IDS,
  AB_RUNNER_MODE,
  attemptHarborAbPaidExecute,
  cleanupHarborExperimentChat,
  describePrepAssemblyLimit,
  evaluateHarborAbGate,
  harborCharacterChunks,
  runHarborAbDryRun,
} from "./memory50TurnAbRunner";
import { ARCHIVE_CAPACITY_FIXED, MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { __setSummarizeTurnBatchCallerForTests } from "./memory-rolling-summary";

before(() => installIsolatedTestDatabase());
after(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  cleanupHarborExperimentChat();
  uninstallIsolatedTestDatabase();
});

describe("50-turn memory A/B runner preflight (provider-free)", () => {
  it("locks the #1467 empty-A assembly as not an operational A/B", () => {
    const limit = describePrepAssemblyLimit();
    assert.equal(limit.longTermMemory, null);
    assert.equal(limit.summarizedTurnCount, 0);
    assert.equal(limit.isOperationalAb, false);

    const rawHistory = AB_SCRIPT.filter((turn) => turn.turn >= 47).flatMap((turn) => [
      { role: "user" as const, content: turn.user },
      { role: "assistant" as const, content: turn.assistant },
    ]);
    const armA = buildContext({
      charName: AB_CHARACTER_NAME,
      chunks: harborCharacterChunks(),
      userNickname: AB_PERSONA_NAME,
      userPersona: AB_PERSONA_CARD,
      longTermMemory: null,
      shortTermHistory: rawHistory,
      currentUserMessage: AB_PROBES[0]!.user,
      nsfw: false,
      provider: "cheaperinference",
      modelId: "deepseek-v4.1-flash",
      completedTurns: 50,
      summarizedTurnCount: 0,
    });
    const armB = buildContext({
      charName: AB_CHARACTER_NAME,
      chunks: harborCharacterChunks(),
      userNickname: AB_PERSONA_NAME,
      userPersona: AB_PERSONA_CARD,
      longTermMemory: buildOracleDiagnosticMemory(),
      shortTermHistory: rawHistory,
      currentUserMessage: AB_PROBES[0]!.user,
      nsfw: false,
      provider: "cheaperinference",
      modelId: "deepseek-v4.1-flash",
      completedTurns: 50,
      summarizedTurnCount: 0,
    });
    const sectionA = (armA.meta.trackedSections ?? []).find((section) => section.id === "current-memory");
    const sectionB = (armB.meta.trackedSections ?? []).find((section) => section.id === "current-memory");
    assert.equal(sectionA, undefined);
    assert.equal(sectionB?.text.includes("[진단 메모]"), true);
    assert.equal(armA.systemPrompt.includes("시 의회에는 넘기지"), false);
    assert.equal(
      AB_ANSWER_KEY.some((fact) => fact.oracleText != null && armA.systemPrompt.includes(fact.oracleText)),
      false
    );
  });

  it("blocks paid posts and duplicate retry before any provider call", () => {
    assert.equal(AB_RUNNER_MODE, "DRY_RUN_ONLY");
    const dry = evaluateHarborAbGate({
      mode: "DRY_RUN_ONLY",
      runnerRetry: 0,
      allowFallback: false,
      useProductionKey: false,
      useChatRoute: false,
      summarizer: "extractive_fake",
    });
    assert.equal(dry.ok, true);
    assert.equal(dry.paidPostsAllowed, 0);

    const paid = attemptHarborAbPaidExecute({
      mode: "AUTHORIZED_PAID",
      userCostApproved: true,
      runnerRetry: 0,
      allowFallback: false,
      useProductionKey: false,
      useChatRoute: false,
      summarizer: "live_luna",
    });
    assert.equal(paid.executed, false);
    assert.equal(paid.paidPosts, 0);
    assert.equal(paid.gate.ok, false);
    assert.equal(paid.gate.reason, "AUTHORIZED_MODE_NOT_SHIPPED");

    assert.equal(evaluateHarborAbGate({ mode: "DRY_RUN_ONLY", runnerRetry: 1 }).reason, "EXTERNAL_RUNNER_RETRY_FORBIDDEN");
    assert.equal(evaluateHarborAbGate({ mode: "DRY_RUN_ONLY", allowFallback: true }).reason, "FALLBACK_FORBIDDEN");
    assert.equal(evaluateHarborAbGate({ mode: "DRY_RUN_ONLY", useProductionKey: true }).reason, "PRODUCTION_KEY_FORBIDDEN");
    assert.equal(evaluateHarborAbGate({ mode: "DRY_RUN_ONLY", useChatRoute: true }).reason, "CHAT_ROUTE_FORBIDDEN");
    assert.equal(evaluateHarborAbGate({ mode: "DRY_RUN_ONLY", summarizer: "live_luna" }).reason, "LIVE_SUMMARIZER_NOT_APPROVED");
    assert.equal(
      evaluateHarborAbGate({
        mode: "DRY_RUN_ONLY",
        experimentSecret: "sk-production-lookalike",
        env: { CHEAPER_INFERENCE_API_KEY: "sk-production-lookalike" },
      }).reason,
      "PRODUCTION_KEY_FORBIDDEN"
    );
    for (const key of RP_QUALITY_PAID_PRODUCTION_KEY_ENVS) {
      assert.equal(
        evaluateHarborAbGate({
          mode: "DRY_RUN_ONLY",
          env: { [key]: "present" },
        }).reason,
        "PRODUCTION_KEY_FORBIDDEN",
        key
      );
    }
  });

  it("aborts A-arm assembly when summaries are empty", async () => {
    const aborted = await runHarborAbDryRun({ summarizer: "empty", refreshTurn1: false });
    assert.equal(aborted.status, "NOT_READY");
    assert.equal(aborted.abortReason, "EMPTY_OR_INCOMPLETE_SUMMARY");
    assert.equal(aborted.assemblies.length, 0);
    assert.equal(aborted.paidPosts, 0);
    assert.equal(aborted.frontier, 0);
  });

  it("seals 10 batches and assembles A from stored memory, B from oracle only", async () => {
    assert.equal(AI_LEARNING_LIMIT, 10000);
    assert.equal(MEMORY_CAPACITY_FIXED, 10000);
    assert.equal(ARCHIVE_CAPACITY_FIXED, 3000);
    assert.equal(AB_EXPERIMENT_SCOPE, "summary_only");
    assert.deepEqual(
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => option.id),
      [...AB_LIVE_MODEL_IDS]
    );

    const result = await runHarborAbDryRun();
    assert.equal(result.status, "READY", result.abortReason ?? "not ready");
    assert.equal(result.paidPosts, 0);
    assert.equal(result.transportPosts, 0);
    assert.equal(result.sealedRounds, 10);
    assert.equal(result.frontier, AB_COMPLETED_TURNS);
    assert.equal(result.rawPool, 4);
    assert.equal(result.excludeTurnStartGte, 47);
    assert.equal(result.projectionKind, "exact");
    assert.equal(result.reconnectMatched, true);
    assert.equal(result.regenKeptPromise, true);
    assert.equal(result.ledgerEmpty, true);
    assert.equal(result.oracleWrittenToDb, false);
    assert.equal(result.answerKeyLeakedIntoArmA, false);
    assert.equal(result.prepAssemblyIsOperationalAb, false);
    assert.equal(result.liveCanonBound, false);
    assert.equal(result.summarizerCalls, 11);

    const currentFacts = ["promise", "world", "relationship_new", "latest_state", "invalidated_relationship", "unresolved_goal"] as const;
    for (const id of currentFacts) {
      const trace = result.traces.find((row) => row.id === id);
      assert.ok(trace, id);
      assert.equal(trace!.inRawHistory, false, id);
      assert.equal(trace!.inStoredSummary, true, id);
      assert.equal(trace!.inGlobalExact, true, id);
      assert.equal(trace!.inArmA, true, id);
      assert.equal(trace!.oracleWrittenToDb, false, id);
    }
    const old = result.traces.find((row) => row.id === "npc_old");
    assert.equal(old?.inRawHistory, false);
    assert.equal(old?.inStoredSummary, true);
    assert.equal(old?.inGlobalExact, true);
    assert.equal(old?.inArmB, false);
    const never = result.traces.find((row) => row.id === "never_given");
    assert.equal(never?.inStoredSummary, false);
    assert.equal(never?.inArmA, false);
    assert.equal(never?.inArmB, false);

    const armA = result.assemblies.filter((row) => row.arm === "A");
    const armB = result.assemblies.filter((row) => row.arm === "B");
    assert.equal(armA.length, AB_CALL_PLAN.rpPlannedCalls / 2);
    assert.equal(armB.length, AB_CALL_PLAN.rpPlannedCalls / 2);
    for (const row of armA) {
      assert.equal(row.summarizedTurnCount, 50, row.modelId);
      assert.equal(row.truncatedMemory, false, row.modelId);
      assert.equal(row.hasCurrentMemory, true, row.modelId);
      assert.equal(row.hasOracleHeader, false, row.modelId);
    }
    for (const row of armB) {
      assert.equal(row.summarizedTurnCount, 50, row.modelId);
      assert.equal(row.hasOracleHeader, true, `${row.modelId} ${row.probeId}`);
      const pair = armA.find((left) => left.modelId === row.modelId && left.probeId === row.probeId);
      assert.equal(pair?.historyFingerprint, row.historyFingerprint, `${row.modelId} ${row.probeId}`);
    }
    assert.equal(
      result.cost.rpByModel.reduce((sum, row) => sum + row.calls, 0),
      AB_CALL_PLAN.rpPlannedCalls
    );
    assert.equal(result.cost.hardMaximumUsd, "UNBOUNDED_WITHOUT_RUNNER_OUTPUT_CAP");
    assert.ok(result.cost.expectedUsdAtAim > 0);
    for (const row of result.cost.rpByModel) {
      assert.equal(row.usage.providerRequestId, null);
      assert.equal(row.usage.billedUsd, null);
      assert.ok(AB_LIVE_MODEL_IDS.includes(row.modelId as (typeof AB_LIVE_MODEL_IDS)[number]));
    }

    console.log(
      `MEMORY_50TURN_AB_RUNNER ${JSON.stringify({
        status: result.status,
        frontier: result.frontier,
        paidPosts: result.paidPosts,
        totals: {
          plannedPosts: result.cost.plannedPosts,
          expectedUsdAtAim: result.cost.expectedUsdAtAim,
          contingencyUsd: result.cost.contingencyUsd,
          hardMaximumUsd: result.cost.hardMaximumUsd,
        },
      })}`
    );
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(
        "/opt/cursor/artifacts/memory_50turn_ab_runner.json",
        `${JSON.stringify(
          {
            mainSha: "de60b3510347bca5ca1292d68dc2c92f171579da",
            ...result,
            characterCardChars: AB_CHARACTER_CARD.length,
            scriptTurns: AB_SCRIPT.length,
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    } catch {
      // CI does not need the artifact file.
    }
  });
});
