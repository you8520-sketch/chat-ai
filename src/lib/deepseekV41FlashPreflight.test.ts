import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildV41FlashCandidatePriceMatrix,
  CI_DEEPSEEK_V41_FLASH_SNAPSHOT,
  DEEPSEEK_V41_FLASH_CANDIDATE_TARGET_MARGIN,
  DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE,
  DEEPSEEK_V41_FLASH_PEAK_BASELINE,
  DEEPSEEK_V4_PRO_PEAK_BASELINE,
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
});
