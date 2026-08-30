import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { StageUsage } from "@/lib/ai";
import {
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { computeTurnBilling } from "@/lib/points";
import { parseOpenRouterUsage, tokenUsageFromOpenRouterBreakdown } from "@/lib/openRouterUsage";
import {
  billableOpenRouterOutputTokens,
  resolveRouteApiTokensForCost,
  resolveTurnBillableInput,
  selectBillableStages,
  sumOpenRouterStageOutputTokens,
  sumOpenRouterStageReasoningTokens,
} from "@/lib/stageBillableUsage";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import { compareTurnBillableUsageWithLegacy } from "@/lib/turnBillableUsageCanary";
import { stageUsageReportingEvidenceFromTokenUsage } from "@/lib/usageReportingEvidence";
import {
  assertTurnBillableUsageCanaryTelemetryPrivacySafe,
  buildTurnBillableUsageCanaryErrorTelemetry,
  buildTurnBillableUsageCanaryTelemetry,
  logTurnBillableUsageCanaryTelemetry,
  observeTurnBillableUsageCanary,
  truncateTelemetryMetadataString,
  type TurnBillableUsageCanaryTelemetry,
} from "@/lib/turnBillableUsageProductionTelemetry";

function stage(partial: Partial<StageUsage> & Pick<StageUsage, "stage" | "model" | "input" | "output">): StageUsage {
  return { estimated: false, ...partial };
}

function productionStageUsageFromTokenUsage(
  usage: ReturnType<typeof tokenUsageFromOpenRouterBreakdown>,
  stageLabel: string,
  modelId: string
): StageUsage {
  return {
    stage: stageLabel,
    model: modelId,
    input: usage.inputTokens,
    output: usage.outputTokens,
    apiReportedInputTokens: usage.apiReportedInputTokens ?? usage.inputTokens,
    apiOutputTokens: usage.outputTokens,
    estimated: usage.estimated ?? false,
    ...(usage.cacheReadTokens != null && usage.cacheReadTokens > 0
      ? { cacheReadTokens: usage.cacheReadTokens }
      : {}),
    ...(usage.cacheWriteTokens != null && usage.cacheWriteTokens > 0
      ? { cacheWriteTokens: usage.cacheWriteTokens }
      : {}),
    ...(usage.reasoningOutputTokens != null && usage.reasoningOutputTokens > 0
      ? { apiReasoningOutputTokens: usage.reasoningOutputTokens }
      : {}),
    ...stageUsageReportingEvidenceFromTokenUsage(usage),
  };
}

function resolveLegacyRouteUsageBasis(opts: {
  stages: StageUsage[];
  modelId: string;
  refusalFallbackDelivered?: boolean;
  promptAuditTotal?: number | null;
}) {
  const billableStages = selectBillableStages(opts.stages, {
    refusalFallbackDelivered: opts.refusalFallbackDelivered ?? false,
  });
  const primaryStage = billableStages[0];
  const summedApiOutput = sumOpenRouterStageOutputTokens(opts.stages);
  const summedApiReasoning = sumOpenRouterStageReasoningTokens(opts.stages);
  const apiTokens = resolveRouteApiTokensForCost(primaryStage, summedApiOutput);
  const routeTotalInput = resolveTurnBillableInput({
    stageInput: primaryStage?.input ?? 0,
    promptAuditTotal: opts.promptAuditTotal ?? undefined,
  });
  const routeChargeOutput = billableOpenRouterOutputTokens(
    opts.modelId,
    apiTokens.apiCompletionTokensForCost,
    summedApiReasoning
  );
  return {
    legacy: {
      routeTotalInput,
      routeChargeOutput,
      cacheReadTokens: primaryStage?.cacheReadTokens ?? primaryStage?.cachedContentTokens ?? 0,
      cacheWriteTokens: primaryStage?.cacheWriteTokens ?? 0,
      apiCompletionTotal: apiTokens.apiCompletionTokensForCost,
      reasoningTotal: summedApiReasoning,
    },
    billableStageCount: billableStages.length,
  };
}

function captureInfoLogs(fn: () => void): {
  calls: Array<{ tag: unknown; payload: unknown }>;
} {
  const calls: Array<{ tag: unknown; payload: unknown }> = [];
  const info = mock.fn((tag: unknown, payload: unknown) => {
    calls.push({ tag, payload });
  });
  const original = console.info;
  console.info = info as typeof console.info;
  try {
    fn();
  } finally {
    console.info = original;
  }
  return { calls };
}

function observeWithCapture(
  opts: Parameters<typeof observeTurnBillableUsageCanary>[0],
  deps?: Parameters<typeof observeTurnBillableUsageCanary>[1]
) {
  return captureInfoLogs(() => observeTurnBillableUsageCanary(opts, deps));
}

function normalObserveOpts(modelId = OPENROUTER_QWEN_37_MAX_MODEL) {
  const stages = [
    stage({
      stage: "primary",
      model: modelId,
      input: 5000,
      output: 400,
      apiOutputTokens: 400,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
    }),
  ];
  const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
  return {
    stages,
    modelId,
    provider: "openrouter",
    stageCount: stages.length,
    billableStageCount,
    legacy,
  };
}

describe("turnBillableUsageProductionTelemetry — BEFORE correction characterization", () => {
  it("privacy assertion alone throws on unbounded builder output (defense remains active)", () => {
    const payload = {
      ...buildTurnBillableUsageCanaryErrorTelemetry({
        modelId: "x".repeat(100),
        provider: "openrouter",
        stageCount: 1,
        billableStageCount: 1,
        errorName: "Error",
      }),
      modelId: "x".repeat(100),
    };
    assert.throws(
      () => assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload),
      /telemetry string field exceeds safe metadata length/
    );
  });

  it("documented pre-correction escape class: overlong modelId through observer (fixed on current HEAD)", () => {
    const overlongModelId = "x".repeat(100);
    assert.doesNotThrow(() =>
      observeTurnBillableUsageCanary({
        ...normalObserveOpts(overlongModelId),
        modelId: overlongModelId,
      })
    );
  });
});

