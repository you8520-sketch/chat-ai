/**
 * Opus cache / cost forensics — offline harness (no provider HTTP).
 *
 *   node --conditions=react-server --import tsx scripts/opus-cache-cost-forensics-offline.ts
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import {
  buildLikeScaleSnapshot,
  diagnoseSameSnapshot,
} from "../src/lib/opusGeminiSameSnapshotDiagnostic";
import {
  buildOpusCacheEconomicsScenarios,
  buildTurnForensicsRow,
  FORENSICS_OPUS_MODEL,
  HISTORICAL_INCIDENT_PR440,
  parseUsagePartitionSample,
  reconcileHistoricalIncident440CatalogUsd,
  simulateSequentialTurns,
  traceCiWireForChat,
} from "./test-support/opusCacheCostForensics";

function main(): void {
  const snapshot = buildLikeScaleSnapshot();
  const sameSnapshot = diagnoseSameSnapshot(snapshot);
  const wire = traceCiWireForChat({ snapshot, chatId: 42 });
  const t1 = buildTurnForensicsRow("baseline", snapshot);
  const sequential = simulateSequentialTurns();
  const economics = buildOpusCacheEconomicsScenarios();
  const usageSample = parseUsagePartitionSample();
  const pr440Recon = reconcileHistoricalIncident440CatalogUsd();

  const report = {
    generatedAt: new Date().toISOString(),
    model: FORENSICS_OPUS_MODEL,
    classifications: {
      HISTORICAL_OPUS_60K_INCIDENT: "FAILURE_MODE_CONFIRMED",
      HISTORICAL_CACHE_BYPASS_UNDERLYING_CAUSE: "ROOT_CAUSE_UNCONFIRMED",
      CURRENT_OPUS_PHYSICAL_PROMPT_DUPLICATION: "NO_MATERIAL_DEFECT_FOUND",
      CURRENT_OPUS_CACHE_HEALTH: "UNVERIFIED_NO_CURRENT_LIVE_PROVIDER_PROOF",
      CURRENT_OPUS_BILLING_CONTRACT: "UNVERIFIED_PRODUCTION_ENV_VALUE_REDACTED",
      OPUS_PUBLIC_EXPOSURE_GUARD: "REMOVED_WITHOUT_CACHE_ROOT_CAUSE_PROOF",
    },
    historicalIncidentPr440: {
      ...HISTORICAL_INCIDENT_PR440,
      catalogReconciliation: pr440Recon,
      note: "Provider reported 0/0 cache read/write — FULLY_UNCACHED_CONFIRMED, not cold cache-write.",
    },
    lifecycleAudit: {
      pr423: "History cache breakpoint restored; live T7-T9 warm hits in PR",
      pr440: "OPUS5_USER_ENABLED disable — incident request 669865 cited",
      pr643: "Admin-only Opus re-exposure while global disable held",
      pr876: "Gate removal — Opus in MAIN_RP_USER_SELECTABLE_OPTIONS for all users; NO cache recovery proof in PR body",
    },
    sameSnapshotPhysical: {
      opusTotalChars: sameSnapshot.opus.payload.totalChars,
      geminiTotalChars: sameSnapshot.gemini.payload.totalChars,
      ratio: sameSnapshot.opus.payload.totalChars / sameSnapshot.gemini.payload.totalChars,
      opusOnlySections: sameSnapshot.sectionDiff.opusOnly.length,
      cacheControlBlocks: sameSnapshot.opus.payload.cacheControlBlocks,
    },
    wireTrace: wire,
    cachePrefixFingerprint: t1.cachePrefix,
    cacheRegionOwnershipNote:
      "See contextBuilder.ts pushSection targets (cacheRules/cacheCharacter/dynamic) — no manual inventory constant",
    sequentialTurns: sequential.map((row) => ({
      turn: row.turnLabel,
      fingerprint: row.cachePrefix.combinedFingerprint16,
      systemRulesChars: row.assembledChars.systemRules,
      characterChars: row.assembledChars.characterSettings,
      dynamicChars: row.assembledChars.dynamic,
      historyPrefixChars: row.assembledChars.historyPrefix,
      historyTailChars: row.assembledChars.historyTail,
      cacheBlocks: row.wire.cacheControlBlockCount,
      historyBreakpoint: row.wire.historyBreakpointIndex,
    })),
    usagePartitionSample: usageSample,
    cacheEconomicsUsd: economics,
    billingContract: {
      codeDefaultPhase1Enabled: false,
      railwayProductionValue: "UNVERIFIED (variable exists, OAuth redacted)",
    },
    generationVsCacheAffinity: {
      generationSessionIdNormal: "chat-{chatId}",
      generationSessionIdRegen: "chat-{chatId}-regen-{messageId}-{attemptId}",
      ciWireSessionId: "STRIPPED by adaptCheaperInferenceChatBody",
      ciPromptCacheHeaders: "NOT SET in buildCheaperInferenceHeaders",
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
