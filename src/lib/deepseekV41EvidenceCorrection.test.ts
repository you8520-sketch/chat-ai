import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import type { StageUsage } from "@/lib/ai";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import { resolveChatBillingContract } from "@/lib/chatBillingContractDispatch";
import { getModelPublishedPricingPolicy } from "@/lib/modelPublishedPricingPolicy";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import type { UsageReportingEvidence } from "@/lib/usageReportingEvidence";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-21",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

function v41StageFromCaptured(opts: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  evidence: UsageReportingEvidence;
}): StageUsage {
  const stage: StageUsage = {
    stage: "primary",
    model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    input: opts.input,
    output: opts.output,
    apiOutputTokens: opts.output,
    apiReportedInputTokens: opts.input,
    estimated: false,
    usageReportingEvidence: opts.evidence,
  };
  if (opts.cacheRead != null && opts.cacheRead > 0) {
    stage.cacheReadTokens = opts.cacheRead;
  }
  if (opts.cacheWrite != null && opts.cacheWrite > 0) {
    stage.cacheWriteTokens = opts.cacheWrite;
  }
  return stage;
}

function dispatchV41(stages: StageUsage[]) {
  return resolveChatBillingContract({
    deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    stages,
    legacyFinalPoints: 999,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: FX,
    phase1PublishedBillingEnabled: false,
    phase2DeepSeekPublishedBillingEnabled: true,
  });
}

describe("deepseekV41EvidenceCorrection — billing replay from captured live usage", () => {
  it("no-cache V4.1 turn → published_phase2 complete v1", () => {
    const stage = v41StageFromCaptured({
      input: 5212,
      output: 1538,
      evidence: {
        cacheRead: "reported_valid",
        cacheWrite: "unreported",
        reasoning: "reported_valid",
      },
    });
    const usage = resolveTurnBillableUsage({
      stages: [stage],
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    });
    assert.equal(usage.status, "resolved");
    if (usage.status === "resolved") {
      assert.equal(usage.usageCoverage, "complete");
      assert.equal(usage.diagnostics.fieldSources.cacheWrite, "MISSING_BUT_PROVEN_ZERO");
    }
    const decision = dispatchV41([stage]);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.reason, "phase2_deepseek_live_grade");
    assert.equal(decision.telemetry.pricingVersion, 1);
    assert.equal(decision.telemetry.publishedBlockReason, null);
    assert.notEqual(decision.contract, "legacy");
  });

  it("positive cache-read V4.1 turn → published_phase2 complete v1", () => {
    const stage = v41StageFromCaptured({
      input: 5228,
      output: 2090,
      cacheRead: 4352,
      evidence: {
        cacheRead: "reported_valid",
        cacheWrite: "unreported",
        reasoning: "reported_valid",
      },
    });
    const decision = dispatchV41([stage]);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.telemetry.pricingVersion, 1);
    assert.equal(decision.telemetry.publishedBlockReason, null);
  });
});

describe("deepseekV41EvidenceCorrection — cache write boundary", () => {
  it("reported zero cacheWrite → published complete", () => {
    const stage = v41StageFromCaptured({
      input: 5200,
      output: 1500,
      cacheWrite: 0,
      evidence: {
        cacheRead: "reported_valid",
        cacheWrite: "reported_valid",
        reasoning: "reported_valid",
      },
    });
    const usage = resolveTurnBillableUsage({
      stages: [stage],
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    });
    assert.equal(usage.status, "resolved");
    if (usage.status === "resolved") {
      assert.equal(usage.usageCoverage, "complete");
    }
    const decision = dispatchV41([stage]);
    assert.equal(decision.contract, "published_phase2");
  });

  it("absent cacheWrite (unreported) → MISSING_BUT_PROVEN_ZERO", () => {
    const policy = getModelPublishedPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(policy?.cacheWriteAbsentSemantics, "proven_zero");
    const stage = v41StageFromCaptured({
      input: 5200,
      output: 1500,
      evidence: {
        cacheRead: "reported_valid",
        cacheWrite: "unreported",
        reasoning: "reported_valid",
      },
    });
    const usage = resolveTurnBillableUsage({
      stages: [stage],
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    });
    assert.equal(usage.status, "resolved");
    if (usage.status === "resolved") {
      assert.equal(usage.diagnostics.fieldSources.cacheWrite, "MISSING_BUT_PROVEN_ZERO");
      assert.equal(usage.usageCoverage, "complete");
    }
  });

  it("unexpected positive cacheWrite → unsupported_cache_semantics blocked", () => {
    const stage = v41StageFromCaptured({
      input: 5200,
      output: 1500,
      cacheWrite: 128,
      evidence: {
        cacheRead: "reported_valid",
        cacheWrite: "reported_valid",
        reasoning: "reported_valid",
      },
    });
    const decision = dispatchV41([stage]);
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.telemetry.publishedBlockReason, "unsupported_cache_semantics");
  });
});

describe("deepseekV41EvidenceCorrection — regression gates", () => {
  it("picker still excludes V4.1", () => {
    assert.equal(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL),
      false
    );
  });

  it("smoke fixture taxonomy documents F/G reclassification", () => {
    const taxonomy = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "docs/audits/deepseek-v41-integration-2026-09-21/smoke-fixture-taxonomy.json"
        ),
        "utf8"
      )
    ) as {
      fixtures: Record<string, { evidenceClass: string; doNotUseAs?: string[] }>;
    };
    assert.equal(taxonomy.fixtures.F_speech_lock.evidenceClass, "LENGTH_FREE_CONTINUATION");
    assert.deepEqual(taxonomy.fixtures.F_speech_lock.doNotUseAs, ["SPEECH_LOCK_PASS"]);
    assert.equal(
      taxonomy.fixtures.G_long_memory.evidenceClass,
      "AMBIGUOUS_SHARED_MEMORY_HANDLING"
    );
    assert.deepEqual(taxonomy.fixtures.G_long_memory.doNotUseAs, ["LONG_MEMORY_RECALL_PASS"]);
  });
});