describe("turnBillableUsageProductionTelemetry — total no-throw adversarial (T1–T8)", () => {
  it("T1 normal match → exactly 1 match event when sink available", () => {
    const { calls } = observeWithCapture(normalObserveOpts());
    assert.equal(calls.length, 1);
    assert.equal((calls[0]?.payload as TurnBillableUsageCanaryTelemetry).status, "match");
  });

  it("T2 resolver throws → exactly 1 error event, observer does not throw", () => {
    const { calls } = observeWithCapture(normalObserveOpts(), {
      resolveTurnBillableUsage: () => {
        throw new TypeError("forced_canary_failure");
      },
    });
    assert.doesNotThrow(() =>
      observeTurnBillableUsageCanary(normalObserveOpts(), {
        resolveTurnBillableUsage: () => {
          throw new TypeError("forced_canary_failure");
        },
      })
    );
    assert.equal(calls.length, 1);
    assert.equal((calls[0]?.payload as TurnBillableUsageCanaryTelemetry).status, "error");
  });

  it("T3 overlong modelId → observer does not throw, emitted metadata bounded when sink works", () => {
    const overlongModelId = "m".repeat(100);
    const { calls } = observeWithCapture({
      ...normalObserveOpts(overlongModelId),
      modelId: overlongModelId,
    });
    assert.doesNotThrow(() =>
      observeTurnBillableUsageCanary({
        ...normalObserveOpts(overlongModelId),
        modelId: overlongModelId,
      })
    );
    assert.equal(calls.length, 1);
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.modelId.length, 64);
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("T4 overlong provider → observer does not throw, provider bounded when sink works", () => {
    const overlongProvider = "p".repeat(100);
    const opts = { ...normalObserveOpts(), provider: overlongProvider };
    const { calls } = observeWithCapture(opts);
    assert.doesNotThrow(() => observeTurnBillableUsageCanary(opts));
    assert.equal(calls.length, 1);
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.provider.length, 64);
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("T5 overlong selectedStage via injected candidate → observer does not throw, stage bounded", () => {
    const longStage = "s".repeat(100);
    const opts = normalObserveOpts();
    const { calls } = observeWithCapture(opts, {
      resolveTurnBillableUsage: () => ({
        status: "resolved",
        usage: {
          promptTokens: opts.legacy.routeTotalInput,
          cacheReadTokens: opts.legacy.cacheReadTokens,
          cacheWriteTokens: opts.legacy.cacheWriteTokens,
          reasoningTokens: opts.legacy.reasoningTotal,
          reasoningAccounting: "none",
        },
        usageCoverage: "complete",
        diagnostics: {
          selectedStage: longStage,
          stageCount: opts.stageCount,
          billableStageCount: opts.billableStageCount,
          stageInput: opts.legacy.routeTotalInput,
          routeTotalInput: opts.legacy.routeTotalInput,
          apiPromptTokensForCost: opts.legacy.routeTotalInput,
          apiCompletionTokensForCost: opts.legacy.apiCompletionTotal,
          routeChargeOutputTokens: opts.legacy.routeChargeOutput,
          cacheReadReported: true,
          cacheWriteReported: true,
          reasoningReported: false,
          promptAuditCapApplied: false,
          coverageReasons: [],
          fieldSources: {
            prompt: "PROVIDER_REPORTED_EXACT",
            cacheRead: "PROVIDER_REPORTED_EXACT",
            cacheWrite: "PROVIDER_REPORTED_EXACT",
            completion: "PROVIDER_REPORTED_EXACT",
            reasoning: "MISSING_AND_UNKNOWN",
          },
        },
      }),
    });
    assert.doesNotThrow(() => observeTurnBillableUsageCanary(opts, {
      resolveTurnBillableUsage: () => ({
        status: "resolved",
        usage: {
          promptTokens: opts.legacy.routeTotalInput,
          cacheReadTokens: opts.legacy.cacheReadTokens,
          cacheWriteTokens: opts.legacy.cacheWriteTokens,
          reasoningTokens: opts.legacy.reasoningTotal,
          reasoningAccounting: "none",
        },
        usageCoverage: "complete",
        diagnostics: {
          selectedStage: longStage,
          stageCount: opts.stageCount,
          billableStageCount: opts.billableStageCount,
          stageInput: opts.legacy.routeTotalInput,
          routeTotalInput: opts.legacy.routeTotalInput,
          apiPromptTokensForCost: opts.legacy.routeTotalInput,
          apiCompletionTokensForCost: opts.legacy.apiCompletionTotal,
          routeChargeOutputTokens: opts.legacy.routeChargeOutput,
          cacheReadReported: true,
          cacheWriteReported: true,
          reasoningReported: false,
          promptAuditCapApplied: false,
          coverageReasons: [],
          fieldSources: {
            prompt: "PROVIDER_REPORTED_EXACT",
            cacheRead: "PROVIDER_REPORTED_EXACT",
            cacheWrite: "PROVIDER_REPORTED_EXACT",
            completion: "PROVIDER_REPORTED_EXACT",
            reasoning: "MISSING_AND_UNKNOWN",
          },
        },
      }),
    }));
    assert.equal(calls.length, 1);
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.selectedStage?.length, 64);
    assert.equal(payload.status, "match");
  });

  it("T6 privacy validation forced failure → observer does not throw, no repeated log attempt", () => {
    const logTelemetry = mock.fn(() => {});
    assert.doesNotThrow(() =>
      observeTurnBillableUsageCanary(normalObserveOpts(), {
        assertPrivacySafe: () => {
          throw new Error("privacy_assert_failure");
        },
        logTelemetry: logTelemetry as typeof logTurnBillableUsageCanaryTelemetry,
      })
    );
    assert.equal(logTelemetry.mock.calls.length, 0);
  });

  it("T7 console.info throws → observer does not throw, no duplicate log attempt", () => {
    const logTelemetry = mock.fn(() => {
      throw new Error("sink broken");
    });
    assert.doesNotThrow(() =>
      observeTurnBillableUsageCanary(normalObserveOpts(), {
        logTelemetry: logTelemetry as typeof logTurnBillableUsageCanaryTelemetry,
      })
    );
    assert.equal(logTelemetry.mock.calls.length, 1);
  });

  it("T8 normal mismatch → exactly 1 mismatch event when sink available", () => {
    const opts = normalObserveOpts(OPENROUTER_GEMINI_31_PRO_MODEL);
    const { calls } = observeWithCapture({
      ...opts,
      legacy: { ...opts.legacy, routeTotalInput: opts.legacy.routeTotalInput + 1 },
    });
    assert.equal(calls.length, 1);
    assert.equal((calls[0]?.payload as TurnBillableUsageCanaryTelemetry).status, "mismatch");
  });

  it("T8 not_comparable → exactly 1 event when sink available", () => {
    const { calls } = observeWithCapture({
      stages: [],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      provider: "openrouter",
      stageCount: 0,
      billableStageCount: 0,
      legacy: {
        routeTotalInput: 0,
        routeChargeOutput: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        apiCompletionTotal: 0,
        reasoningTotal: 0,
      },
    });
    assert.equal(calls.length, 1);
    assert.equal((calls[0]?.payload as TurnBillableUsageCanaryTelemetry).status, "not_comparable");
  });
});

describe("turnBillableUsageProductionTelemetry — metadata bounding at projection owner", () => {
  it("buildTurnBillableUsageCanaryErrorTelemetry bounds modelId and provider", () => {
    const payload = buildTurnBillableUsageCanaryErrorTelemetry({
      modelId: "x".repeat(100),
      provider: "y".repeat(100),
      stageCount: 1,
      billableStageCount: 1,
      errorName: "Error",
    });
    assert.equal(payload.modelId.length, 64);
    assert.equal(payload.provider.length, 64);
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("truncateTelemetryMetadataString matches MAX length contract", () => {
    assert.equal(truncateTelemetryMetadataString("a".repeat(100)).length, 64);
  });
});

describe("turnBillableUsageProductionTelemetry — match (observable denominator)", () => {
  it("complete parity emits one match event with empty mismatchFields", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 12_000,
        output: 900,
        apiOutputTokens: 900,
        cacheReadTokens: 500,
        cacheWriteTokens: 100,
      }),
    ];
    const modelId = OPENROUTER_QWEN_37_MAX_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.tag, "[turn-billable-usage-canary]");
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "match");
    assert.deepEqual(payload.mismatchFields, []);
    assert.equal(payload.modelId, modelId);
    assert.equal(payload.provider, "openrouter");
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });
});

