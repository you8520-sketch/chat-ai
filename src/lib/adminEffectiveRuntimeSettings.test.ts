import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { buildEffectiveRuntimeSettingsProjection } from "@/lib/adminEffectiveRuntimeSettings";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  DEFAULT_SELECTED_AI,
  GEMINI_38_FLASH_MODEL,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_37_FLASH_MODEL,
  resolveSelectedAI,
  selectedAIProvider,
} from "@/lib/chatModels";
import {
  applyCheaperInferenceModelReasoningPolicy,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
} from "@/lib/cheaperInferenceConfig";
import { MAIN_RP_OBSERVABILITY_MODEL_IDS } from "@/lib/mainRpPricingObservability";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpOpenRouterRoutePolicy,
  resolveMainRpPrimaryWireModelId,
} from "@/lib/openRouterConfig";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import { UNIFIED_TIER_AIM_CHARS } from "@/lib/responseLengthConstants";
import {
  BOT_MAX_PROVIDER_ATTEMPTS,
  GM_MAX_PROVIDER_ATTEMPTS,
  resolveTrpgCheaperInferenceModel,
} from "@/lib/trpg/gmCall";
import {
  TRPG_BOT_MAX_TOKENS,
  TRPG_BOT_MODEL,
  TRPG_GM_MAX_TOKENS,
  TRPG_GM_MODEL,
} from "@/lib/trpg/types";

