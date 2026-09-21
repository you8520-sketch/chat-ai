/**
 * One-off RED reproduction — stable Phase2 direct-selected published billing failure
 * silently falls back to procurement-coupled legacy BASE. PROVIDER_CALLS=0.
 */
import {
  buildBillingLiveOwnerReadinessFixtures,
  computeLiveChargeFromFixture,
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
} from "@/lib/billingLiveOwnerReadinessAudit";
import { resolveChatBillingContract } from "@/lib/chatBillingContractDispatch";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import { computeOpenRouterTurnBilling } from "@/lib/points";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

function blockedStage(upstreamUsd: number) {
  return {
    stage: "primary" as const,
    model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    input: 10_000,
    output: 500,
    apiOutputTokens: 500,
    apiReportedInputTokens: 10_000,
    cacheWriteTokens: 128,
    cacheReadTokens: 0,
    estimated: false,
    upstreamCostUsd: upstreamUsd,
    usageReportingEvidence: {
      cacheRead: "reported_valid" as const,
      cacheWrite: "reported_valid" as const,
      reasoning: "unreported" as const,
    },
  };
}

installAuditLegacyFxForTest();
const base = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-deepseek-normal")!;

console.log("--- upstreamCostUsd sensitivity (computeOpenRouterTurnBilling) ---");
for (const modelId of [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL] as const) {
  for (const up of [undefined, 0.001, 0.01, 0.05, 0.5] as const) {
    const billing = computeOpenRouterTurnBilling({
      modelId,
      inputTokens: 33_247,
      outputTokens: 3_461,
      apiPromptTokens: 33_247,
      apiCompletionTokens: 3_461,
      ...(up != null ? { upstreamCostUsd: up } : {}),
    });
    console.log(
      JSON.stringify({ modelId, upstreamUsd: up ?? "catalog_only", legacyTotal: billing.total })
    );
  }
}

for (const up of [0.005, 0.05] as const) {
  const stage = blockedStage(up);
  const legacy = computeLiveChargeFromFixture({
    ...base,
    stages: [stage],
    upstreamCostUsd: up,
    deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    requestedSelectedAI: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  }).totalPoints;
  const decision = resolveChatBillingContract({
    deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    stages: [stage],
    legacyFinalPoints: legacy,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: FX,
    phase2DeepSeekPublishedBillingEnabled: true,
  });
  console.log(
    JSON.stringify({
      upstreamUsd: up,
      legacyFinalPoints: legacy,
      contract: decision.contract,
      reason: decision.reason,
      settledPoints: decision.points,
      publishedBlockReason: decision.telemetry.publishedBlockReason,
      policyViolation:
        decision.contract === "legacy" &&
        decision.points === legacy &&
        decision.telemetry.publishedCandidateStatus === "blocked",
    })
  );
}
clearAuditLegacyFxForTest();
