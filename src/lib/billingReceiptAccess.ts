import {
  applySelectedModelIdentity,
  collapsePublicHandoffStages,
} from "@/lib/adultHandoffDisplay";
import type { Usage } from "@/lib/chatUsage";
import { stripMuseAcceptanceFromUsage } from "@/lib/museAcceptanceTelemetry";
import {
  omitInternalTopLevelUsageFields,
  sanitizePublicStages,
} from "@/lib/publicUsageEconomicsBoundary";

export const BILLING_BREAKDOWN_SYSTEM_RULES_LABEL = "시스템 프롬프트 (고정 규칙)";
/** Keyword-activated lorebook entries injected this turn */
export const BILLING_BREAKDOWN_KEYWORD_LOREBOOK_LABEL = "활성화 로어북";

export type StripAdultRoutingOptions = {
  /** Admin/debug — keep full adultRouting metadata. Public clients never receive it. */
  keepInternal?: boolean;
};

function isAdminEmailUser(user: { email: string } & { is_admin?: number }): boolean {
  if (user.is_admin === 1) return true;
  const allow = process.env.ADMIN_EMAILS?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allow?.length) return false;
  return allow.includes(user.email.toLowerCase());
}

/** Server-authorized admins only: expose detailed receipt economics. */
export function canShowFullBillingReceipt(
  user: { email: string } & { is_admin?: number }
): boolean {
  return isAdminEmailUser(user);
}

export function keepInternalAdultRoutingForUser(
  user: { email: string } & { is_admin?: number }
): boolean {
  return canShowFullBillingReceipt(user);
}

export function filterUsageBreakdownForReceipt(
  breakdown: Usage["breakdown"] | undefined,
  showFullReceipt: boolean
): Usage["breakdown"] {
  if (!breakdown?.length) return breakdown ?? [];
  if (showFullReceipt) return breakdown;
  return breakdown.filter((b) => b.label !== BILLING_BREAKDOWN_SYSTEM_RULES_LABEL);
}

/**
 * Canonical public economics privacy owner — strips provider/internal economics from Usage.
 * Routing identity is applied separately via stripAdultRoutingForClient.
 */
export function sanitizeUsageForPublicReceipt(usage: Usage): Usage {
  const routing = usage.adultRouting;
  const rest = omitInternalTopLevelUsageFields(usage as Usage & Record<string, unknown>);
  const publicUsage: Usage = {
    ...(rest as Usage),
    breakdown: filterUsageBreakdownForReceipt(
      (rest as Usage).breakdown,
      false
    ),
    stages: sanitizePublicStages((rest as Usage).stages),
  };
  if (routing?.activeRoute === "adult" || routing?.fallbackSucceeded) {
    Object.assign(publicUsage, applySelectedModelIdentity(publicUsage, routing));
    Object.assign(publicUsage, collapsePublicHandoffStages(publicUsage, routing));
  }
  return publicUsage;
}

/**
 * DB-persistence counterpart of the public sanitizer.
 * The public sanitizer is (correctly) lossy for privacy, so the DB record —
 * which is built from the sanitized usage for non-admin turns — would lose the
 * deterministic provider request linkage that delayed reconciliation needs.
 * This helper restores ONLY `stages[].providerRequestId` from the internal
 * usage; it never restores any economics/debug field (upstream cost, billed
 * cost, cache discount, usage evidence, raw debug usage, …).
 * ONE RESPONSIBILITY: sanitizer = client privacy; this = reconciliation identity.
 */
export function attachProviderRequestLinkageForPersistence(
  persistedUsage: Usage,
  internalUsage: Usage
): Usage {
  const internalStages = internalUsage.stages;
  const persistedStages = persistedUsage.stages;
  if (!internalStages?.length || !persistedStages?.length) return persistedUsage;

  const linkageByKey = new Map<string, string>();
  const linkageByIndex: (string | undefined)[] = [];
  let hasLinkage = false;
  for (const stage of internalStages) {
    linkageByIndex.push(stage.providerRequestId);
    if (stage.providerRequestId) {
      hasLinkage = true;
      linkageByKey.set(
        `${stage.stage}|${stage.model}|${stage.input}|${stage.output}`,
        stage.providerRequestId
      );
    }
  }
  if (!hasLinkage) return persistedUsage;

  const stages = persistedStages.map((stage, index) => {
    const byKey = linkageByKey.get(`${stage.stage}|${stage.model}|${stage.input}|${stage.output}`);
    const providerRequestId = byKey ?? linkageByIndex[index];
    return providerRequestId ? { ...stage, providerRequestId } : stage;
  });
  return { ...persistedUsage, stages };
}

/**
 * Client serialization — adult handoff identity transformation only.
 * Economics privacy is owned by sanitizeUsageForPublicReceipt.
 */
export function stripAdultRoutingForClient(
  usage: Usage,
  options?: StripAdultRoutingOptions
): Usage {
  const routing = usage.adultRouting;
  const {
    adultRouting: _adultRouting,
    generationKind: _generationKind,
    canonical: _canonical,
    canonAdopted: _canonAdopted,
    canonAdoptedAt: _canonAdoptedAt,
    ...rest
  } = usage;
  void _adultRouting;
  void _canonAdopted;
  void _canonAdoptedAt;
  let client = { ...rest } as Usage;
  if (routing?.activeRoute === "adult" || routing?.fallbackSucceeded) {
    client = applySelectedModelIdentity(client, routing);
    if (!options?.keepInternal) {
      client = collapsePublicHandoffStages(client, routing);
    }
  }
  if (options?.keepInternal) {
    if (routing) client.adultRouting = routing;
    if (usage.generationKind) client.generationKind = usage.generationKind;
    if (usage.canonical != null) client.canonical = usage.canonical;
    if (usage.canonAdopted != null) client.canonAdopted = usage.canonAdopted;
    if (usage.canonAdoptedAt) client.canonAdoptedAt = usage.canonAdoptedAt;
    if (usage.shadowPricing) client.shadowPricing = usage.shadowPricing;
  }
  return client;
}

/**
 * Single public Usage serialization entry — economics privacy then routing identity.
 * Admin/full paths pass keepInternal: true and skip economics stripping.
 */
export function serializeUsageForPublicClient(
  usage: Usage,
  options?: StripAdultRoutingOptions
): Usage {
  const withoutMuse = stripMuseAcceptanceFromUsage(usage);
  if (options?.keepInternal) {
    return stripAdultRoutingForClient(withoutMuse, { keepInternal: true });
  }
  return stripAdultRoutingForClient(sanitizeUsageForPublicReceipt(withoutMuse), {
    keepInternal: false,
  });
}
