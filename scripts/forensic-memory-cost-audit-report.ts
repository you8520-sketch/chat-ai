/**
 * One-shot report extractor — zero provider calls.
 * Usage: node --conditions=react-server --import tsx scripts/forensic-memory-cost-audit-report.ts
 */
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  measurePaidPeakInputTokens,
  runForensicMatrixSnapshot,
  runForensicAssembly,
  buildForensicCostRow,
  buildForensicModelHeadroomRow,
  type AuditLoadClass,
} from "@/lib/memory/forensic-memory-cost-audit";

const loads: AuditLoadClass[] = ["NORMAL", "MEMORY_HEAVY", "BOUNDED_VALID_STRESS"];
for (const load of loads) {
  console.log(`PEAK_PAID_${load}=${measurePaidPeakInputTokens(load)}`);
}

console.log("--- MATRIX MEMORY_HEAVY ---");
for (const modelId of MAIN_RP_MODEL_IDS) {
  const snapshot = runForensicMatrixSnapshot({ modelId, loadClass: "MEMORY_HEAVY" });
  const headroom = buildForensicModelHeadroomRow(snapshot.paid10);
  const cost10 = buildForensicCostRow(snapshot.paid10);
  const cost15 = buildForensicCostRow(snapshot.paid15Sim);
  console.log(
    JSON.stringify({
      modelId,
      paid10Input: snapshot.paid10.estimatedInputTokens,
      paid15Input: snapshot.paid15Sim.estimatedInputTokens,
      deltaInput: snapshot.global15InputTokenDelta,
      deltaRawKrw: snapshot.global15RawKrwDelta,
      deltaPoints: snapshot.global15PointsDelta,
      headroom: headroom.remainingHeadroom,
      ceiling: headroom.contextPayloadCeiling,
      rawKrw10: cost10.rawCostKrw,
      points10: cost10.chargePoints,
      rawKrw15: cost15.rawCostKrw,
      points15: cost15.chargePoints,
      historyTrimOffset: snapshot.historyTrimOffset,
      mediumGlobalDupChars: snapshot.mediumGlobalOverlapChars,
    })
  );
}

const assembly = runForensicAssembly({
  modelId: MAIN_RP_MODEL_IDS[0]!,
  loadClass: "MEMORY_HEAVY",
  matrix: "PAID_CURRENT",
});
console.log("--- LEDGER TOP (DeepSeek MEMORY_HEAVY PAID10) ---");
for (const row of [...assembly.ledger].sort((a, b) => b.estimatedTokens - a.estimatedTokens).slice(0, 10)) {
  console.log(
    `${row.section} | chars=${row.chars} | tokens=${row.estimatedTokens} | ${row.pctOfTotal.toFixed(1)}% | ${row.cappedBy}`
  );
}