describe("turnBillableUsageProductionTelemetry — mismatch dimensions", () => {
  const baseStages = [
    stage({
      stage: "primary",
      model: OPENROUTER_GEMINI_31_PRO_MODEL,
      input: 5000,
      output: 400,
      apiOutputTokens: 400,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
    }),
  ];
  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;

  for (const [field, mutate] of [
    ["prompt", (legacy: ReturnType<typeof resolveLegacyRouteUsageBasis>["legacy"]) => ({ ...legacy, routeTotalInput: legacy.routeTotalInput + 1 })],
    ["cacheRead", (legacy: ReturnType<typeof resolveLegacyRouteUsageBasis>["legacy"]) => ({ ...legacy, cacheReadTokens: legacy.cacheReadTokens + 1 })],
    ["cacheWrite", (legacy: ReturnType<typeof resolveLegacyRouteUsageBasis>["legacy"]) => ({ ...legacy, cacheWriteTokens: legacy.cacheWriteTokens + 1 })],
    ["completionBasis", (legacy: ReturnType<typeof resolveLegacyRouteUsageBasis>["legacy"]) => ({ ...legacy, apiCompletionTotal: legacy.apiCompletionTotal + 1 })],
    ["reasoning", (legacy: ReturnType<typeof resolveLegacyRouteUsageBasis>["legacy"]) => ({ ...legacy, reasoningTotal: legacy.reasoningTotal + 1 })],
    ["routeChargeOutput", (legacy: ReturnType<typeof resolveLegacyRouteUsageBasis>["legacy"]) => ({ ...legacy, routeChargeOutput: legacy.routeChargeOutput + 1 })],
  ] as const) {
    it(`mismatch on ${field}`, () => {
      const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages: baseStages, modelId });
      const mutatedLegacy = mutate(legacy);
      const { calls } = observeWithCapture({
        stages: baseStages,
        modelId,
        provider: "openrouter",
        stageCount: baseStages.length,
        billableStageCount,
        legacy: mutatedLegacy,
      });
      assert.equal(calls.length, 1);
      const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
      assert.equal(payload.status, "mismatch");
      assert.ok(payload.mismatchFields.includes(field));
      assert.ok(payload.legacyBuckets);
      assert.ok(payload.candidateBuckets);
      assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
    });
  }
});

