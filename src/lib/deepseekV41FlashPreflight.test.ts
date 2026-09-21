import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTHORING_SCOPE_MATRIX,
  buildV41FlashCandidatePriceMatrix,
  CANON_PLAYBOOK,
  CACHE_SEMANTICS_AUDIT,
  CI_DEEPSEEK_V41_FLASH_SNAPSHOT,
  D_LORE_CONTEXT_SOURCES,
  D_LORE_SAMPLE_B_RE_EVALUATION,
  DEEPSEEK_V41_FLASH_CANDIDATE_TARGET_MARGIN,
  DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE,
  DEEPSEEK_V41_FLASH_PEAK_BASELINE,
  DEEPSEEK_V4_PRO_PEAK_BASELINE,
  DETECTOR_TELEMETRY_AUDIT,
  FINAL_REQUEST_PARITY_SUMMARY,
  LENGTH_EVALUATION_CORRECTIONS,
  V41_WIRE_OWNER_PLAN,
} from "@/lib/deepseekV41FlashPreflight";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { getPublishedPricing } from "@/lib/publishedModelPricing";

describe("deepseek v4.1 flash preflight", () => {
  it("candidate peak baseline matches product decision", () => {
    assert.equal(DEEPSEEK_V41_FLASH_PEAK_BASELINE.cacheMissInputUsdPerMillion, 0.3);
    assert.equal(DEEPSEEK_V41_FLASH_PEAK_BASELINE.outputUsdPerMillion, 1.2);
    assert.equal(DEEPSEEK_V41_FLASH_PEAK_BASELINE.cacheHitInputUsdPerMillion, 0.006);
    assert.equal(DEEPSEEK_V41_FLASH_CANDIDATE_TARGET_MARGIN, 0.6);
  });

  it("candidate BASE is independent of CI current procurement swing", () => {
    const matrix = buildV41FlashCandidatePriceMatrix();
    const normal = matrix.find((r) => r.shape === "NORMAL")!;
    const altCurrent = CI_DEEPSEEK_V41_FLASH_SNAPSHOT.currentInputUsdPerMillion * 2;
    assert.notEqual(altCurrent, DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE.billingReferenceInputUsdPerMillion);
    assert.ok(normal.candidateBaseP > 0);
    assert.ok(normal.candidateRealizedMargin > normal.ciProcurementKrw / normal.candidateBaseP);
  });

  it("flash candidate P is below pro peak-base P on NORMAL shape", () => {
    const row = buildV41FlashCandidatePriceMatrix().find((r) => r.shape === "NORMAL")!;
    assert.ok(row.flashToProPriceRatio < 1);
    assert.ok(row.v4ProPeakBaseP > row.candidateBaseP);
  });

  it("pro published row unchanged (off-peak legacy ref)", () => {
    const pro = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(pro.billingReferenceInputUsdPerMillion, 0.66);
    assert.equal(pro.targetMargin, 0.5);
    assert.notEqual(pro.billingReferenceInputUsdPerMillion, DEEPSEEK_V4_PRO_PEAK_BASELINE.cacheMissInputUsdPerMillion);
  });

  it("CI list for v4.1-flash aligns with peak baseline not off-peak", () => {
    assert.equal(CI_DEEPSEEK_V41_FLASH_SNAPSHOT.listInputUsdPerMillion, 0.3);
    assert.equal(CI_DEEPSEEK_V41_FLASH_SNAPSHOT.listOutputUsdPerMillion, 1.2);
  });

  it("correction: D_lore Sample B is a creative gap fill, not a canon contradiction", () => {
    assert.equal(D_LORE_SAMPLE_B_RE_EVALUATION.classification, "VALID_CREATIVE_GAP_FILL");
    assert.equal(D_LORE_SAMPLE_B_RE_EVALUATION.conflictingCanonSources, null);
    assert.ok(D_LORE_SAMPLE_B_RE_EVALUATION.inventedElements.some((e) => e.includes("c-lore")));
    assert.ok(D_LORE_CONTEXT_SOURCES.some((s) => s.includes("견습 실패")));
  });

  it("correction pass — canon playbook keeps UNKNOWN not forbidden", () => {
    assert.equal(CANON_PLAYBOOK.creatorCanon, "PRESERVE");
    assert.equal(CANON_PLAYBOOK.opensUnknownHistory, "VALID_CREATIVE_GAP_FILL");
    assert.equal(CANON_PLAYBOOK.explicitNegation, "DO_NOT_CONTRADICT");
  });

  it("authoring scope matrix covers standard/auto/dlg/act/full with real owner names", () => {
    assert.equal(AUTHORING_SCOPE_MATRIX.length, 6);
    const modes = new Set(AUTHORING_SCOPE_MATRIX.map((r) => r.currentTurnDelegation));
    for (const required of ["none", "DIALOGUE", "ACTIONS", "FULL"]) {
      assert.ok(modes.has(required), `delegation scope ${required} recorded`);
    }
    assert.ok(AUTHORING_SCOPE_MATRIX.every((r) => r.promptOwner.length > 0));
  });

  it("final request parity records only identity-level deltas", () => {
    assert.equal(FINAL_REQUEST_PARITY_SUMMARY.perFixtureDiffs.systemPromptCharDelta, 27);
    assert.equal(FINAL_REQUEST_PARITY_SUMMARY.identical.samplingTemperature, 0.92);
    assert.match(FINAL_REQUEST_PARITY_SUMMARY.verdict, /not model substitution|SAME intended non-thinking/i);
  });

  it("pre-wire owner plan does not repurpose the 0731 constant", () => {
    assert.equal(V41_WIRE_OWNER_PLAN.notPatchedThisPreflight, true);
    assert.ok(
      V41_WIRE_OWNER_PLAN.design.some((s) => s.includes("separate from 0731")),
      "explicit separate registry entry"
    );
  });

  it("cache semantics stay read-only READY (no write-price guess)", () => {
    assert.equal(CACHE_SEMANTICS_AUDIT.cacheReadProven, true);
    assert.equal(CACHE_SEMANTICS_AUDIT.cacheWriteVerdict, "NOT_ASSUMED — cache_write_tokens observed 0; no separate write price exists");
    assert.equal(CACHE_SEMANTICS_AUDIT.readyScope, "cache_read_only");
  });

  it("length/initiative evaluation: Flash near-target is not a defect", () => {
    assert.ok(LENGTH_EVALUATION_CORRECTIONS.verdict.flash_F_speech_lock.includes("VALID_ACTIVE_RP"));
  });

  it("detector audit records scope-blindness as follow-up, not patch", () => {
    assert.ok(DETECTOR_TELEMETRY_AUDIT.userImpersonationGuard.missingScope.length > 0);
    assert.ok(DETECTOR_TELEMETRY_AUDIT.ownershipShadowDetectorV2.missingScope.length > 0);
    assert.match(DETECTOR_TELEMETRY_AUDIT.production ?? DETECTOR_TELEMETRY_AUDIT.verdict, /shadow|log/i);
  });
});
