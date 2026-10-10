/**
 * #1486 Phase 3A — 6/50-turn Main RP recall preflight.
 * Provider POST 0. Cursor does not score reply quality.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE,
  canClaimCurrentLiveProvider,
  canClaimCurrentProductionParity,
} from "@/lib/memory/memoryEvidenceProvenance";
import { MEMORY_POLICY_ID, RAW_HISTORY_COMPLETE_EXCHANGES } from "@/lib/memory/memory-constants";
import { formatMemoryBlock } from "@/lib/memory/memory-turn-summary";
import {
  PHASE3A_CALL_PLAN,
  PHASE3A_OUT_OF_SCOPE,
  PHASE3A_PHASE2C_EVIDENCE_PATH,
  PHASE3A_REUSED_CONTRASTS,
  PHASE3A_REUSED_PROBES,
  emptyPhase3aGptReviewPacket,
  pathAPassIsNotPathBPass,
  phase3aProvider,
  phase3aReusedPhase2bFactCount,
  phase3aReusedPhase2bTurnCount,
  phase3aWireModelId,
} from "@/lib/memory/monthlyRpMemoryQualityPhase3aPlan";
import { resolveMainRpPrimaryWireModelId } from "@/lib/openRouterConfig";
import { resolveOpenRouterModelRates } from "@/lib/openRouterModelPricing";
import { RP_QUALITY_PRECALL_RAILWAY_HASH_PROBE_CONTRACT } from "@/lib/rpQualityPrecall";
import { estimateTokens } from "@/lib/tokenEstimate";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";

const EXPECTED_MODELS = [
  "deepseek-v4.1-flash",
  "gemini-3.8-flash",
  "gpt-6.1-sol",
  "claude-opus-5.5",
] as const;

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
});

describe("#1486 Phase 3A Main RP recall preflight", () => {
  it("binds the live picker and refuses a paid rerun license", () => {
    assert.deepEqual([...MAIN_RP_MODEL_IDS], [...EXPECTED_MODELS]);
    assert.deepEqual(
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => option.id),
      [...EXPECTED_MODELS]
    );
    assert.equal(MAIN_RP_MODEL_IDS.includes("claude-opus-5" as SelectedAI), false);
    assert.equal(PHASE3A_CALL_PLAN.paidPostsThisPhase, 0);
    assert.equal(PHASE3A_CALL_PLAN.paidEvaluationApproved, false);
    assert.equal(PHASE3A_CALL_PLAN.rerunAuthorized, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.providerPosts, 0);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.paidEvaluationApproved, false);
    assert.equal(canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.provenance), false);
    assert.equal(MEMORY_POLICY_ID, "summary5_raw4");
    assert.equal(RAW_HISTORY_COMPLETE_EXCHANGES, 4);
  });

  it("keeps Path A seeded recall distinct from Path B Luna end-to-end", () => {
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.pathASeededRecall, "NOT_EXECUTED");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.pathBLunaEndToEnd, "NOT_EXECUTED");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.modelReplyQuality, "NOT_PROVEN");
    assert.equal(pathAPassIsNotPathBPass(), false);
    assert.equal(PHASE3A_CALL_PLAN.pathA.lunaPosts, 0);
    assert.equal(PHASE3A_CALL_PLAN.pathA.mainRpPostsIfLaterApproved, 8);
    assert.equal(PHASE3A_CALL_PLAN.pathA.chatGenerationsToBuildHistory, 0);
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.status, "FOLLOW_UP");
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.newLunaPosts, 0);
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.mainRpPostsIfLaterApproved, 0);
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.mustNotUsePhase1AUmbrellaQuery, true);
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.distinctFromPathBFull, true);
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.usesPhase2cSample, true);
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.phase2cRerunAuthorized, false);
    assert.equal(PHASE3A_CALL_PLAN.pathBFull.fiftyChatGenerations, 0);
    assert.equal(PHASE3A_CALL_PLAN.pathBFull.lunaBatchesIf50Turn, 10);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.rerunAuthorized, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.providerPosts, 1);
  });

  it("reuses Phase 1 A/B and Phase 2B fixtures instead of adding scenes", () => {
    assert.equal(PHASE3A_REUSED_PROBES.pinKind, "PHASE1_AB_SNAPSHOT");
    assert.equal(PHASE3A_REUSED_PROBES.ownerTest, "src/lib/memory/monthlyRpMemoryQualityPhase1.test.ts");
    assert.equal(PHASE3A_REUSED_PROBES.t6.phase1Case, "A");
    assert.equal(PHASE3A_REUSED_PROBES.t6.currentTurn - PHASE3A_REUSED_PROBES.t6.sourceTurn, 6);
    assert.match(PHASE3A_REUSED_PROBES.t6.factText, /우산/);
    assert.equal(PHASE3A_REUSED_PROBES.t50.phase1Case, "B");
    assert.equal(PHASE3A_REUSED_PROBES.t50.currentTurn, 51);
    assert.match(PHASE3A_REUSED_PROBES.t50.factText, /옥상에서 처음으로 담배를/);
    const phase1Source = readFileSync(path.join(process.cwd(), PHASE3A_REUSED_PROBES.ownerTest), "utf8");
    assert.equal(phase1Source.includes(PHASE3A_REUSED_PROBES.t6.factText), true);
    assert.equal(phase1Source.includes(PHASE3A_REUSED_PROBES.t6.query), true);
    assert.equal(phase1Source.includes(PHASE3A_REUSED_PROBES.t50.factText), true);
    assert.equal(phase1Source.includes(PHASE3A_REUSED_PROBES.t50.query), true);
    assert.equal(phase3aReusedPhase2bTurnCount(), 5);
    assert.equal(phase3aReusedPhase2bFactCount(), 8);
    assert.equal(
      PHASE3A_REUSED_CONTRASTS.every((row) => row.paidInPhase3a === false),
      true
    );
    assert.ok(PHASE3A_OUT_OF_SCOPE.some((row) => row.includes("50 consecutive")));
    assert.ok(PHASE3A_OUT_OF_SCOPE.some((row) => row.includes("이안/서린")));
    assert.ok(PHASE3A_OUT_OF_SCOPE.some((row) => row.includes("B-lite")));
  });

  it("does not grade Path A umbrella from the archived Phase 2C Luna summary", () => {
    const evidence = JSON.parse(
      readFileSync(path.join(process.cwd(), PHASE3A_PHASE2C_EVIDENCE_PATH), "utf8")
    ) as { selectedSummary?: string };
    const summary = evidence.selectedSummary ?? "";
    assert.match(summary, /황동 라이터/);
    assert.match(summary, /약속/);
    assert.equal(summary.includes("우산"), false);
    assert.equal(PHASE3A_REUSED_PROBES.t6.query.includes("우산"), true);
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.status, "FOLLOW_UP");
    assert.equal(PHASE3A_CALL_PLAN.pathBLite.mustNotUsePhase1AUmbrellaQuery, true);
    assert.equal(PHASE3A_CALL_PLAN.pathA.mainRpPostsIfLaterApproved, 8);
  });

  it("labels production 라이크 18 / 렌 unread on this VM", () => {
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.identitySource, "FIXTURE_NOT_PRODUCTION_SHEET");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.characterSheetRead, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.productionPersonaRead, false);
    assert.equal(PHASE3A_CALL_PLAN.identity.localProductionRow, "ABSENT");
    assert.equal(PHASE3A_CALL_PLAN.identity.railwayHashProbeOwner, "RP_QUALITY_PRECALL_RAILWAY_HASH_PROBE_CONTRACT");
    assert.equal(RP_QUALITY_PRECALL_RAILWAY_HASH_PROBE_CONTRACT.sqliteUriMode, "ro");
    assert.equal(
      canClaimCurrentProductionParity({
        executionHost: MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.executionHost,
        runtimeShaSource: "UNOBSERVED",
        observedRuntimeSha: null,
        characterSheetRead: false,
        productionPersonaRead: false,
      }),
      false
    );
  });

  it("keeps a context preview distinct from provider final-wire and DB retrieval", () => {
    const probe = PHASE3A_REUSED_PROBES.t6;
    const injected = `[T${probe.sourceTurn}] ${probe.factText}`;
    const built = buildContext({
      charName: MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.characterName,
      chunks: [],
      userNickname: MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.personaName,
      shortTermHistory: [],
      nsfw: false,
      longTermMemory: formatMemoryBlock(1, 5, "골목에서 우산을 같이 쓴 뒤 하숙집으로 돌아옴."),
      episodicMemoryBlock: injected,
      currentUserMessage: probe.query,
    });
    const packet = {
      ...emptyPhase3aGptReviewPacket("A_SEEDED_MEMORY", "t6"),
      modelId: MAIN_RP_MODEL_IDS[0],
      storedEpisodes: [probe.factText],
      retrievalCandidates: [probe.factText],
      injected,
      contextSystemPromptPreview: built.systemPrompt,
    };
    assert.match(packet.contextSystemPromptPreview ?? "", /우산/);
    assert.equal(packet.finalWire, null);
    assert.equal(packet.dbRetrievalExecuted, false);
    assert.equal(packet.assemblePrimaryRpRequestExecuted, false);
    assert.equal(packet.modelResponse, null);
    assert.equal(packet.cursorQualityScore, null);
    assert.equal(packet.pathAPassMustNotImplyPathB, true);
    assert.equal(packet.provenance, "CURRENT_CODE_DETERMINISTIC");
    const currentMemory = (built.meta?.trackedSections ?? []).find(
      (section) => section.id === "current-memory"
    );
    assert.equal(currentMemory?.label, "[3] Current Memory");
    const ids = (built.meta?.trackedSections ?? []).map((section) => section.id);
    assert.ok(ids.includes("current-memory"));
    assert.ok(ids.includes("episodic-memory-retrieved-facts"));
  });

  it("documents per-model later POST counts and live rate owners without posting", () => {
    for (const modelId of MAIN_RP_MODEL_IDS) {
      const wireId = phase3aWireModelId(modelId);
      assert.equal(wireId, resolveMainRpPrimaryWireModelId(modelId));
      const rates = resolveOpenRouterModelRates(wireId);
      assert.ok(rates.inputUsdPerM > 0, modelId);
      assert.ok(rates.outputUsdPerM > 0, modelId);
      const estimated = (estimateTokens("seeded memory probe") / 1_000_000) * rates.inputUsdPerM;
      assert.ok(estimated >= 0, modelId);
    }
    assert.equal(phase3aProvider("deepseek-v4.1-flash"), "cheaperinference");
    assert.equal(phase3aProvider("gemini-3.8-flash"), "openrouter");
    assert.equal(phase3aProvider("gpt-6.1-sol"), "cheaperinference");
    assert.equal(phase3aProvider("claude-opus-5.5"), "cheaperinference");
    assert.equal(phase3aWireModelId("gemini-3.8-flash"), "google/gemini-3.8-flash");
  });
});