describe("turnBillableUsageProductionTelemetry — not_comparable", () => {
  it("cache unreported → partial", () => {
    const parsed = parseOpenRouterUsage({ prompt_tokens: 5000, completion_tokens: 400 });
    const tokenUsage = tokenUsageFromOpenRouterBreakdown(parsed);
    const stageUsage = productionStageUsageFromTokenUsage(
      tokenUsage,
      "openRouterAdult",
      OPENROUTER_GEMINI_31_PRO_MODEL
    );
    stageUsage.apiOutputTokens = parsed.completionTokens;
    const stages = [stageUsage];
    const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "not_comparable");
    assert.equal(payload.usageCoverage, "partial");
    assert.notEqual(payload.status, "match");
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("malformed cache evidence → partial", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
        input: 5000,
        output: 400,
        apiOutputTokens: 400,
        usageReportingEvidence: {
          cacheRead: "reported_invalid",
          cacheWrite: "reported_valid",
        },
      }),
    ];
    const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "not_comparable");
    assert.equal(payload.usageCoverage, "partial");
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("candidate unavailable (empty stages)", () => {
    const stages: StageUsage[] = [];
    const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      stageCount: 0,
      billableStageCount: 0,
      legacy: {
        routeTotalInput: 0,
        routeChargeOutput: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        apiCompletionTotal: 0,
        reasoningTotal: 0,
      },
    });
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "not_comparable");
    assert.equal(payload.candidateStatus, "unavailable");
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("cache exceeds capped prompt → unavailable", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 400,
        apiOutputTokens: 400,
        cacheReadTokens: 4000,
        cacheWriteTokens: 2000,
      }),
    ];
    const modelId = OPENROUTER_QWEN_37_MAX_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({
      stages,
      modelId,
      promptAuditTotal: 3000,
    });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      promptAuditTotal: 3000,
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "not_comparable");
    assert.equal(payload.candidateStatus, "unavailable");
    assert.equal(payload.coverageReason, "cache_exceeds_capped_prompt");
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("estimated usage → partial", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 400,
        apiOutputTokens: 400,
        estimated: true,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      }),
    ];
    const modelId = OPENROUTER_QWEN_37_MAX_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "not_comparable");
    assert.equal(payload.usageCoverage, "partial");
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("completion unavailable", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 0,
        apiOutputTokens: 0,
      }),
    ];
    const modelId = OPENROUTER_QWEN_37_MAX_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "not_comparable");
    assert.equal(payload.candidateStatus, "unavailable");
    assert.equal(payload.coverageReason, "completion_api_missing");
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });
});

