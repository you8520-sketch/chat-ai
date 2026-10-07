import {
  buildAdminMemoryRuntimeStatus,
  type AdminMemoryRuntimeStatus,
} from "@/lib/adminMemoryRuntimeStatus";
import { resolveAdultRefusalFallbackModelId } from "@/lib/adultHandoffSourceRouting";
import { resolveAdultSceneHandoffCanaryConfig } from "@/lib/adultSceneHandoffCanary";
import { resolveAdultRoutingConfig } from "@/lib/adultSceneRouting";
import {
  isPhase1PublishedBillingEnabled,
  isPhase2DeepSeekPublishedBillingEnabled,
  resolvePublishedBillingPhase,
} from "@/lib/chatBillingContractDispatch";
import {
  DEFAULT_SELECTED_AI,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
  type SelectedAIOptionMeta,
} from "@/lib/chatModels";
import {
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceChatCompletionsUrl,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS } from "@/lib/deepseekProviderFailover";
import { MAIN_RP_OBSERVABILITY_MODEL_IDS } from "@/lib/mainRpObservabilityModelIds";
import { isMockApiMode } from "@/lib/mockApiMode";
import { buildOpenRouterRequestBody } from "@/lib/openRouterClient";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveMainRpOpenRouterRoutePolicy,
  resolveMainRpPrimaryWireModelId,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterConfig";
import { isPaymentsEnabled } from "@/lib/portoneConfig";
import {
  resolvePublishedCommercialPricingOwner,
  resolvePublishedPricingExact,
} from "@/lib/publishedModelPricing";
import {
  clampResponseLength,
  isOverResponseTarget,
  resolveStreamCharCap,
} from "@/lib/responseLength";
import {
  DEFAULT_TARGET_RESPONSE_CHARS,
  RESPONSE_LENGTH_UI_LABEL,
  resolveResponseLengthTarget,
} from "@/lib/responseLengthConstants";
import {
  BOT_MAX_PROVIDER_ATTEMPTS,
  buildTrpgBotProviderRequest,
  buildTrpgGmProviderRequest,
  GM_MAX_PROVIDER_ATTEMPTS,
  GM_RETRYABLE_HTTP_STATUSES,
  type TrpgProviderRequest,
} from "@/lib/trpg/gmCall";
import { trpgProviderRequestContract } from "@/lib/trpg/gmClient";

/**
 * Read-only projection of the effective runtime configuration.
 *
 * This module owns no runtime value. Every field is read from the live
 * canonical owner (registry, request builder, policy resolver).
 * It does not import openRouterAdult or @/lib/points so inspector reads
 * do not trigger the Muse snapshot FX refresh. Credentials are booleans only.
 */

type TransportProvider = "openrouter" | "cheaperinference";

export type RuntimeWorkload = "main_rp" | "trpg_gm" | "trpg_bot";

export type RuntimeReasoningProjection = {
  reasoning: unknown;
  reasoningEffort: unknown;
  thinking: unknown;
  outputConfig: unknown;
  includeReasoning: unknown;
};

export type RuntimePublishedPricingProjection = {
  canonicalModelId: string;
  pricingVersion: number;
  publishedAt: string;
  commercialPricingOwner: string;
  targetMargin: number;
  minimumMarginFloor: number;
};

export type MainRpModelRuntimeRow = {
  workload: "main_rp";
  canonicalModelId: string;
  label: string;
  isDefault: boolean;
  recommended: boolean;
  registryProvider: SelectedAIOptionMeta["provider"];
  transportProvider: TransportProvider;
  endpointHost: string;
  wireModelId: string;
  providerRouting: unknown;
  serviceTier: unknown;
  reasoning: RuntimeReasoningProjection;
  samplingTemperature: number | null;
  wireMaxTokens: number | null;
  promptCacheAffinity: "openrouter_session_id" | "cheaperinference_session_query" | "none";
  billingPhase: "phase1" | "phase2" | "legacy";
  publishedPricing: RuntimePublishedPricingProjection | null;
};

export type TrpgRuntimeRow = {
  workload: "trpg_gm" | "trpg_bot";
  canonicalModelId: string;
  transportProvider: TrpgProviderRequest["provider"];
  endpointHost: string;
  wireModelId: string;
  reasoning: RuntimeReasoningProjection;
  requestContract: ReturnType<typeof trpgProviderRequestContract>;
  stream: boolean;
  transportMaxTokens: number | null;
  transportMaxTokensKind: "provider_model_capability_ceiling";
  isProseLengthCeiling: false;
  maxProviderAttempts: number;
};

