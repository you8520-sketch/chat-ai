/**
 * Post-#987 forensic memory / cost audit — zero provider calls.
 * Correction pass: provider context evidence + billing margin gates.
 */
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
import { execSync } from "node:child_process";
import { describe, it } from "node:test";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS,
  CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT,
} from "@/lib/creatorLorebook";
import { DEEPSEEK_MAX_PAYLOAD_INPUT_TOKENS } from "@/lib/contextTrack";
import { estimateTokens } from "@/lib/tokenEstimate";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import {
  buildBillingOwnerMap,
  buildForensicMarginMatrixForLoadClass,
  buildMemoryOwnerMap,
  buildProviderContextEvidenceTable,
  buildSectionInventory,
  classifyStaleAuditArtifacts,
  decideImplementationRecommendation,
  evaluateForensicAuditGates,
  implementationDecisionLabel,
  IMPLEMENTATION_SAFE_LABEL,
  measurePaidPeakInputTokens,
  PROVIDER_CONTEXT_UNKNOWN,
  resolveAuditProviderContextCeiling,
  resolveProviderContextEvidence,
  runForensicAssembly,
  runForensicMatrixSnapshot,
  subscriptionCapabilityLacksGlobalTier,
  verifyMainHeadIncludesPr987,
  buildForensicModelHeadroomRow,
  buildForensicCostRow,
  FORENSIC_AUDIT_MAIN_HEAD,
} from "./forensic-memory-cost-audit";
import { decideImplementationRecommendationFromGates } from "./forensic-memory-cost-audit-evidence";
import catalogFixture from "./fixtures/cheaperInferenceMainRpProviderContext.fixture.json";

const LIVE_HEAD = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const DEFAULT_OUTPUT_TOKENS = estimateTokens("x".repeat(2_500));

function collectMatrixAssemblies(loadClass: "MEMORY_HEAVY" | "BOUNDED_VALID_STRESS") {
  const free10Assemblies = [];
  const paid10Assemblies = [];
  const paid15Assemblies = [];
  const boundedStressPaid15Assemblies = [];
  let historyTrimOffsetObserved = false;

  for (const modelId of MAIN_RP_MODEL_IDS) {
    free10Assemblies.push(
      runForensicAssembly({ modelId, loadClass, matrix: "FREE_CURRENT" })
    );
    paid10Assemblies.push(
      runForensicAssembly({ modelId, loadClass, matrix: "PAID_CURRENT" })
    );
    const paid15 = runForensicAssembly({
      modelId,
      loadClass,
      matrix: "PAID_GLOBAL15_SIMULATION",
    });
    paid15Assemblies.push(paid15);
    if (loadClass === "BOUNDED_VALID_STRESS") {
      boundedStressPaid15Assemblies.push(paid15);
    }
    const snapshot = runForensicMatrixSnapshot({ modelId, loadClass });
    if (snapshot.historyTrimOffset) historyTrimOffsetObserved = true;
  }

  const marginRows = buildForensicMarginMatrixForLoadClass(loadClass, DEFAULT_OUTPUT_TOKENS);
  return {
    free10Assemblies,
    paid10Assemblies,
    paid15Assemblies,
    boundedStressPaid15Assemblies,
    marginRows,
    historyTrimOffsetObserved,
  };
}

describe("EXACT HEAD / PR #987 baseline", () => {
  it("records main baseline and post-#987 architecture checks", () => {
    const mainHead = execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();
    assert.equal(mainHead, FORENSIC_AUDIT_MAIN_HEAD);
    assert.notEqual(LIVE_HEAD, FORENSIC_AUDIT_MAIN_HEAD, "audit branch is ahead of main baseline");
    const proof = verifyMainHeadIncludesPr987();
    assert.equal(proof.includesPr987, true);
    assert.equal(proof.checks.creatorLorebookAttachMax20, true);
    assert.equal(proof.checks.creatorTurnInjectMax4000, true);
    assert.equal(proof.checks.globalCurrentMemoryCanonicalOwner, true);
    assert.equal(proof.checks.mediumN15Owner, true);
    assert.equal(proof.checks.subscriptionCapabilityNoGlobalTier, true);
  });
});