describe("turnBillableUsageProductionTelemetry — error isolation", () => {
  it("resolve failure emits error telemetry without raw exception payload", () => {
    const { calls } = observeWithCapture({
      stages: [],
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      provider: "openrouter",
      stageCount: 0,
      billableStageCount: 0,
      legacy: {
        routeTotalInput: 0,
        routeChargeOutput: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        apiCompletionTotal: 0,
        reasoningTotal: 0,
      },
    }, {
      resolveTurnBillableUsage: () => {
        throw new TypeError("forced_canary_failure");
      },
    });
    assert.equal(calls.length, 1);
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "error");
    assert.equal(payload.errorName, "TypeError");
    assert.equal(payload.candidateStatus, "error");
    assert.equal(payload.usageCoverage, "error");
    assert.ok(!("stack" in payload));
    assert.ok(!("message" in payload));
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /forced_canary_failure/);
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("observe never throws to caller when resolve fails", () => {
    assert.doesNotThrow(() =>
      observeTurnBillableUsageCanary(
        {
          stages: [],
          modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
          provider: "openrouter",
          stageCount: 0,
          billableStageCount: 0,
          legacy: {
            routeTotalInput: 0,
            routeChargeOutput: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            apiCompletionTotal: 0,
            reasoningTotal: 0,
          },
        },
        {
          resolveTurnBillableUsage: () => {
            throw new Error("forced");
          },
        }
      )
    );
  });

  it("buildTurnBillableUsageCanaryErrorTelemetry is privacy-safe", () => {
    const payload = buildTurnBillableUsageCanaryErrorTelemetry({
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      provider: "openrouter",
      stageCount: 1,
      billableStageCount: 1,
      errorName: "Error",
    });
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });
});

