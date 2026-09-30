import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { DIRECT_SUPPLIER_PUBLIC_RADAR_IDS } from "./directSupplierTargets";
import {
  FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
  fluenceObservedPublicProfile,
} from "./fluencePublicEvidence";
import { independentSupplierLiveQualification } from "./qualificationContract";
import {
  pipelineStatusAfterPublicScreen,
  screenSupplierPublicProfile,
} from "./publicScreen";
import type {
  SupplierCandidateRecord,
  SupplierCandidateStatus,
  SupplierDiscoveryReport,
  SupplierDiscoverySourceInventoryEntry,
  SupplierPublicProfile,
} from "./types";

export type { SupplierCandidateRecord } from "./types";

export const SUPPLIER_DISCOVERY_SOURCES: readonly SupplierDiscoverySourceInventoryEntry[] =
  Object.freeze([
    {
      id: "openrouter_endpoint_radar",
      implemented: true,
      newSecretRequired: false,
      owner: "scripts/lib/mainRpSupplyRadar.ts",
      role: "Existing OpenRouter endpoint and provider metadata owner. Names already discovered there are not copied into this candidate registry.",
    },
    {
      id: "artificial_analysis_providers",
      implemented: false,
      newSecretRequired: true,
      owner: "none",
      role: "Structured provider index is commercial-tier and would require a new API key. The public leaderboard HTML is prerendered, not a stable machine-readable contract. Not a source of truth.",
    },
    {
      id: "direct_supplier_public_radar",
      implemented: true,
      newSecretRequired: false,
      owner: "scripts/lib/mainRpDirectSupplierRadar.ts",
      role: "Existing per-model public-page radar for the direct supplier id list.",
    },
    {
      id: "bounded_web_search",
      implemented: false,
      newSecretRequired: true,
      owner: "none",
      role: "No stable free search API. A paid search API or new secret is follow-up, not this owner.",
    },
    {
      id: "independent_candidate_registry",
      implemented: true,
      newSecretRequired: false,
      owner: "src/lib/supplierDiscovery/discoverSuppliers.ts",
      role: "Data-driven independent supplier candidates. Membership is not production routing.",
    },
  ]);

const PROMOTION_OWNER =
  "scripts/lib/mainRpSupplyPromotionProposal.ts#classifySupplyTransition";

