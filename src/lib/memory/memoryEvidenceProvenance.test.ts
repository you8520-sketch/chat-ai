import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HISTORICAL_RP_QUALIFICATION_CHARACTER_ID } from "@/lib/rpMainRpStyleLengthFixture";
import { RP_QUALITY_PRECALL_TARGET_SELECTOR } from "@/lib/rpQualityPrecall";
import {
  MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN_EVIDENCE,
  canClaimCurrentLiveProvider,
  isDeterministicCodeRegression,
  memoryEvidenceTitle,
  provenanceFromQualityFixtureKind,
} from "@/lib/memory/memoryEvidenceProvenance";

describe("memory evidence provenance", () => {
  it("does not promote Phase 1 retrieve fixtures to CURRENT_LIVE_PROVIDER", () => {
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.provenance, "CURRENT_CODE_DETERMINISTIC");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.characterId, 18);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.characterId, RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId);
    assert.notEqual(
      MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.characterId,
      HISTORICAL_RP_QUALIFICATION_CHARACTER_ID
    );
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.providerPosts, 0);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.summaryQuality, "NOT_PROVEN");
    assert.equal(
      canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.provenance),
      false
    );
    assert.equal(
      isDeterministicCodeRegression(MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE.provenance),
      true
    );
  });

  it("does not promote Phase 2B canned summaries to CURRENT_LIVE_PROVIDER", () => {
    assert.equal(
      MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.provenance,
      "CURRENT_CODE_DETERMINISTIC"
    );
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.characterId, 18);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.providerPosts, 0);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.summaryQuality, "NOT_PROVEN");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.paidEvaluationApproved, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.maxAttemptsPerCase, 3);
    assert.equal(
      canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE.provenance),
      false
    );
  });

  it("does not promote the Phase 2C plan constant to CURRENT_LIVE_PROVIDER before a paid output", () => {
    assert.equal(
      MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN_EVIDENCE.provenance,
      "CURRENT_CODE_DETERMINISTIC"
    );
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN_EVIDENCE.paidEvaluationApproved, true);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN_EVIDENCE.providerPosts, 0);
    assert.equal(
      canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_PLAN_EVIDENCE.provenance),
      false
    );
  });

  it("keeps HISTORICAL_ONLY distinct from live-provider memory quality", () => {
    assert.equal(provenanceFromQualityFixtureKind("HISTORICAL_ONLY"), "HISTORICAL_ONLY");
    assert.equal(canClaimCurrentLiveProvider("HISTORICAL_ONLY"), false);
    assert.match(memoryEvidenceTitle("HISTORICAL_ONLY"), /not current-site quality/);
    assert.equal(provenanceFromQualityFixtureKind("GOLDEN_SNAPSHOT"), "CURRENT_CODE_DETERMINISTIC");
    assert.equal(provenanceFromQualityFixtureKind("CURRENT_LIVE"), "CURRENT_CODE_DETERMINISTIC");
    assert.equal(canClaimCurrentLiveProvider("CURRENT_CODE_DETERMINISTIC"), false);
  });
});