describe("turnBillableUsageProductionTelemetry — privacy contract", () => {
  it("unexpected top-level key fails", () => {
    const candidate = resolveTurnBillableUsage({
      stages: [
        stage({
          stage: "primary",
          model: OPENROUTER_QWEN_37_MAX_MODEL,
          input: 5000,
          output: 400,
          apiOutputTokens: 400,
        }),
      ],
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    });
    const comparison = compareTurnBillableUsageWithLegacy(candidate, {
      routeTotalInput: 5000,
      routeChargeOutput: 400,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      apiCompletionTotal: 400,
      reasoningTotal: 0,
    });
    const payload = buildTurnBillableUsageCanaryTelemetry({
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      stageCount: 1,
      billableStageCount: 1,
      legacy: {
        routeTotalInput: 5000,
        routeChargeOutput: 400,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        apiCompletionTotal: 400,
        reasoningTotal: 0,
      },
      candidate,
      comparison,
    }) as TurnBillableUsageCanaryTelemetry & { userId?: string };
    payload.userId = "leak";
    assert.throws(
      () => assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload),
      /unexpected telemetry key: userId/
    );
  });

  it("unbounded manual payload still fails privacy assertion (defense)", () => {
    const payload = buildTurnBillableUsageCanaryErrorTelemetry({
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      provider: "openrouter",
      stageCount: 1,
      billableStageCount: 1,
      errorName: "Error",
    }) as TurnBillableUsageCanaryTelemetry & { modelId: string };
    payload.modelId = "x".repeat(100);
    assert.throws(
      () => assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload),
      /telemetry string field exceeds safe metadata length/
    );
  });

  it("serialized payload excludes forbidden conceptual identifiers and economics", () => {
    const stages = [
      stage({
        stage: "primary",
        model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        input: 9000,
        output: 2500,
        apiOutputTokens: 2500,
      }),
    ];
    const modelId = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "cheaperinference",
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const serialized = JSON.stringify(calls[0]?.payload);
    for (const forbidden of ["userId", "chatId", "requestId", "characterId", "krw", "usd", "points", "margin"]) {
      assert.doesNotMatch(serialized, new RegExp(`"${forbidden}"`, "i"));
    }
  });
});