describe("CORRECTION — provider context evidence", () => {
  it("1. all MAIN_RP_MODEL_IDS have verified provider context evidence", () => {
    const table = buildProviderContextEvidenceTable();
    assert.equal(table.length, MAIN_RP_MODEL_IDS.length);
    for (const row of table) {
      assert.notEqual(row.providerContextWindowTokens, PROVIDER_CONTEXT_UNKNOWN);
      assert.notEqual(row.providerMaxOutputTokens, PROVIDER_CONTEXT_UNKNOWN);
      assert.match(row.providerEvidenceSource, /cheaperinference/i);
      assert.equal(row.retrievedVerifiedDate, catalogFixture.retrievedAt);
    }
  });

  it("2. Gemini 3.7 does not inherit Gemini 3.1 ceiling", () => {
    const g31 = resolveProviderContextEvidence("gemini-3.1-pro-preview");
    const g37 = resolveProviderContextEvidence("gemini-3.7-flash");
    assert.equal(g31.providerContextWindowTokens, 1_000_000);
    assert.equal(g37.providerContextWindowTokens, 1_048_576);
    assert.notEqual(g37.providerContextWindowTokens, g31.providerContextWindowTokens);
    assert.doesNotMatch(g37.providerEvidenceSource, /gemini-3\.1|200_?000|publishedBaseTier/i);
  });

  it("3. Terra does not use MAX_SAFE_INTEGER as provider ceiling", () => {
    const terra = resolveProviderContextEvidence("gpt-5.6-terra");
    assert.equal(terra.providerContextWindowTokens, 1_050_000);
    assert.notEqual(terra.providerContextWindowTokens, Number.MAX_SAFE_INTEGER);
    assert.equal(terra.productionAssemblyPayloadLimit, Number.MAX_SAFE_INTEGER);
  });

  it("4. DeepSeek does not use stale 180K reference as current provider ceiling", () => {
    const deepseek = resolveProviderContextEvidence("deepseek-v4-pro-0813");
    assert.equal(deepseek.providerContextWindowTokens, 1_048_576);
    assert.notEqual(deepseek.providerContextWindowTokens, DEEPSEEK_MAX_PAYLOAD_INPUT_TOKENS);
    const { ceiling } = resolveAuditProviderContextCeiling("deepseek-v4-pro-0813");
    assert.equal(ceiling, 1_048_576);
  });

  it("5. headroom uses provider ceiling not assembly unbounded limit", () => {
    for (const modelId of MAIN_RP_MODEL_IDS) {
      const assembly = runForensicAssembly({
        modelId,
        loadClass: "MEMORY_HEAVY",
        matrix: "PAID_CURRENT",
      });
      const headroom = buildForensicModelHeadroomRow(assembly);
      assert.ok(headroom.contextPayloadCeiling >= 1_000_000);
      assert.notEqual(headroom.contextPayloadCeiling, Number.MAX_SAFE_INTEGER);
      assert.ok(Number.isFinite(headroom.remainingHeadroom));
      assert.ok(headroom.remainingHeadroom > 0);
      assert.equal(
        headroom.providerContextWindowTokens,
        headroom.contextPayloadCeiling
      );
    }
  });
});

describe("OWNER MAP", () => {
  it("has single canonical owner per responsibility (no conflict flags)", () => {
    const rows = buildMemoryOwnerMap();
    assert.ok(rows.length >= 14);
    for (const row of rows) {
      assert.ok(row.canonicalOwner.length > 0);
      assert.ok(!row.canonicalOwner.includes("CONFLICT"));
    }
    const globalRow = rows.find((r) => r.responsibility.includes("Global Current Memory"));
    assert.ok(globalRow);
    assert.match(globalRow!.value, /10000/);
    const subRow = rows.find((r) => r.responsibility === "subscription memory capability");
    assert.ok(subRow?.notes?.includes("globalCurrentMemoryMaxChars"));
    assert.equal(subscriptionCapabilityLacksGlobalTier(), true);
  });
});

describe("SECTION INVENTORY", () => {
  it("lists core Main RP memory sections with producers", () => {
    const inventory = buildSectionInventory();
    const ids = inventory.map((row) => row.sectionId);
    for (const required of [
      "character-core-identity",
      "identity-and-rules",
      "keyword-lorebook",
      "user-lorebook",
      "current-memory",
      "medium-term-memory",
      "raw-history",
      "current-user-input",
    ]) {
      assert.ok(ids.includes(required), `missing inventory row ${required}`);
    }
  });
});