function credentialRequirement(status: SupplierCandidateStatus): string {
  switch (status) {
    case "CREDENTIAL_REQUIRED":
      return "dedicated_supplier_credential_required_before_live_qualification";
    case "READY_FOR_LIVE_QUALIFICATION":
      return "credential_present_live_qualification_not_run_by_discovery";
    case "WAITLIST":
      return "waitlist_credential_not_requested";
    case "PUBLIC_SCREEN_HOLD":
    case "DISCOVERED":
    case "PUBLIC_SCREEN_PASS":
      return "not_requested_until_public_screen_passes";
    case "REJECTED":
      return "not_requested_rejected";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function liveBlockReason(status: SupplierCandidateStatus): string {
  switch (status) {
    case "PUBLIC_SCREEN_HOLD":
    case "DISCOVERED":
    case "PUBLIC_SCREEN_PASS":
    case "REJECTED":
      return "public_screen_blocked";
    case "WAITLIST":
      return "waitlist";
    case "CREDENTIAL_REQUIRED":
      return "missing_credential";
    case "READY_FOR_LIVE_QUALIFICATION":
      return "discovery_owner_does_not_execute_provider_calls";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function buildIndependentSupplierCandidate(input: {
  profile: SupplierPublicProfile;
  credentialConfigured: boolean;
  discoveredAt: string;
  lastSeenAt: string;
  discoverySource: SupplierCandidateRecord["discoverySource"];
  evidenceFreshness: string;
}): SupplierCandidateRecord {
  const screen = screenSupplierPublicProfile(input.profile);
  const status = pipelineStatusAfterPublicScreen({
    screen: screen.status,
    credentialConfigured: input.credentialConfigured,
  });
  const priceAdvantage =
    input.profile.priceUnit === "usd_per_million_tokens" ? "unknown" : "not_comparable";
  return {
    supplierId: input.profile.supplierId,
    companyName: input.profile.companyName,
    website: input.profile.website,
    apiDocsUrl: input.profile.apiDocsUrl,
    pricingUrl: input.profile.pricingUrl,
    statusUrl: input.profile.statusUrl,
    privacyPolicyUrl: input.profile.privacyPolicyUrl,
    termsUrl: input.profile.termsUrl,
    retentionZdr: input.profile.retentionZdr,
    openaiCompatible: input.profile.openaiCompatible,
    chatCompletionsAdvertised: input.profile.chatCompletionsAdvertised,
    streamingAdvertised: input.profile.streamingAdvertised,
    usageReportingAdvertised: input.profile.usageReportingAdvertised,
    discoveredAt: input.discoveredAt,
    lastSeenAt: input.lastSeenAt,
    discoverySource: input.discoverySource,
    supportedActiveModelIds: input.profile.supportedActiveModelIds,
    inputUsdPerMillion: input.profile.inputUsdPerMillion,
    outputUsdPerMillion: input.profile.outputUsdPerMillion,
    cacheReadUsdPerMillion: input.profile.cacheReadUsdPerMillion,
    priceUnit: input.profile.priceUnit,
    priceAdvantage,
    evidenceFreshness: input.evidenceFreshness,
    publicScreenStatus: screen.status,
    publicScreenReasons: screen.reasons,
    status,
    publicStabilityEvidence: input.profile.publicStabilityEvidence,
    privacyZdrStatus: input.profile.retentionZdr,
    credentialRequirement: credentialRequirement(status),
    liveQualification: independentSupplierLiveQualification({
      blockedReason: liveBlockReason(status),
    }),
    promotion: {
      readiness: "NOT_READY",
      transitionKind: "CROSS_PROVIDER_PROCUREMENT",
      draftRoutePrEligible: false,
      automaticMergeEligible: false,
      stopReason:
        "cross_provider_procurement_requires_explicit_review_before_route_mutation",
      promotionOwner: PROMOTION_OWNER,
    },
  };
}

export function supplierCandidateNotificationRefId(supplierId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < supplierId.length; index += 1) {
    hash ^= supplierId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const positive = (hash >>> 0) % 1_000_000_000;
  return positive === 0 ? 1 : positive;
}

export type SupplierDiscoveryNotificationTarget = {
  supplierId: string;
  companyName: string;
  status: "CREDENTIAL_REQUIRED" | "READY_FOR_LIVE_QUALIFICATION";
  refId: number;
};

export function supplierDiscoveryNotificationTargets(
  report: SupplierDiscoveryReport
): SupplierDiscoveryNotificationTarget[] {
  const targets: SupplierDiscoveryNotificationTarget[] = [];
  for (const candidate of report.candidates) {
    if (
      candidate.status !== "CREDENTIAL_REQUIRED" &&
      candidate.status !== "READY_FOR_LIVE_QUALIFICATION"
    ) {
      continue;
    }
    targets.push({
      supplierId: candidate.supplierId,
      companyName: candidate.companyName,
      status: candidate.status,
      refId: supplierCandidateNotificationRefId(candidate.supplierId),
    });
  }
  return targets;
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

export function buildSupplierDiscoveryReport(input?: {
  generatedAt?: string;
  openRouterProviderNames?: readonly string[];
}): SupplierDiscoveryReport {
  const generatedAt = input?.generatedAt ?? FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT;
  const fluence = buildIndependentSupplierCandidate({
    profile: fluenceObservedPublicProfile(),
    credentialConfigured: false,
    discoveredAt: FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
    lastSeenAt: FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT,
    discoverySource: "independent_candidate_registry",
    evidenceFreshness: `public_pages_observed_${FLUENCE_PUBLIC_EVIDENCE_OBSERVED_AT}`,
  });
  const openRouterNames =
    input?.openRouterProviderNames == null
      ? null
      : uniqueNames(input.openRouterProviderNames);
  return {
    version: 1,
    generatedAt,
    providerGenerationCalls: 0,
    activeModelIdsConsidered: MAIN_RP_MODEL_IDS,
    candidates: [fluence],
    knownDirectSupplierIds: DIRECT_SUPPLIER_PUBLIC_RADAR_IDS,
    openRouterFeed: {
      owner: "scripts/lib/mainRpSupplyRadar.ts",
      status: openRouterNames == null ? "NOT_ATTACHED" : "ATTACHED",
      providerNameCount: openRouterNames?.length ?? 0,
      fluenceNamed:
        openRouterNames == null
          ? null
          : openRouterNames.some((name) => name.toLowerCase().includes("fluence")),
      independentCandidatesAdded: 0,
      note: "OpenRouter provider names remain owned by the endpoint radar. This report does not turn them into independent supplier candidates or production routes.",
    },
    sources: SUPPLIER_DISCOVERY_SOURCES,
    notes: [
      "READ_ONLY_DISCOVERY: provider generation calls are 0.",
      "A candidate record is not membership in the production provider registry.",
      "Direct supplier ids stay on the existing public-page radar.",
      "Cross-provider procurement does not create a route Draft PR from this report.",
      "Automatic merge is 0.",
      "Artificial Analysis and paid web search are inventoried and not called.",
    ],
  };
}

export function renderSupplierDiscoveryMarkdown(report: SupplierDiscoveryReport): string {
  const lines = [
    "# Independent Supplier Discovery",
    "",
    `- generated: ${report.generatedAt}`,
    `- provider generation calls: **${report.providerGenerationCalls}**`,
    `- candidates: **${report.candidates.length}**`,
    `- known direct supplier ids: ${report.knownDirectSupplierIds.join(", ")}`,
    "",
    "| Supplier | Source | Screen | Status | Models | Price advantage | Stability | Privacy/ZDR | Credential | Live qualification | Promotion | STOP |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of report.candidates) {
    lines.push(
      `| ${row.companyName} (${row.supplierId}) | ${row.discoverySource} | ${row.publicScreenStatus} | ${row.status} | ${row.supportedActiveModelIds.join(", ") || "none public"} | ${row.priceAdvantage} | ${row.publicStabilityEvidence ?? "unverified"} | ${row.privacyZdrStatus} | ${row.credentialRequirement} | ${row.liveQualification.status}:${row.liveQualification.reason} | ${row.promotion.readiness} | ${row.promotion.stopReason} |`
    );
  }
  lines.push("", "## Sources", "");
  for (const source of report.sources) {
    lines.push(
      `- ${source.id}: implemented=${source.implemented}; newSecret=${source.newSecretRequired}; owner=${source.owner}; ${source.role}`
    );
  }
  lines.push("", "## OpenRouter feed", "");
  lines.push(`- status: ${report.openRouterFeed.status}`);
  lines.push(`- provider names attached: ${report.openRouterFeed.providerNameCount}`);
  lines.push(`- Fluence named in attached OpenRouter list: ${String(report.openRouterFeed.fluenceNamed)}`);
  lines.push(`- ${report.openRouterFeed.note}`);
  lines.push("", "## Interpretation boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