describe("turnBillableUsageProductionTelemetry — route semantics characterization", () => {
  it("refusal fallback delivered → match with stratified provider", () => {
    const stages = [
      stage({ stage: "primary-refused", model: OPENROUTER_QWEN_37_MAX_MODEL, input: 8000, output: 100 }),
      stage({
        stage: "fallback",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 9500,
        output: 700,
        apiOutputTokens: 700,
        cacheReadTokens: 200,
        cacheWriteTokens: 50,
      }),
    ];
    const modelId = OPENROUTER_QWEN_37_MAX_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({
      stages,
      modelId,
      refusalFallbackDelivered: true,
    });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      refusalFallbackDelivered: true,
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "match");
    assert.equal(payload.selectedStage, "fallback");
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });

  it("primary + under-length recovery → match", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
        input: 10_000,
        output: 400,
        apiOutputTokens: 400,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      }),
      stage({
        stage: "server-under-length-recovery",
        model: OPENROUTER_GEMINI_31_PRO_MODEL,
        input: 11_000,
        output: 350,
        apiOutputTokens: 350,
      }),
    ];
    const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const payload = calls[0]?.payload as TurnBillableUsageCanaryTelemetry;
    assert.equal(payload.status, "match");
    assert.equal(payload.stageCount, 2);
    assert.equal(payload.billableStageCount, 1);
    assertTurnBillableUsageCanaryTelemetryPrivacySafe(payload);
  });
});

describe("turnBillableUsageProductionTelemetry — billing side-effect safety", () => {
  it("observe does not change computeTurnBilling totals (legacy authoritative)", () => {
    const stages = [
      stage({
        stage: "primary",
        model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        input: 9000,
        output: 2500,
        apiOutputTokens: 2500,
        apiReportedInputTokens: 30_000,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
      }),
    ];
    const modelId = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({
      stages,
      modelId,
      promptAuditTotal: 9000,
    });
    const billingBefore = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: modelId,
      inputTokens: legacy.routeTotalInput,
      outputTokens: legacy.routeChargeOutput,
      reasoningTokens: legacy.reasoningTotal,
      cacheReadTokens: legacy.cacheReadTokens,
      cacheWriteTokens: legacy.cacheWriteTokens,
      apiPromptTokens: 30_000,
      apiCompletionTokens: legacy.apiCompletionTotal,
    });
    observeTurnBillableUsageCanary({
      stages,
      modelId,
      provider: "cheaperinference",
      promptAuditTotal: 9000,
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    const billingAfter = computeTurnBilling({
      provider: "cheaperinference",
      openRouterModelId: modelId,
      inputTokens: legacy.routeTotalInput,
      outputTokens: legacy.routeChargeOutput,
      reasoningTokens: legacy.reasoningTotal,
      cacheReadTokens: legacy.cacheReadTokens,
      cacheWriteTokens: legacy.cacheWriteTokens,
      apiPromptTokens: 30_000,
      apiCompletionTokens: legacy.apiCompletionTotal,
    });
    assert.deepEqual(billingAfter, billingBefore);
  });
});

describe("turnBillableUsageProductionTelemetry — single log owner", () => {
  it("observe emits exactly one structured log line per evaluation when sink available", () => {
    const stages = [
      stage({
        stage: "primary",
        model: OPENROUTER_QWEN_37_MAX_MODEL,
        input: 5000,
        output: 400,
        apiOutputTokens: 400,
      }),
    ];
    const modelId = OPENROUTER_QWEN_37_MAX_MODEL;
    const { legacy, billableStageCount } = resolveLegacyRouteUsageBasis({ stages, modelId });
    const { calls } = observeWithCapture({
      stages,
      modelId,
      provider: "openrouter",
      stageCount: stages.length,
      billableStageCount,
      legacy,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.tag, "[turn-billable-usage-canary]");
  });

  it("logTurnBillableUsageCanaryTelemetry uses canonical tag", () => {
    const payload = buildTurnBillableUsageCanaryErrorTelemetry({
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      provider: "openrouter",
      stageCount: 1,
      billableStageCount: 1,
      errorName: "Error",
    });
    const { calls } = captureInfoLogs(() => logTurnBillableUsageCanaryTelemetry(payload));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.tag, "[turn-billable-usage-canary]");
  });
});