describe("LOAD CLASS FIXTURES → buildContext", () => {
  for (const loadClass of ["NORMAL", "MEMORY_HEAVY", "BOUNDED_VALID_STRESS"] as const) {
    it(`${loadClass} assembles without critical section omission`, () => {
      const modelId = MAIN_RP_MODEL_IDS[0]!;
      const assembly = runForensicAssembly({
        modelId,
        loadClass,
        matrix: "PAID_CURRENT",
      });
      assert.ok(assembly.estimatedInputTokens > 0);
      assert.ok(assembly.trackedSectionIds.includes("current-memory"));
      assert.ok(assembly.trackedSectionIds.includes("medium-term-memory"));
      if (loadClass !== "NORMAL") {
        assert.ok(assembly.creatorLorebookChars <= CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS + 120);
        assert.ok(assembly.userLorebookChars <= 4_000 + 120);
        assert.ok(assembly.globalChars <= MEMORY_CAPACITY_FIXED + 200);
      }
    });
  }

  it("BOUNDED_VALID_STRESS uses post-#987 creator caps not legacy unbounded", () => {
    const assembly = runForensicAssembly({
      modelId: MAIN_RP_MODEL_IDS[0]!,
      loadClass: "BOUNDED_VALID_STRESS",
      matrix: "PAID_CURRENT",
    });
    assert.ok(assembly.creatorLorebookChars > 0);
    assert.ok(assembly.creatorLorebookChars <= CREATOR_LOREBOOK_TURN_INJECT_MAX_CHARS + 120);
    assert.equal(CHARACTER_CREATOR_LOREBOOK_ATTACH_LIMIT, 20);
  });
});

describe("GLOBAL MATRIX FREE10 / PAID10 / PAID15_SIM", () => {
  it("6. PAID_GLOBAL15_SIM increases input only via Global section delta", () => {
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const snapshot = runForensicMatrixSnapshot({
      modelId,
      loadClass: "MEMORY_HEAVY",
    });
    assert.ok(snapshot.global15InputTokenDelta > 0);
    assert.equal(snapshot.free10.capability.focusMaxChars, 1_000);
    assert.equal(snapshot.paid10.capability.focusMaxChars, 2_000);
    assert.equal(snapshot.paid15Sim.globalMaxChars, 15_000);
    assert.equal(snapshot.paid10.globalMaxChars, 10_000);
    assert.equal(snapshot.historyTrimOffset, false);
    const paid10Global = snapshot.paid10.ledger.find((r) => r.section === "current-memory");
    const paid15Global = snapshot.paid15Sim.ledger.find((r) => r.section === "current-memory");
    assert.ok(paid10Global && paid15Global);
    assert.ok(paid15Global.chars > paid10Global.chars);
    const paid10History = snapshot.paid10.ledger.find((r) => r.section === "raw-history");
    const paid15History = snapshot.paid15Sim.ledger.find((r) => r.section === "raw-history");
    if (paid10History && paid15History) {
      assert.equal(paid15History.chars, paid10History.chars);
    }
  });

  it("7. Free tier matrix unchanged by PAID_GLOBAL15 simulation harness", () => {
    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const snapshot = runForensicMatrixSnapshot({
      modelId,
      loadClass: "MEMORY_HEAVY",
    });
    assert.equal(snapshot.free10.globalMaxChars, MEMORY_CAPACITY_FIXED);
    assert.equal(snapshot.free10.capability.userLorebookTurnInjectMaxChars, 2_500);
  });
});

describe("MODEL HEADROOM + COST (all Main RP models)", () => {
  for (const modelId of MAIN_RP_MODEL_IDS) {
    it(`${modelId} — MEMORY_HEAVY PAID_CURRENT headroom + billing`, () => {
      const assembly = runForensicAssembly({
        modelId,
        loadClass: "MEMORY_HEAVY",
        matrix: "PAID_CURRENT",
      });
      const headroom = buildForensicModelHeadroomRow(assembly);
      assert.ok(headroom.estimatedInputTokens > 5_000);
      assert.ok(headroom.estimatedInputTokens < 115_000);
      assert.ok(headroom.remainingHeadroom > 0);
      const cost = buildForensicCostRow(assembly);
      assert.ok(cost.rawCostKrw >= 0);
      assert.ok(cost.chargePoints >= 0);
    });
  }
});

describe("BILLING / MARGIN matrix", () => {
  it("8. margin rows are produced for all 4 Main RP models", () => {
    const owners = buildBillingOwnerMap();
    assert.equal(owners.length, 4);
    for (const owner of owners) {
      assert.notEqual(owner.rawCostOwner, "UNKNOWN");
      assert.notEqual(owner.pointChargeOwner, "UNKNOWN");
      assert.notEqual(owner.canonicalMarginFloor, "NO_EXPLICIT_MARGIN_FLOOR");
    }

    const marginRows = buildForensicMarginMatrixForLoadClass(
      "MEMORY_HEAVY",
      DEFAULT_OUTPUT_TOKENS
    );
    assert.equal(marginRows.length, 4);
    for (const row of marginRows) {
      assert.ok(row.paid10RawKrw >= 0);
      assert.ok(row.paid10ChargeP > 0);
      assert.ok(row.paid15ChargeP >= row.paid10ChargeP);
      assert.ok(row.paid10RealizedGrossMargin != null);
      assert.ok(row.paid15RealizedGrossMargin != null);
      assert.equal(row.canonicalPolicyPass, "PASS");
    }
  });
});

