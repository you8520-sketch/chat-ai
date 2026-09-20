/**
 * Post-#987 forensic memory / cost audit — zero provider calls.
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
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import {
  buildMemoryOwnerMap,
  buildSectionInventory,
  classifyStaleAuditArtifacts,
  decideImplementationRecommendation,
  measurePaidPeakInputTokens,
  runForensicAssembly,
  runForensicMatrixSnapshot,
  subscriptionCapabilityLacksGlobalTier,
  verifyMainHeadIncludesPr987,
  buildForensicModelHeadroomRow,
  buildForensicCostRow,
  FORENSIC_AUDIT_MAIN_HEAD,
} from "./forensic-memory-cost-audit";

const LIVE_HEAD = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

describe("EXACT HEAD / PR #987 baseline", () => {
  it("records main HEAD and post-#987 architecture checks", () => {
    assert.equal(LIVE_HEAD, FORENSIC_AUDIT_MAIN_HEAD);
    const proof = verifyMainHeadIncludesPr987();
    assert.equal(proof.includesPr987, true);
    assert.equal(proof.checks.creatorLorebookAttachMax20, true);
    assert.equal(proof.checks.creatorTurnInjectMax4000, true);
    assert.equal(proof.checks.globalCurrentMemoryCanonicalOwner, true);
    assert.equal(proof.checks.mediumN15Owner, true);
    assert.equal(proof.checks.subscriptionCapabilityNoGlobalTier, true);
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
  it("PAID_GLOBAL15_SIM increases input only via Global section delta", () => {
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

  it("Free tier matrix unchanged by PAID_GLOBAL15 simulation harness", () => {
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
      if (Number.isFinite(headroom.contextPayloadCeiling) && headroom.contextPayloadCeiling < 1e12) {
        assert.ok(headroom.remainingHeadroom > 0);
      }
      const cost = buildForensicCostRow(assembly);
      assert.ok(cost.rawCostKrw >= 0);
      assert.ok(cost.chargePoints >= 0);
    });
  }
});

describe("REQUIRED QUESTIONS — deterministic evidence", () => {
  it("answers peak tokens, #985 reproducibility, Global15 delta, margin path", () => {
    const memoryHeavyPeak = measurePaidPeakInputTokens("MEMORY_HEAVY");
    const boundedPeak = measurePaidPeakInputTokens("BOUNDED_VALID_STRESS");
    assert.ok(memoryHeavyPeak > 0);
    assert.ok(boundedPeak >= memoryHeavyPeak);
    assert.ok(boundedPeak < 115_000, "post-#987 bounded stress must not reach historical #985 115K+");

    const modelId = MAIN_RP_MODEL_IDS[0]!;
    const snapshot = runForensicMatrixSnapshot({ modelId, loadClass: "MEMORY_HEAVY" });
    assert.ok(snapshot.global15InputTokenDelta > 0);
    assert.equal(snapshot.historyTrimOffset, false);

    let minHeadroom = Number.MAX_SAFE_INTEGER;
    let maxPointsDelta = 0;
    for (const id of MAIN_RP_MODEL_IDS) {
      const matrix = runForensicMatrixSnapshot({ modelId: id, loadClass: "MEMORY_HEAVY" });
      const headroom = buildForensicModelHeadroomRow(matrix.paid10);
      if (Number.isFinite(headroom.contextPayloadCeiling) && headroom.contextPayloadCeiling < 1e12) {
        minHeadroom = Math.min(minHeadroom, headroom.remainingHeadroom);
      }
      maxPointsDelta = Math.max(maxPointsDelta, matrix.global15PointsDelta);
    }

    const decision = decideImplementationRecommendation({
      memoryHeavyPeakInputTokens: memoryHeavyPeak,
      boundedStressPeakInputTokens: boundedPeak,
      minHeadroomAcrossModels: minHeadroom,
      global15PointsDeltaMax: maxPointsDelta,
      historyTrimOffsetObserved: false,
      freeTierAffected: false,
    });
    assert.equal(decision, "A");
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
  it("audit module has no fetch/openrouter provider generation imports", () => {
    const src = execSync("sed -n '1,120p' src/lib/memory/forensic-memory-cost-audit.ts", {
      encoding: "utf8",
    });
    assert.doesNotMatch(src, /fetch\s*\(/);
    assert.doesNotMatch(src, /openrouter.*com/i);
  });
});
