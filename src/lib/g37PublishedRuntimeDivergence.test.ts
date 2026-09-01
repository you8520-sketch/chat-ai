/**
 * G37 P0 Pass 2 — production forensic regression (R1 normal shadow, R2 regen dispatch).
 * Uses canonical owners only — no mock published producer, no test DI surface.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import { resolveChatBillingContract } from "@/lib/chatBillingContractDispatch";
import { computePublishedUserChargeWithSnapshot } from "@/lib/publishedUserCharge";
import { computeShadowPricing } from "@/lib/shadowPricing";
import { resolveShadowBillingExchangeRateSnapshot } from "@/lib/shadowBillingExchangeRate";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import type { NormalizedBillableUsage } from "@/lib/billingUsage";

function fxSnapshotFromShadow(): BillingFxSnapshot {
  const fx = resolveShadowBillingExchangeRateSnapshot();
  return {
    mode: fx.mode,
    dateKey: fx.dateKey,
    usdToKrw: fx.usdToKrw,
    effectiveKrwPerUsd: fx.effectiveKrwPerUsd,
    source: fx.source,
    overseasFeeRate: fx.overseasFeeRate,
    locked: fx.locked,
  };
}

/** cr_mtiedirf_thf6vkus — provider-reported normal G37 turn (chatId=707). */
const NORMAL_FORENSIC_USAGE: NormalizedBillableUsage = {
  promptTokens: 26038,
  cacheReadTokens: 20426,
  cacheWriteTokens: 0,
  standardInputTokens: 5612,
  visibleOutputTokens: 2662,
  reasoningTokens: 0,
  billableOutputTokens: 2662,
  reasoningAccounting: "none",
};

/** cr_mtiei4j7_c39yk536 — provider-reported regen G37 turn (same messageId=3895). */
const REGEN_FORENSIC_USAGE: NormalizedBillableUsage = {
  promptTokens: 26681,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  standardInputTokens: 26681,
  visibleOutputTokens: 3184,
  reasoningTokens: 0,
  billableOutputTokens: 3184,
  reasoningAccounting: "none",
};

function regenForensicStage(): StageUsage {
  return {
    stage: "Gemini 3.7 Flash",
    model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    input: 26681,
    output: 3184,
    apiOutputTokens: 3184,
    apiReportedInputTokens: 26681,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimated: false,
    usageReportingEvidence: {
      cacheRead: "reported_valid",
      cacheWrite: "reported_valid",
      reasoning: "reported_valid",
    },
  };
}

describe("G37 P0 Pass 2 — forensic published owner regressions", () => {
  it("R1 normal shadow: computeShadowPricing complete path never nullish .status", () => {
    const shadow = computeShadowPricing({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      promptTokens: NORMAL_FORENSIC_USAGE.promptTokens,
      cacheReadTokens: NORMAL_FORENSIC_USAGE.cacheReadTokens,
      cacheWriteTokens: NORMAL_FORENSIC_USAGE.cacheWriteTokens,
      outputTokens: NORMAL_FORENSIC_USAGE.visibleOutputTokens,
    });
    assert.ok(shadow.publishedChargeStatus === "complete" || shadow.publishedChargeStatus === "blocked");
    assert.notEqual(shadow.publishedChargeStatus, undefined);
  });

  it("R1 direct published owner: normal forensic usage returns total union (not undefined)", () => {
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage: NORMAL_FORENSIC_USAGE,
      usageCoverage: "complete",
      fxSnapshot: fxSnapshotFromShadow(),
      adjustment: { kind: "none" },
    });
    assert.notEqual(result, undefined);
    assert.notEqual(result, null);
    assert.ok(result.status === "complete" || result.status === "blocked");
    if (result.status === "blocked") {
      assert.equal(result.reason, "unsupported_cache_semantics");
    }
  });

  it("R2 regen dispatch: resolveChatBillingContract published_phase1 with forensic stage", () => {
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      stages: [regenForensicStage()],
      legacyFinalPoints: 61,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: fxSnapshotFromShadow(),
      phase1PublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "published_phase1");
    assert.ok(decision.points > 0);
    assert.equal(decision.telemetry.publishedCandidateStatus, "resolved");
  });

  it("R2 direct published owner: regen forensic usage returns complete (55P @ emergency FX)", () => {
    const result = computePublishedUserChargeWithSnapshot({
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      usage: REGEN_FORENSIC_USAGE,
      usageCoverage: "complete",
      fxSnapshot: fxSnapshotFromShadow(),
      adjustment: { kind: "none" },
    });
    assert.notEqual(result, undefined);
    assert.equal(result.status, "complete");
    if (result.status === "complete") {
      assert.equal(result.snapshot.finalPoints, 55);
    }
  });
});

describe("G37 P0 Pass 2 — build artifact parity guard", () => {
  it("production chunk core retains complete-path return after build", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const chunkPath = path.join(process.cwd(), ".next/server/chunks/2806.js");
    if (!fs.existsSync(chunkPath)) {
      // Build artifact optional in CI without prior npm run build — skip guard.
      return;
    }
    const src = fs.readFileSync(chunkPath, "utf8");
    const modStart = src.indexOf("61948:(a,b,c)=>");
    assert.ok(modStart >= 0, "publishedUserCharge module missing from chunk 2806");
    const modSlice = src.slice(modStart, modStart + 8000);
    assert.match(
      modSlice,
      /"complete"!==g[\s\S]*status:"complete",snapshot/,
      "compiled computePublishedUserChargeCore must retain complete return — rebuild after source change"
    );
  });
});
