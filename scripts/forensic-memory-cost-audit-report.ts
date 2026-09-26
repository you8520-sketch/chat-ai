/**
 * One-shot report extractor — zero provider calls.
 * Usage: node --conditions=react-server --import tsx scripts/forensic-memory-cost-audit-report.ts
 */
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  measurePaidPeakInputTokens,
  runForensicMatrixSnapshot,
  runForensicAssembly,
  buildForensicModelHeadroomRow,
  buildProviderContextEvidenceTable,
  buildBillingOwnerMap,
  buildForensicMarginMatrixForLoadClass,
  evaluateForensicAuditGates,
  decideImplementationRecommendation,
  implementationDecisionLabel,
  PRODUCT_MARGIN_REFERENCE,
  type AuditLoadClass,
} from "@/lib/memory/forensic-memory-cost-audit";

const DEFAULT_OUTPUT_TOKENS = estimateTokens("x".repeat(2_500));
const loads: AuditLoadClass[] = ["NORMAL", "MEMORY_HEAVY", "BOUNDED_VALID_STRESS"];

console.log("## MODEL CONTEXT EVIDENCE");
for (const row of buildProviderContextEvidenceTable()) {
  console.log(
    JSON.stringify({
      model: row.modelId,
      providerModelId: row.providerModelId,
      providerContextWindow: row.providerContextWindowTokens,
      maxOutput: row.providerMaxOutputTokens,
      source: row.providerEvidenceSource,
      retrievedVerifiedDate: row.retrievedVerifiedDate,
      productionAssemblyLimit: row.productionAssemblyPayloadLimit,
      telemetryBudget: row.telemetrySystemBudget,
    })
  );
}

for (const load of loads) {
  console.log(`PEAK_PAID_${load}=${measurePaidPeakInputTokens(load)}`);
}

console.log("--- HEADROOM MEMORY_HEAVY PAID10 ---");
for (const modelId of MAIN_RP_MODEL_IDS) {
  const assembly = runForensicAssembly({
    modelId,
    loadClass: "MEMORY_HEAVY",
    matrix: "PAID_CURRENT",
  });
  const headroom = buildForensicModelHeadroomRow(assembly);
  console.log(
    JSON.stringify({
      modelId,
      inputTokens: headroom.estimatedInputTokens,
      providerContextWindow: headroom.providerContextWindowTokens,
      headroom: headroom.remainingHeadroom,
      telemetryBudget: headroom.telemetrySystemBudget,
      productionAssemblyLimit: headroom.productionAssemblyPayloadLimit,
    })
  );
}

console.log("--- BILLING OWNER MAP ---");
for (const owner of buildBillingOwnerMap()) {
  console.log(JSON.stringify(owner));
}

console.log("--- PAID10 / PAID15 MARGIN MATRIX (MEMORY_HEAVY) ---");
const marginRows = buildForensicMarginMatrixForLoadClass(
  "MEMORY_HEAVY",
  DEFAULT_OUTPUT_TOKENS
);
for (const row of marginRows) {
  console.log(JSON.stringify(row));
}
console.log(`PRODUCT_MARGIN_REFERENCE=${JSON.stringify(PRODUCT_MARGIN_REFERENCE)}`);

console.log("--- MATRIX MEMORY_HEAVY ---");
for (const modelId of MAIN_RP_MODEL_IDS) {
  const snapshot = runForensicMatrixSnapshot({ modelId, loadClass: "MEMORY_HEAVY" });
  console.log(
    JSON.stringify({
      modelId,
      paid10Input: snapshot.paid10.estimatedInputTokens,
      paid15Input: snapshot.paid15Sim.estimatedInputTokens,
      deltaInput: snapshot.global15InputTokenDelta,
      deltaRawKrw: snapshot.global15RawKrwDelta,
      deltaPoints: snapshot.global15PointsDelta,
      historyTrimOffset: snapshot.historyTrimOffset,
    })
  );
}

const boundedPaid15 = MAIN_RP_MODEL_IDS.map((modelId) =>
  runForensicAssembly({
    modelId,
    loadClass: "BOUNDED_VALID_STRESS",
    matrix: "PAID_GLOBAL15_SIMULATION",
  })
);
const memoryHeavyPaid10 = MAIN_RP_MODEL_IDS.map((modelId) =>
  runForensicAssembly({ modelId, loadClass: "MEMORY_HEAVY", matrix: "PAID_CURRENT" })
);
const memoryHeavyPaid15 = MAIN_RP_MODEL_IDS.map((modelId) =>
  runForensicAssembly({
    modelId,
    loadClass: "MEMORY_HEAVY",
    matrix: "PAID_GLOBAL15_SIMULATION",
  })
);
const free10 = MAIN_RP_MODEL_IDS.map((modelId) =>
  runForensicAssembly({ modelId, loadClass: "MEMORY_HEAVY", matrix: "FREE_CURRENT" })
);

const gates = evaluateForensicAuditGates({
  boundedStressPaid15Assemblies: boundedPaid15,
  paid10Assemblies: memoryHeavyPaid10,
  paid15Assemblies: memoryHeavyPaid15,
  free10Assemblies: free10,
  marginRows,
  historyTrimOffsetObserved: false,
});
const decision = decideImplementationRecommendation({
  boundedStressPaid15Assemblies: boundedPaid15,
  paid10Assemblies: memoryHeavyPaid10,
  paid15Assemblies: memoryHeavyPaid15,
  free10Assemblies: free10,
  marginRows,
  historyTrimOffsetObserved: false,
});

console.log("--- GATES ---");
console.log(JSON.stringify(gates));
console.log(`IMPLEMENTATION_DECISION=${implementationDecisionLabel(decision)}`);

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
