/**
 * OC-01..20 regression matrix — offline/test-support scope only.
 * See docs/audits/opus-cache-cost/AUDIT_REPORT.md § OC Matrix Coverage.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import {
  isPhase1PublishedBillingEnabled,
  isPhase1PublishedBillingModel,
} from "@/lib/chatBillingContractDispatch";
import {
  buildLikeScaleSnapshot,
  diagnoseSameSnapshot,
} from "@/lib/opusGeminiSameSnapshotDiagnostic";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { openRouterUsdCostFromRates } from "@/lib/openRouterModelPricing";
import { computeOpenRouterTurnCost } from "@/lib/points";
import { buildContext } from "@/services/contextBuilder";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";
import {
  buildOpusCacheEconomicsScenarios,
  buildTurnForensicsRow,
  FORENSICS_OPUS_MODEL,
  HISTORICAL_INCIDENT_PR440,
  parseUsagePartitionSample,
  reconcileHistoricalIncident440CatalogUsd,
  simulateSequentialTurns,
  traceCiWireForChat,
} from "./opusCacheCostForensics";

describe("Opus cache/cost forensics (OC-01..20, test-support)", () => {
  it("OC-01 [OFFLINE_PROOF]: same Gemini/Opus snapshot; Opus not 2× Gemini", () => {
    const report = diagnoseSameSnapshot(buildLikeScaleSnapshot());
    assert.equal(report.opus.payload.historyAssistantChars, report.gemini.payload.historyAssistantChars);
    assert.ok(report.opus.payload.totalChars < report.gemini.payload.totalChars * 1.15);
    assert.equal(report.sectionDiff.opusOnly.length, 0);
  });

  it("OC-02 [OFFLINE_PROOF]: CI Opus wire has exactly 3 cache_control blocks", () => {
    const report = diagnoseSameSnapshot(buildLikeScaleSnapshot());
    assert.equal(report.opus.payload.cacheControlBlocks, 3);
    assert.equal(report.opus.payload.hasAssistantPrefill, false);
  });

  it("OC-03 [OFFLINE_PROOF]: dynamic-only mutation leaves stable cache prefix fingerprint", () => {
    const base = buildLikeScaleSnapshot();
    const rowA = buildTurnForensicsRow("A", base);
    const rowB = buildTurnForensicsRow("B", {
      ...base,
      longTermMemory: "변경된 장기 기억 텍스트.",
      currentUserMessage: "완전히 다른 현재 턴 사용자 메시지.",
    });
    assert.equal(rowA.cachePrefix.combinedFingerprint16, rowB.cachePrefix.combinedFingerprint16);
    assert.notEqual(rowA.assembledChars.dynamic, rowB.assembledChars.dynamic);
  });

  it("OC-04 [OFFLINE_PROOF]: stable fixture → stable character settings fingerprint", () => {
    const row1 = buildTurnForensicsRow("1", buildLikeScaleSnapshot());
    const row2 = buildTurnForensicsRow("2", buildLikeScaleSnapshot());
    assert.equal(row1.cachePrefix.characterSettingsSha256, row2.cachePrefix.characterSettingsSha256);
  });

  it("OC-05 [NOT_VALIDATED]: KO fallback → EN translation transition — NOT covered here", () => {
    // Placeholder: persona invalidation only (not translation source transition).
    const base = buildLikeScaleSnapshot();
    const rowA = buildTurnForensicsRow("A", base);
    const rowB = buildTurnForensicsRow("B", {
      ...base,
      userPersona: "완전히 다른 페르소나.",
      personaDisplayName: "다른이름",
    });
    assert.notEqual(rowA.cachePrefix.systemRulesSha256, rowB.cachePrefix.systemRulesSha256);
  });

  it("OC-06 [OFFLINE_PREREQ]: T1→T2 stable prefix fingerprint (not live warm proof)", () => {
    const rows = simulateSequentialTurns();
    assert.equal(rows[0]!.cachePrefix.combinedFingerprint16, rows[1]!.cachePrefix.combinedFingerprint16);
  });

  it("OC-07 [OFFLINE_PROOF]: growing history increases cached prefix chars T2→T3", () => {
    const rows = simulateSequentialTurns();
    assert.ok(rows[2]!.assembledChars.historyPrefix >= rows[1]!.assembledChars.historyPrefix);
  });

  it("OC-08 [OFFLINE_PROOF]: regen session_id differs pre-adapt, stripped on CI wire", () => {
    const snapshot = buildLikeScaleSnapshot();
    const normal = traceCiWireForChat({ snapshot, chatId: 1 });
    const regen = traceCiWireForChat({ snapshot, chatId: 1, regen: { messageId: 99, attemptId: 2 } });
    assert.notEqual(normal.sessionIdBeforeAdapt, regen.sessionIdBeforeAdapt);
    assert.equal(normal.sessionIdStripped, true);
    assert.equal(regen.sessionIdStripped, true);
    assert.equal(normal.sessionIdAfterAdapt, undefined);
  });

  it("OC-09/OC-10 [OFFLINE_PROOF]: cache_control ephemeral only; no 1h TTL in app", () => {
    const built = buildContext({
      ...buildLikeScaleSnapshot(),
      modelId: FORENSICS_OPUS_MODEL,
      provider: "cheaperinference",
    });
    const asm = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history ?? [],
      modelId: FORENSICS_OPUS_MODEL,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      stream: false,
      messageOpts: {
        transportProvider: "cheaperinference",
        systemSplit: built.openRouterSystemSplit,
        charName: "라이크",
      },
    });
    for (const block of (asm.messages[0]?.content ?? []) as Array<{
      cache_control?: { type?: string; ttl?: string };
    }>) {
      if (block.cache_control) {
        assert.equal(block.cache_control.type, "ephemeral");
        assert.equal(block.cache_control.ttl, undefined);
      }
    }
  });

  it("OC-11 [OFFLINE_PROOF]: persona change invalidates combined fingerprint", () => {
    const base = buildLikeScaleSnapshot();
    const a = buildTurnForensicsRow("a", base);
    const b = buildTurnForensicsRow("b", { ...base, userPersona: "새 페르소나" });
    assert.notEqual(a.cachePrefix.combinedFingerprint16, b.cachePrefix.combinedFingerprint16);
  });

  it("OC-12 [OFFLINE_PROOF]: character chunk edit invalidates fingerprint", () => {
    const base = buildLikeScaleSnapshot();
    const a = buildTurnForensicsRow("a", base);
    const chunks = [...(base.chunks ?? [])];
    chunks[0] = { ...chunks[0]!, content: chunks[0]!.content + " [EDIT]" };
    const b = buildTurnForensicsRow("b", { ...base, chunks });
    assert.notEqual(a.cachePrefix.combinedFingerprint16, b.cachePrefix.combinedFingerprint16);
  });

  it("OC-13 [OFFLINE_PROOF]: separate chat → distinct session_id pre-adapt", () => {
    const snapshot = buildLikeScaleSnapshot();
    const chat1 = traceCiWireForChat({ snapshot, chatId: 1 });
    const chat2 = traceCiWireForChat({ snapshot, chatId: 2 });
    assert.notEqual(chat1.sessionIdBeforeAdapt, chat2.sessionIdBeforeAdapt);
  });

  it("OC-14 [OFFLINE_PROOF]: separate user/chat scope → distinct session_id pre-adapt", () => {
    const snapshot = buildLikeScaleSnapshot();
    const u1 = traceCiWireForChat({ snapshot: { ...snapshot, userId: 1 }, chatId: 10 });
    const u2 = traceCiWireForChat({ snapshot: { ...snapshot, userId: 2 }, chatId: 20 });
    assert.notEqual(u1.sessionIdBeforeAdapt, u2.sessionIdBeforeAdapt);
  });

  it("OC-15 [OFFLINE_PROOF]: usage parser partition arithmetic invariant", () => {
    const sample = parseUsagePartitionSample();
    assert.equal(sample.invariantHolds, true);
  });

  it("OC-16 [CATALOG_FORMULA_ONLY]: NOT actual CI settlement — catalog USD matches PR440 shape", () => {
    const recon = reconcileHistoricalIncident440CatalogUsd();
    assert.ok(recon.deltaUsd < 0.002, `catalog ${recon.catalogUsd} vs billed ${recon.reportedBilledUsd}`);
    assert.equal(HISTORICAL_INCIDENT_PR440.cacheReadTokens, 0);
    assert.equal(HISTORICAL_INCIDENT_PR440.cacheWriteTokens, 0);
    const scenarios = buildOpusCacheEconomicsScenarios();
    const pr440 = scenarios.find((s) => s.id === "PR440");
    assert.ok(pr440);
    const recomputed = openRouterUsdCostFromRates({
      promptTokens: pr440!.promptTokens,
      outputTokens: pr440!.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      modelId: FORENSICS_OPUS_MODEL,
    });
    assert.ok(Math.abs(recomputed.usdCost - pr440!.providerUsd) < 1e-9);
  });

  it("OC-17 [CODE_DEFAULT_ONLY]: PHASE1 gate defaults false — production value UNVERIFIED", () => {
    const saved = process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
    delete process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
    try {
      assert.equal(isPhase1PublishedBillingEnabled(), false);
    } finally {
      if (saved === undefined) delete process.env.PHASE1_PUBLISHED_BILLING_ENABLED;
      else process.env.PHASE1_PUBLISHED_BILLING_ENABLED = saved;
    }
  });

  it("OC-18 [OFFLINE_PROOF]: legacy Opus charge ignores cache tokens (char floor path)", () => {
    const cold = computeOpenRouterTurnCost(
      60_000,
      2_000,
      FORENSICS_OPUS_MODEL,
      { cacheReadTokens: 0, cacheWriteTokens: 60_000 },
      { outputChars: 1_800 }
    );
    const warm = computeOpenRouterTurnCost(
      60_000,
      2_000,
      FORENSICS_OPUS_MODEL,
      { cacheReadTokens: 56_000, cacheWriteTokens: 4_000 },
      { outputChars: 1_800 }
    );
    assert.equal(cold, warm);
  });

  it("OC-19 [DELEGATED]: Opus 5 is Phase1 published model candidate", () => {
    assert.equal(isPhase1PublishedBillingModel(FORENSICS_OPUS_MODEL), true);
  });

  it("OC-20 [ADAPTER_IDEMPOTENCY_ONLY]: NOT failed/timeout settlement — see providerCostLedger tests", () => {
    const body = {
      model: FORENSICS_OPUS_MODEL,
      messages: [{ role: "user", content: "hi" }],
      session_id: "chat-1",
    };
    const once = adaptCheaperInferenceChatBody(body);
    const twice = adaptCheaperInferenceChatBody(once);
    assert.deepEqual(once, twice);
  });

  it("wire [OFFLINE_PROOF]: no x-ci-prompt-cache headers in CI transport", () => {
    const wire = traceCiWireForChat({ snapshot: buildLikeScaleSnapshot(), chatId: 1 });
    assert.equal(wire.ciPromptCacheHeaders["x-ci-prompt-cache"], false);
    assert.equal(wire.ciPromptCacheHeaders["x-ci-prompt-cache-session"], false);
  });
});