const SECRET_ENV_CANARIES: Record<string, string> = {
  OPENROUTER_API_KEY: "sk-or-v1-runtime-projection-canary-0001",
  CHEAPER_INFERENCE_API_KEY: "ci-runtime-projection-canary-0002",
  OPENAI_API_KEY: "sk-openai-runtime-projection-canary-0003",
  ADMIN_EXPORT_SECRET: "admin-export-runtime-projection-canary-0004",
  ADMIN_DEBUG_TOKEN: "admin-debug-runtime-projection-canary-0005",
  SESSION_SECRET: "session-runtime-projection-canary-0006",
  DATABASE_URL: "postgres://user:pw-runtime-projection-canary-0007@db/app",
  PORTONE_API_SECRET: "portone-runtime-projection-canary-0008",
  PORTONE_WEBHOOK_SECRET: "portone-webhook-runtime-projection-canary-0009",
  ADULT_SCENE_HANDOFF_ADMIN_USER_IDS: "900110,900111",
  ADULT_SCENE_HANDOFF_ADMIN_CHAT_IDS: "900120",
};

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("effective runtime settings projection", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv(Object.keys(SECRET_ENV_CANARIES));
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it("A: Main RP active set and default are projected from the canonical registry", () => {
    const projection = buildEffectiveRuntimeSettingsProjection();
    assert.deepEqual(projection.mainRp.activeModelIds, [...MAIN_RP_MODEL_IDS]);
    assert.deepEqual(
      projection.mainRp.models.map((row) => [row.canonicalModelId, row.label]),
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => [option.id, option.label])
    );
    assert.equal(projection.mainRp.defaultModelId, DEFAULT_SELECTED_AI);
    assert.deepEqual(
      projection.mainRp.models.filter((row) => row.isDefault).map((row) => row.canonicalModelId),
      [DEFAULT_SELECTED_AI]
    );
    for (const row of projection.mainRp.models) {
      assert.equal(row.registryProvider, selectedAIProvider(row.canonicalModelId as never));
      assert.equal(row.wireModelId, resolveMainRpPrimaryWireModelId(row.canonicalModelId as never));
      const pricing = resolvePublishedPricingExact(row.wireModelId) ?? resolvePublishedPricingExact(row.canonicalModelId);
      assert.equal(row.publishedPricing?.canonicalModelId ?? null, pricing?.canonicalModelId ?? null);
      assert.equal(row.publishedPricing?.targetMargin ?? null, pricing?.pricing.targetMargin ?? null);
      assert.equal(
        row.publishedPricing?.minimumMarginFloor ?? null,
        pricing?.pricing.minimumMarginFloor ?? null
      );
    }
    assert.equal(projection.mutationSupported, false);
  });

  it("B: Main RP Gemini 3.8 resolves to the OpenRouter route policy owner", () => {
    const projection = buildEffectiveRuntimeSettingsProjection();
    const gemini = projection.mainRp.models.find((row) => row.canonicalModelId === GEMINI_38_FLASH_MODEL);
    assert.ok(gemini, "Gemini 3.8 Flash must be an active Main RP model");
    assert.equal(selectedAIProvider(GEMINI_38_FLASH_MODEL), "openrouter");
    assert.equal(gemini.registryProvider, selectedAIProvider(GEMINI_38_FLASH_MODEL));
    assert.equal(gemini.transportProvider, "openrouter");
    assert.equal(gemini.endpointHost, new URL(OPENROUTER_CHAT_COMPLETIONS_URL).host);
    assert.equal(gemini.wireModelId, resolveMainRpPrimaryWireModelId(GEMINI_38_FLASH_MODEL));
    const routePolicy = resolveMainRpOpenRouterRoutePolicy(gemini.wireModelId);
    assert.ok(routePolicy, "Gemini 3.8 Main RP route policy must exist");
    assert.deepEqual(gemini.providerRouting, routePolicy.provider);
    assert.equal(gemini.serviceTier, routePolicy.serviceTier);
  });

  it("C: TRPG Gemini 3.8 resolves to the CheaperInference request builder owner", () => {
    const projection = buildEffectiveRuntimeSettingsProjection();
    const [gm, bot] = projection.trpg.roles;
    assert.equal(gm?.workload, "trpg_gm");
    assert.equal(bot?.workload, "trpg_bot");
    for (const [row, model, maxTokens, attempts] of [
      [gm!, TRPG_GM_MODEL, TRPG_GM_MAX_TOKENS, GM_MAX_PROVIDER_ATTEMPTS],
      [bot!, TRPG_BOT_MODEL, TRPG_BOT_MAX_TOKENS, BOT_MAX_PROVIDER_ATTEMPTS],
    ] as const) {
      assert.equal(row.canonicalModelId, resolveTrpgCheaperInferenceModel(model));
      assert.equal(row.transportProvider, "cheaperinference");
      assert.equal(row.endpointHost, new URL(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL).host);
      assert.equal(row.wireModelId, resolveTrpgCheaperInferenceModel(model));
      assert.equal(
        row.requestContract.reasoningEffort,
        applyCheaperInferenceModelReasoningPolicy({ model: row.wireModelId }).reasoning_effort
      );
      assert.equal(row.transportMaxTokens, maxTokens);
      assert.equal(row.transportMaxTokensKind, "provider_model_capability_ceiling");
      assert.equal(row.isProseLengthCeiling, false);
      assert.equal(row.maxProviderAttempts, attempts);
    }
    assert.equal(TRPG_GM_MODEL, GEMINI_38_FLASH_MODEL);
    assert.equal(gm!.requestContract.reasoningEffort, "low");
  });

  it("D: the shared gemini-3.8-flash id keeps per-workload providers instead of one global provider", () => {
    const projection = buildEffectiveRuntimeSettingsProjection();
    const entries = projection.workloadRoutingByModelId[GEMINI_38_FLASH_MODEL];
    assert.ok(entries);
    const byWorkload = new Map(entries.map((entry) => [entry.workload, entry]));
    assert.equal(byWorkload.get("main_rp")?.transportProvider, "openrouter");
    assert.equal(byWorkload.get("trpg_gm")?.transportProvider, "cheaperinference");
    assert.equal(byWorkload.get("trpg_bot")?.transportProvider, "cheaperinference");
    assert.notEqual(byWorkload.get("main_rp")?.wireModelId, byWorkload.get("trpg_gm")?.wireModelId);
    assert.equal(new Set(entries.map((entry) => entry.transportProvider)).size, 2);
    for (const [modelId, rows] of Object.entries(projection.workloadRoutingByModelId)) {
      assert.equal(new Set(rows.map((row) => row.workload)).size, rows.length, modelId);
    }
  });

  it("E: retired Gemini 3.1 Pro Preview / 3.7 Flash are absent from the current Main RP set", () => {
    const projection = buildEffectiveRuntimeSettingsProjection();
    const retired = [
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      OPENROUTER_GEMINI_31_PRO_MODEL,
      OPENROUTER_GEMINI_37_FLASH_MODEL,
    ];
    for (const id of retired) {
      assert.equal(projection.mainRp.activeModelIds.includes(id), false, id);
      assert.equal(
        projection.mainRp.models.some((row) => row.canonicalModelId === id || row.wireModelId === id),
        false,
        id
      );
      assert.equal(projection.workloadRoutingByModelId[id], undefined, id);
    }
  });

  it("F: historical observability ids stay visible and resolve to a current Main RP model", () => {
    const projection = buildEffectiveRuntimeSettingsProjection();
    const active = new Set<string>(MAIN_RP_MODEL_IDS);
    assert.deepEqual(
      projection.historical.retiredObservableModelIds.map((row) => row.modelId),
      MAIN_RP_OBSERVABILITY_MODEL_IDS.filter((id) => !active.has(id))
    );
    const ids = projection.historical.retiredObservableModelIds.map((row) => row.modelId);
    assert.ok(ids.includes(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL));
    assert.ok(ids.includes(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL));
    for (const row of projection.historical.retiredObservableModelIds) {
      assert.equal(row.resolvesToCurrent, resolveSelectedAI(row.modelId));
      assert.ok(active.has(row.resolvesToCurrent), row.modelId);
    }
  });

  it("G: length is a 3,200+ soft aim with no application prose ceiling", () => {
    const projection = buildEffectiveRuntimeSettingsProjection();
    assert.equal(projection.length.softAimChars, UNIFIED_TIER_AIM_CHARS);
    assert.equal(projection.length.aimKind, "soft_target_not_ceiling");
    assert.equal(projection.length.applicationProseCeilingChars, null);
    assert.equal(projection.length.longerOutputPreserved, true);
    assert.equal(projection.length.wireMaxTokensSent, false);
    assert.equal(projection.length.chargingBasis, "actual_usage");
    for (const row of projection.mainRp.models) {
      assert.equal(row.wireMaxTokens, null, row.canonicalModelId);
    }
    for (const role of projection.trpg.roles) {
      assert.notEqual(role.transportMaxTokens, projection.length.applicationProseCeilingChars);
      assert.equal(role.isProseLengthCeiling, false);
    }
  });

  it("H: secret values never appear in the projection payload; only configured booleans", () => {
    for (const [key, value] of Object.entries(SECRET_ENV_CANARIES)) {
      process.env[key] = value;
    }
    const configured = buildEffectiveRuntimeSettingsProjection();
    const payload = JSON.stringify(configured);
    for (const [key, value] of Object.entries(SECRET_ENV_CANARIES)) {
      for (const fragment of value.split(",")) {
        assert.equal(payload.includes(fragment), false, `${key} leaked into projection`);
      }
    }
    assert.doesNotMatch(payload, /Bearer\s|sk-or-|Authorization/i);
    assert.equal(configured.credentials.openRouterApiKeyConfigured, true);
    assert.equal(configured.credentials.cheaperInferenceApiKeyConfigured, true);
    assert.equal(configured.featureFlags.adultHandoffAllowlistedAdminCount, 2);
    assert.equal(configured.featureFlags.adultHandoffAllowlistedChatCount, 1);

    delete process.env.OPENROUTER_API_KEY;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    const unconfigured = buildEffectiveRuntimeSettingsProjection();
    assert.equal(unconfigured.credentials.openRouterApiKeyConfigured, false);
    assert.equal(unconfigured.credentials.cheaperInferenceApiKeyConfigured, false);
  });
});
