import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HISTORICAL_RP_QUALIFICATION_CHARACTER_ID } from "@/lib/rpMainRpStyleLengthFixture";
import { RP_QUALITY_PRECALL_TARGET_SELECTOR } from "@/lib/rpQualityPrecall";
import {
  MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE,
  MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE,
  canClaimCurrentLiveProvider,
  canClaimCurrentProductionParity,
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

  it("archives the Phase 2C Luna sample without a rerun license or production parity", () => {
    assert.equal(
      MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.provenance,
      "CURRENT_LIVE_PROVIDER"
    );
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.providerPosts, 1);
    assert.equal(
      MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.providerRequestId,
      "52c1bd6a-23c2-4f82-83b4-9c9db9361694"
    );
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.billedUsd, 0.000209);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.rerunAuthorized, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.paidEvaluationApproved, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.executionHost, "CURSOR_VM");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.runtimeShaSource, "GITHUB_DEPLOY_METADATA");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.observedRuntimeSha, null);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.characterSheetRead, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.productionPersonaRead, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.productionRuntimeParity, "UNPROVEN");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.productionIdentityParity, "UNPROVEN");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.homepageParity, "UNPROVEN");
    assert.equal(
      canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.provenance),
      true
    );
    assert.equal(
      canClaimCurrentProductionParity({
        executionHost: MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.executionHost,
        runtimeShaSource: MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.runtimeShaSource,
        observedRuntimeSha: MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.observedRuntimeSha,
        characterSheetRead: MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.characterSheetRead,
        productionPersonaRead: MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.productionPersonaRead,
      }),
      false
    );
  });

  it("does not treat a hardcoded Railway deploy SHA as production-runtime parity", () => {
    const hardcodedSha = MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE.railwayDeployMetadataSha;
    assert.equal(
      canClaimCurrentProductionParity({
        executionHost: "CURSOR_VM",
        runtimeShaSource: "HARDCODED_CONSTANT",
        observedRuntimeSha: hardcodedSha,
        characterSheetRead: false,
        productionPersonaRead: false,
      }),
      false
    );
    assert.equal(
      canClaimCurrentProductionParity({
        executionHost: "RAILWAY_PRODUCTION_CONTAINER",
        runtimeShaSource: "HARDCODED_CONSTANT",
        observedRuntimeSha: hardcodedSha,
        characterSheetRead: true,
        productionPersonaRead: true,
      }),
      false
    );
    assert.equal(
      canClaimCurrentProductionParity({
        executionHost: "RAILWAY_PRODUCTION_CONTAINER",
        runtimeShaSource: "GITHUB_DEPLOY_METADATA",
        observedRuntimeSha: hardcodedSha,
        characterSheetRead: true,
        productionPersonaRead: true,
      }),
      false
    );
    assert.equal(
      canClaimCurrentLiveProvider("CURRENT_LIVE_PROVIDER"),
      true
    );
    assert.match(
      memoryEvidenceTitle("CURRENT_LIVE_PROVIDER"),
      /not proven production-runtime parity/
    );
  });

  it("does not treat the Phase 3A preflight plan as live provider or production parity", () => {
    assert.equal(
      MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.provenance,
      "CURRENT_CODE_DETERMINISTIC"
    );
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.providerPosts, 0);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.paidEvaluationApproved, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.pathASeededRecall, "NOT_EXECUTED");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.pathBLunaEndToEnd, "NOT_EXECUTED");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.modelReplyQuality, "NOT_PROVEN");
    assert.equal(
      canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.provenance),
      false
    );
    assert.equal(
      canClaimCurrentProductionParity({
        executionHost: MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.executionHost,
        runtimeShaSource: "UNOBSERVED",
        observedRuntimeSha: null,
        characterSheetRead: MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.characterSheetRead,
        productionPersonaRead: MONTHLY_RP_MEMORY_QUALITY_PHASE3A_PLAN_EVIDENCE.productionPersonaRead,
      }),
      false
    );
  });

  it("archives the Phase 3B Path A sample without a rerun license or production parity", () => {
    assert.equal(
      MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.provenance,
      "CURRENT_LIVE_PROVIDER"
    );
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.providerPosts, 8);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.successfulGenerationPosts, 6);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.failedGenerationPosts, 2);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.lunaPosts, 0);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.productionDbWrites, 0);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.billedUsd, null);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.billedUsdStatus, "UNREPORTED");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.rerunAuthorized, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.paidEvaluationApproved, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.executionHost, "CURSOR_VM");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.path, "A_SEEDED_MEMORY");
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.characterSheetRead, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.productionPersonaRead, false);
    assert.equal(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.productionRuntimeParity, "UNPROVEN");
    assert.equal(
      canClaimCurrentLiveProvider(MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.provenance),
      true
    );
    assert.equal(
      canClaimCurrentProductionParity({
        executionHost: MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.executionHost,
        runtimeShaSource: MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.runtimeShaSource,
        observedRuntimeSha: MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.observedRuntimeSha,
        characterSheetRead: MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.characterSheetRead,
        productionPersonaRead: MONTHLY_RP_MEMORY_QUALITY_PHASE3B_SAMPLE_EVIDENCE.productionPersonaRead,
      }),
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