export type WorkloadRoutingEntry = {
  workload: RuntimeWorkload;
  transportProvider: TransportProvider;
  wireModelId: string;
};

export type EffectiveRuntimeSettingsProjection = {
  generatedAt: string;
  mutationSupported: false;
  mainRp: {
    owner: string;
    activeModelIds: string[];
    defaultModelId: string;
    models: MainRpModelRuntimeRow[];
    maxExternalProviderAttempts: number;
  };
  trpg: {
    owner: string;
    roles: TrpgRuntimeRow[];
    gmRetryableHttpStatuses: number[];
  };
  workloadRoutingByModelId: Record<string, WorkloadRoutingEntry[]>;
  length: {
    owner: string;
    scope: "main_rp";
    softAimChars: number;
    aimKind: "soft_target_not_ceiling";
    uiLabel: string;
    applicationProseCeilingChars: number | null;
    longerOutputPreserved: boolean;
    wireMaxTokensSent: boolean;
  };
  historical: {
    owner: string;
    retiredObservableModelIds: Array<{
      modelId: string;
      label: string;
      resolvesToCurrent: string;
    }>;
  };
  featureFlags: {
    paymentsEnabled: boolean;
    mockApiMode: boolean;
    phase1PublishedBillingEnabled: boolean;
    phase2DeepSeekPublishedBillingEnabled: boolean;
    adultSceneRoutingEnabled: boolean;
    adultHandoffAdminCanaryEnabled: boolean;
    adultHandoffGeneralEnabled: boolean;
    adultHandoffAllowlistedAdminCount: number;
    adultHandoffAllowlistedChatCount: number;
    adultRefusalFallbackModelId: string;
    memory: AdminMemoryRuntimeStatus;
  };
  credentials: {
    openRouterApiKeyConfigured: boolean;
    cheaperInferenceApiKeyConfigured: boolean;
  };
};

const PROBE_SYSTEM = "runtime-settings-projection";
const PROBE_USER = "runtime-settings-projection";
const PROBE_SESSION_ID = "runtime-settings-projection";

function credentialConfigured(resolve: () => string): boolean {
  try {
    return resolve().length > 0;
  } catch {
    return false;
  }
}

