import type { Usage } from "@/lib/chatUsage";

/**
 * Canonical top-level Usage keys that must never appear on public client serialization.
 * Single owner — do not duplicate this list elsewhere.
 */
export const PUBLIC_USAGE_INTERNAL_TOP_LEVEL_KEYS = [
  "upstreamCostUsd",
  "cacheDiscountUsd",
  "apiRawCostKrw",
  "apiRawCostSource",
  "normalizedRawCostKrw",
  "mainApiRawCostKrw",
  "exchangeRateKrwPerUsd",
  "exchangeRateDateKey",
  "exchangeRateMode",
  "exchangeRateSource",
  "statusWidgetExtract",
  "statusWidgetExtractDiagnostics",
  "shadowPricing",
  "publishedChargeSnapshot",
  "adminBillingReceipt",
  "apiCallCount",
  "widgetCostPoints",
  "gemini37FlashPricing",
  "assembledPromptChars",
  "breakdownAllocation",
  "rawHistoryHealth",
  "museAcceptance",
  "adultRouting",
  "usedEnglishCharacterPrompt",
  "characterPromptLanguage",
  "generationKind",
  "canonical",
  "canonAdopted",
  "canonAdoptedAt",
  "coldStartShieldApplied",
  "uncappedChargePoints",
  "coldStartCostFloorPoints",
  "cacheReadLine",
  "cacheWriteLine",
  "cacheRateSummary",
  "cacheFamily",
  /** Provider cache accounting — admin receipt only. */
  "cacheReadTokens",
  "cacheWriteTokens",
  "standardInputTokens",
  /** Internal physical-call / recovery topology. */
  "lengthRecoveryPasses",
  /** Internal prompt assembly telemetry. */
  "assembledInputTokens",
  /** Legacy unused fallback model label on Usage — no public reader. */
  "fallback",
] as const;

/**
 * Stage-level keys stripped from each Usage.stages[] entry for public serialization.
 * User-visible stage identity (stage/model/input/output/finishReason/estimated/truncated) is kept.
 */
export const PUBLIC_USAGE_INTERNAL_STAGE_KEYS = [
  "upstreamCostUsd",
  "cheaperInferenceBilledCostUsd",
  "cacheDiscountUsd",
  "usageReportingEvidence",
  "providerRequestId",
  "debugRawUsage",
  "cacheReadTokens",
  "cacheWriteTokens",
  "standardInputTokens",
  "apiReportedInputTokens",
  "cachePaddingTokens",
  "cachedContentTokens",
  "thoughtsTokens",
  "apiOutputTokens",
  "apiReasoningOutputTokens",
  "lengthRecoveryPasses",
  "savedOutputChars",
  "loopAborted",
  "degenerationAborted",
  /** Per-stage point allocation — admin multi-stage receipt only; public UI uses top-level cost. */
  "cost",
] as const;

/** Defense-in-depth patterns for assertNoInternalEconomics — not used in production sanitizer. */
export const INTERNAL_ECONOMICS_KEY_SUBSTRINGS = [
  "actualProviderCost",
  "providerListCost",
  "billingReferenceCost",
  "margin",
  "grossProfit",
  "apiRawCost",
  "upstreamCost",
  "cheaperInferenceBilledCost",
  "exchangeRate",
  "overseasFee",
  "providerSavings",
  "providerOverrun",
  "shadowPricing",
  "statusWidgetExtract",
  "providerRequestId",
  "usageReportingEvidence",
] as const;

export type PublicStageUsage = {
  stage: string;
  model: string;
  input: number;
  output: number;
  finishReason?: string;
  estimated?: boolean;
  truncated?: boolean;
};

export function sanitizePublicStageUsage(
  stage: NonNullable<Usage["stages"]>[number]
): PublicStageUsage {
  const copy = { ...stage } as Record<string, unknown>;
  for (const key of PUBLIC_USAGE_INTERNAL_STAGE_KEYS) {
    delete copy[key];
  }
  return {
    stage: String(copy.stage ?? ""),
    model: String(copy.model ?? ""),
    input: typeof copy.input === "number" ? copy.input : 0,
    output: typeof copy.output === "number" ? copy.output : 0,
    ...(typeof copy.finishReason === "string" ? { finishReason: copy.finishReason } : {}),
    ...(typeof copy.estimated === "boolean" ? { estimated: copy.estimated } : {}),
    ...(typeof copy.truncated === "boolean" ? { truncated: copy.truncated } : {}),
  };
}

export function sanitizePublicStages(
  stages: Usage["stages"] | undefined
): Usage["stages"] | undefined {
  if (!stages?.length) return stages;
  return stages.map((stage) => sanitizePublicStageUsage(stage)) as Usage["stages"];
}

export function omitInternalTopLevelUsageFields(
  usage: Usage & Record<string, unknown>
): Record<string, unknown> {
  const copy = { ...usage } as Record<string, unknown>;
  for (const key of PUBLIC_USAGE_INTERNAL_TOP_LEVEL_KEYS) {
    delete copy[key];
  }
  return copy;
}

function collectLeakedEconomicsKeys(
  value: unknown,
  path: string,
  leaks: string[],
  inStage = false
): string[] {
  if (value == null) return leaks;
  if (Array.isArray(value)) {
    const nextInStage = inStage || path.endsWith(".stages") || path === "stages";
    value.forEach((entry, index) => {
      collectLeakedEconomicsKeys(entry, `${path}[${index}]`, leaks, nextInStage);
    });
    return leaks;
  }
  if (typeof value !== "object") return leaks;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${key}` : key;
    const stageContext = inStage || fullPath.startsWith("stages[");
    if (
      PUBLIC_USAGE_INTERNAL_TOP_LEVEL_KEYS.includes(
        key as (typeof PUBLIC_USAGE_INTERNAL_TOP_LEVEL_KEYS)[number]
      ) ||
      (stageContext &&
        PUBLIC_USAGE_INTERNAL_STAGE_KEYS.includes(
          key as (typeof PUBLIC_USAGE_INTERNAL_STAGE_KEYS)[number]
        ))
    ) {
      leaks.push(fullPath);
      continue;
    }
    const lower = key.toLowerCase();
    if (
      INTERNAL_ECONOMICS_KEY_SUBSTRINGS.some((fragment) =>
        lower.includes(fragment.toLowerCase())
      )
    ) {
      leaks.push(fullPath);
      continue;
    }
    const childInStage = stageContext || key === "stages";
    collectLeakedEconomicsKeys(nested, fullPath, leaks, childInStage);
  }
  return leaks;
}

/** Test helper — defense-in-depth leak assertion for public Usage payloads. */
export function assertNoInternalEconomics(
  publicUsage: Usage,
  context = "publicUsage"
): void {
  const leaks = collectLeakedEconomicsKeys(publicUsage, "", []);
  if (leaks.length > 0) {
    throw new Error(
      `${context}: internal economics leaked on public Usage at ${leaks.sort().join(", ")}`
    );
  }
}