describe("IMPLEMENTATION GATES", () => {
  it("all gates pass → SAFE_FOR_SEPARATE_FEATURE_PR (not points-delta heuristic)", () => {
    const memoryHeavyPeak = measurePaidPeakInputTokens("MEMORY_HEAVY");
    const boundedPeak = measurePaidPeakInputTokens("BOUNDED_VALID_STRESS");
    assert.ok(memoryHeavyPeak > 0);
    assert.ok(boundedPeak >= memoryHeavyPeak);
    assert.ok(boundedPeak < 115_000, "post-#987 bounded stress must not reach historical #985 115K+");

    const matrix = collectMatrixAssemblies("BOUNDED_VALID_STRESS");
    const gates = evaluateForensicAuditGates(matrix);
    assert.equal(gates.contextGate, "PASS");
    assert.equal(gates.freeIsolationGate, "PASS");
    assert.equal(gates.historyGate, "PASS");
    assert.equal(gates.billingGate, "PASS");
    assert.equal(gates.ownerGate, "PASS");

    const decision = decideImplementationRecommendation(matrix);
    assert.equal(decision, "A");
    assert.equal(implementationDecisionLabel(decision), IMPLEMENTATION_SAFE_LABEL);
  });

  it("9. implementation decision cannot return SAFE when billing gate is UNKNOWN", () => {
    const matrix = collectMatrixAssemblies("BOUNDED_VALID_STRESS");
    const unknownBilling = {
      ...matrix,
      marginRows: matrix.marginRows.map((row, index) =>
        index === 0
          ? { ...row, canonicalPolicyPass: "UNKNOWN" as const, paid10RealizedGrossMargin: null }
          : row
      ),
    };
    const gates = evaluateForensicAuditGates(unknownBilling);
    assert.equal(gates.billingGate, "UNKNOWN");
    const decision = decideImplementationRecommendation(unknownBilling);
    assert.notEqual(decision, "A");
    assert.notEqual(implementationDecisionLabel(decision), IMPLEMENTATION_SAFE_LABEL);
  });

  it("10. implementation decision cannot return SAFE when provider ceiling is UNKNOWN", () => {
    const matrix = collectMatrixAssemblies("BOUNDED_VALID_STRESS");
    const gatesPass = evaluateForensicAuditGates(matrix);
    assert.equal(gatesPass.contextGate, "PASS");

    const decision = decideImplementationRecommendationFromGates({
      ...gatesPass,
      contextGate: "UNKNOWN",
    });
    assert.notEqual(decision, "A");
    assert.notEqual(implementationDecisionLabel(decision), IMPLEMENTATION_SAFE_LABEL);
  });
});

describe("MEDIUM ↔ GLOBAL OVERLAP", () => {
  it("global_compact medium may overlap ranges but audit tracks literal duplicate chars", () => {
    const assembly = runForensicAssembly({
      modelId: MAIN_RP_MODEL_IDS[0]!,
      loadClass: "MEMORY_HEAVY",
      matrix: "PAID_CURRENT",
    });
    assert.ok(assembly.mediumActive);
    assert.ok(assembly.mediumGlobalLiteralDuplicateChars >= 0);
  });
});

describe("STALE ARTIFACT CLASSIFICATION", () => {
  it("classifies historical #985 stress as SAFE TO DELETE", () => {
    const rows = classifyStaleAuditArtifacts();
    const legacy115 = rows.find((r) => r.artifact.includes("115K"));
    assert.ok(legacy115);
    assert.equal(legacy115!.classification, "SAFE TO DELETE");
  });
});

describe("PROVIDER_GENERATION_CALLS = 0", () => {
  it("audit modules have no fetch/openrouter provider generation imports", () => {
    for (const file of [
      "src/lib/memory/forensic-memory-cost-audit.ts",
      "src/lib/memory/forensic-memory-cost-audit-evidence.ts",
    ]) {
      const src = execSync(`sed -n '1,160p' ${file}`, { encoding: "utf8" });
      assert.doesNotMatch(src, /fetch\s*\(/);
      assert.doesNotMatch(src, /openrouter.*com/i);
    }
  });
});