function endpointHost(endpoint: string): string {
  return new URL(endpoint).host;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function projectReasoning(body: Record<string, unknown>): RuntimeReasoningProjection {
  return {
    reasoning: body.reasoning ?? null,
    reasoningEffort: body.reasoning_effort ?? null,
    thinking: body.thinking ?? null,
    outputConfig: body.output_config ?? null,
    includeReasoning: body.include_reasoning ?? null,
  };
}

function projectPublishedPricing(
  ...modelIds: string[]
): RuntimePublishedPricingProjection | null {
  for (const modelId of modelIds) {
    const resolved = resolvePublishedPricingExact(modelId);
    if (!resolved) continue;
    return {
      canonicalModelId: resolved.canonicalModelId,
      pricingVersion: resolved.pricing.pricingVersion,
      publishedAt: resolved.pricing.publishedAt,
      commercialPricingOwner: resolvePublishedCommercialPricingOwner(resolved.pricing),
      targetMargin: resolved.pricing.targetMargin,
      minimumMarginFloor: resolved.pricing.minimumMarginFloor,
    };
  }
  return null;
}

function promptCacheAffinity(
  transport: TransportProvider,
  body: Record<string, unknown>
): MainRpModelRuntimeRow["promptCacheAffinity"] {
  switch (transport) {
    case "cheaperinference": {
      const url = new URL(
        buildCheaperInferenceChatCompletionsUrl({ promptCacheSession: PROBE_SESSION_ID })
      );
      return url.searchParams.get("x-ci-prompt-cache-scope") === "session"
        ? "cheaperinference_session_query"
        : "none";
    }
    case "openrouter":
      return typeof body.session_id === "string" && body.session_id.length > 0
        ? "openrouter_session_id"
        : "none";
    default: {
      const _exhaustive: never = transport;
      return _exhaustive;
    }
  }
}

function projectMainRpModel(
  option: (typeof MAIN_RP_USER_SELECTABLE_OPTIONS)[number]
): MainRpModelRuntimeRow {
  const registryProvider = selectedAIProvider(option.id);
  const wireModelId = resolveMainRpPrimaryWireModelId(option.id);
  const transportProvider: TransportProvider =
    registryProvider === "cheaperinference" ? "cheaperinference" : "openrouter";
  const requestBodyBeforeAdapt = buildOpenRouterRequestBody(
    wireModelId,
    [
      { role: "system", content: PROBE_SYSTEM },
      { role: "user", content: PROBE_USER },
    ],
    true,
    DEFAULT_TARGET_RESPONSE_CHARS,
    PROBE_SESSION_ID
  ) as Record<string, unknown>;
  if (transportProvider === "openrouter") {
    const routePolicy = resolveMainRpOpenRouterRoutePolicy(wireModelId);
    if (routePolicy) {
      requestBodyBeforeAdapt.provider = routePolicy.provider;
      requestBodyBeforeAdapt.service_tier = routePolicy.serviceTier;
    }
  }
  const body =
    transportProvider === "cheaperinference"
      ? adaptCheaperInferenceChatBody(requestBodyBeforeAdapt, {
          deepSeekAdultHandoffTrueOff: false,
        })
      : requestBodyBeforeAdapt;
  const endpoint =
    transportProvider === "cheaperinference"
      ? CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL
      : OPENROUTER_CHAT_COMPLETIONS_URL;
  const billingPhase = resolvePublishedBillingPhase({
    deliveredModelId: wireModelId,
    selectedModelId: option.id,
  });
  return {
    workload: "main_rp",
    canonicalModelId: option.id,
    label: option.label,
    isDefault: option.id === DEFAULT_SELECTED_AI,
    recommended: "recommended" in option && option.recommended === true,
    registryProvider,
    transportProvider,
    endpointHost: endpointHost(endpoint),
    wireModelId: String(body.model),
    providerRouting: body.provider ?? null,
    serviceTier: body.service_tier ?? null,
    reasoning: projectReasoning(body),
    samplingTemperature: numberOrNull(body.temperature),
    wireMaxTokens: numberOrNull(body.max_tokens),
    promptCacheAffinity: promptCacheAffinity(transportProvider, body),
    billingPhase: billingPhase ?? "legacy",
    publishedPricing: projectPublishedPricing(wireModelId, option.id),
  };
}

function projectTrpgRole(
  workload: TrpgRuntimeRow["workload"],
  request: TrpgProviderRequest,
  maxProviderAttempts: number
): TrpgRuntimeRow {
  return {
    workload,
    canonicalModelId: request.model,
    transportProvider: request.provider,
    endpointHost: endpointHost(request.endpoint),
    wireModelId: String(request.body.model),
    reasoning: projectReasoning(request.body),
    requestContract: trpgProviderRequestContract(request.body),
    stream: request.body.stream === true,
    transportMaxTokens: numberOrNull(request.body.max_tokens),
    transportMaxTokensKind: "provider_model_capability_ceiling",
    isProseLengthCeiling: false,
    maxProviderAttempts,
  };
}

function groupWorkloadRouting(
  mainRp: MainRpModelRuntimeRow[],
  trpg: TrpgRuntimeRow[]
): Record<string, WorkloadRoutingEntry[]> {
  const grouped: Record<string, WorkloadRoutingEntry[]> = {};
  for (const row of [...mainRp, ...trpg]) {
    (grouped[row.canonicalModelId] ??= []).push({
      workload: row.workload,
      transportProvider: row.transportProvider,
      wireModelId: row.wireModelId,
    });
  }
  return grouped;
}

function projectLength(mainRp: MainRpModelRuntimeRow[]): EffectiveRuntimeSettingsProjection["length"] {
  const target = resolveResponseLengthTarget(DEFAULT_TARGET_RESPONSE_CHARS);
  const longProbe = "가".repeat(target.aimChars * 3);
  const streamCap = resolveStreamCharCap(DEFAULT_TARGET_RESPONSE_CHARS);
  return {
    owner: "responseLengthConstants.resolveResponseLengthTarget + responseLength stream/clamp owners",
    scope: "main_rp",
    softAimChars: target.aimChars,
    aimKind: "soft_target_not_ceiling",
    uiLabel: RESPONSE_LENGTH_UI_LABEL,
    applicationProseCeilingChars: streamCap >= Number.MAX_SAFE_INTEGER ? null : streamCap,
    longerOutputPreserved:
      clampResponseLength(longProbe).length === longProbe.length &&
      !isOverResponseTarget(longProbe),
    wireMaxTokensSent: mainRp.some((row) => row.wireMaxTokens != null),
  };
}

function projectHistorical(): EffectiveRuntimeSettingsProjection["historical"] {
  const active = new Set<string>(MAIN_RP_MODEL_IDS);
  return {
    owner: "mainRpObservabilityModelIds.MAIN_RP_OBSERVABILITY_MODEL_IDS + chatModels.resolveSelectedAI",
    retiredObservableModelIds: MAIN_RP_OBSERVABILITY_MODEL_IDS.filter((id) => !active.has(id)).map(
      (modelId) => ({
        modelId,
        label: selectedAILabel(modelId),
        resolvesToCurrent: resolveSelectedAI(modelId),
      })
    ),
  };
}

export function buildEffectiveRuntimeSettingsProjection(
  now: Date = new Date()
): EffectiveRuntimeSettingsProjection {
  const mainRpModels = MAIN_RP_USER_SELECTABLE_OPTIONS.map(projectMainRpModel);
  const trpgRoles = [
    projectTrpgRole(
      "trpg_gm",
      buildTrpgGmProviderRequest({ system: PROBE_SYSTEM, user: PROBE_USER }),
      GM_MAX_PROVIDER_ATTEMPTS
    ),
    projectTrpgRole(
      "trpg_bot",
      buildTrpgBotProviderRequest({ system: PROBE_SYSTEM, user: PROBE_USER }),
      BOT_MAX_PROVIDER_ATTEMPTS
    ),
  ];
  const adultRouting = resolveAdultRoutingConfig();
  const handoffCanary = resolveAdultSceneHandoffCanaryConfig();

  return {
    generatedAt: now.toISOString(),
    mutationSupported: false,
    mainRp: {
      owner: "chatModels.MAIN_RP_USER_SELECTABLE_OPTIONS → openRouterConfig.resolveMainRpPrimaryWireModelId → openRouterClient.buildOpenRouterRequestBody + resolveMainRpOpenRouterRoutePolicy + adaptCheaperInferenceChatBody",
      activeModelIds: [...MAIN_RP_MODEL_IDS],
      defaultModelId: DEFAULT_SELECTED_AI,
      models: mainRpModels,
      maxExternalProviderAttempts: MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS,
    },
    trpg: {
      owner: "trpg/types TRPG_*_MODEL → trpg/gmCall.buildTrpg{Gm,Bot}ProviderRequest",
      roles: trpgRoles,
      gmRetryableHttpStatuses: [...GM_RETRYABLE_HTTP_STATUSES],
    },
    workloadRoutingByModelId: groupWorkloadRouting(mainRpModels, trpgRoles),
    length: projectLength(mainRpModels),
    historical: projectHistorical(),
    featureFlags: {
      paymentsEnabled: isPaymentsEnabled(),
      mockApiMode: isMockApiMode(),
      phase1PublishedBillingEnabled: isPhase1PublishedBillingEnabled(),
      phase2DeepSeekPublishedBillingEnabled: isPhase2DeepSeekPublishedBillingEnabled(),
      adultSceneRoutingEnabled: adultRouting.enabled,
      adultHandoffAdminCanaryEnabled: handoffCanary.adminCanaryEnabled,
      adultHandoffGeneralEnabled: handoffCanary.generalEnabled,
      adultHandoffAllowlistedAdminCount: handoffCanary.allowedAdminUserIds.size,
      adultHandoffAllowlistedChatCount: handoffCanary.allowedChatIds.size,
      adultRefusalFallbackModelId: resolveAdultRefusalFallbackModelId(),
      memory: buildAdminMemoryRuntimeStatus(process.env),
    },
    credentials: {
      openRouterApiKeyConfigured: credentialConfigured(resolveOpenRouterApiKey),
      cheaperInferenceApiKeyConfigured: credentialConfigured(resolveCheaperInferenceApiKey),
    },
  };
}
