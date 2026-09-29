import mainRpOpenRouterRoutesJson from "@/lib/mainRpOpenRouterRoutes.json";
import type { SelectedAI } from "@/lib/chatModels";
import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";
import type {
  MainRpSupplyPromotionHistoryReport,
  SupplyPromotionEvidence,
} from "./mainRpSupplyPromotionHistory";

export const MAIN_RP_SUPPLY_PROMOTION_PROPOSAL_VERSION = 1;

export type SupplyTransitionKind =
  | "SAME_OPENROUTER_TRANSPORT"
  | "CROSS_PROVIDER_PROCUREMENT"
  | "UNKNOWN_CURRENT_PROCUREMENT";

export type SupplyPromotionProposal = {
  modelId: SelectedAI;
  candidateProviderName: string;
  candidateProviderSlug: string;
  proposedRoute: {
    providerSlug: string;
    providerLabel: string;
    serviceTier: null;
  } | null;
  currentProcurementProvider: "cheaperinference" | "openrouter" | null;
  transitionKind: SupplyTransitionKind;
  draftRoutePrEligible: boolean;
  automaticMergeEligible: false;
  stopReason: string | null;
  evidence: {
    qualifyingMarketSnapshots: number;
    marketObservationSpanDays: number;
    completeLivePairs: number;
    liveObservationSpanDays: number;
    latestSavingsPercent: number | null;
    worstCandidateTotalVsBaselineRatio: number | null;
    worstCandidateTtftVsBaselineRatio: number | null;
  };
  requiredReviewOwners: string[];
};

export type MainRpSupplyPromotionProposalPacket = {
  version: number;
  generatedAt: string;
  proposals: SupplyPromotionProposal[];
  draftRoutePrEligibleCount: number;
  crossProviderReviewRequiredCount: number;
  automaticMergeEligibleCount: 0;
  notes: string[];
};

function currentProcurementProvider(input: {
  radar: MainRpSupplyRadarReport;
  modelId: SelectedAI;
}): "cheaperinference" | "openrouter" | null {
  return (
    input.radar.models.find((model) => model.modelId === input.modelId)
      ?.currentProcurement?.provider ?? null
  );
}

export function classifySupplyTransition(input: {
  currentProvider: "cheaperinference" | "openrouter" | null;
}): {
  kind: SupplyTransitionKind;
  draftRoutePrEligible: boolean;
  stopReason: string | null;
  requiredReviewOwners: string[];
} {
  if (input.currentProvider === "openrouter") {
    return {
      kind: "SAME_OPENROUTER_TRANSPORT",
      draftRoutePrEligible: true,
      stopReason: null,
      requiredReviewOwners: [
        "src/lib/mainRpOpenRouterRoutes.json",
        "src/lib/openRouterConfig.ts#resolveMainRpOpenRouterRoutePolicy",
        "src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS",
        "scripts/lib/mainRpSupplyRadar.ts#currentProcurement",
      ],
    };
  }
  if (input.currentProvider === "cheaperinference") {
    return {
      kind: "CROSS_PROVIDER_PROCUREMENT",
      draftRoutePrEligible: false,
      stopReason:
        "provider_call_cost_or_billing_path_changes_require_explicit_review_before_route_mutation",
      requiredReviewOwners: [
        "src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS",
        "src/lib/openRouterConfig.ts#resolveMainRpOpenRouterRoutePolicy",
        "src/lib/cheaperInferenceConfig.ts#adaptCheaperInferenceChatBody",
        "src/lib/chatBillingContractDispatch.ts",
        "src/lib/modelPricingPolicy.ts",
        "src/lib/modelPricingTracker.ts",
        "provider cost ledger / receipt provenance",
      ],
    };
  }
  return {
    kind: "UNKNOWN_CURRENT_PROCUREMENT",
    draftRoutePrEligible: false,
    stopReason: "current_procurement_owner_unresolved",
    requiredReviewOwners: [
      "src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS",
      "scripts/lib/mainRpSupplyRadar.ts#currentProcurement",
    ],
  };
}

function proposalFromEvidence(input: {
  evidence: SupplyPromotionEvidence;
  radar: MainRpSupplyRadarReport;
}): SupplyPromotionProposal {
  const provider = currentProcurementProvider({
    radar: input.radar,
    modelId: input.evidence.modelId,
  });
  const transition = classifySupplyTransition({ currentProvider: provider });
  const routeRegistry = mainRpOpenRouterRoutesJson as Record<
    string,
    { providerSlug: string; providerLabel: string; serviceTier: "flex" | null }
  >;
  const routeManaged = Boolean(routeRegistry[input.evidence.modelId]);
  const sameTransportRouteEligible =
    transition.kind === "SAME_OPENROUTER_TRANSPORT" && routeManaged;
  const draftRoutePrEligible =
    transition.draftRoutePrEligible && sameTransportRouteEligible;
  const stopReason =
    transition.kind === "SAME_OPENROUTER_TRANSPORT" && !routeManaged
      ? "canonical_openrouter_route_registry_entry_missing"
      : transition.stopReason;
  return {
    modelId: input.evidence.modelId,
    candidateProviderName: input.evidence.providerName,
    candidateProviderSlug: input.evidence.providerSlug,
    proposedRoute: draftRoutePrEligible
      ? {
          providerSlug: input.evidence.providerSlug,
          providerLabel: input.evidence.providerName,
          // Live qualification deliberately removes the current production
          // service tier so the alternate endpoint's own tested service class
          // is the route being proposed.
          serviceTier: null,
        }
      : null,
    currentProcurementProvider: provider,
    transitionKind: transition.kind,
    draftRoutePrEligible,
    automaticMergeEligible: false,
    stopReason,
    evidence: {
      qualifyingMarketSnapshots: input.evidence.qualifyingMarketSnapshots,
      marketObservationSpanDays: input.evidence.marketObservationSpanDays,
      completeLivePairs: input.evidence.completeLivePairs,
      liveObservationSpanDays: input.evidence.liveObservationSpanDays,
      latestSavingsPercent: input.evidence.latestSavingsPercent,
      worstCandidateTotalVsBaselineRatio:
        input.evidence.worstCandidateTotalVsBaselineRatio,
      worstCandidateTtftVsBaselineRatio:
        input.evidence.worstCandidateTtftVsBaselineRatio,
    },
    requiredReviewOwners: transition.requiredReviewOwners,
  };
}

export function buildMainRpSupplyPromotionProposalPacket(input: {
  history: MainRpSupplyPromotionHistoryReport;
  radar: MainRpSupplyRadarReport;
  generatedAt?: string;
}): MainRpSupplyPromotionProposalPacket {
  const proposals = input.history.candidates
    .filter((row) => row.status === "PROMOTION_READY")
    .map((evidence) => proposalFromEvidence({ evidence, radar: input.radar }))
    .sort((a, b) => {
      if (a.modelId !== b.modelId) return a.modelId.localeCompare(b.modelId);
      return a.candidateProviderSlug.localeCompare(b.candidateProviderSlug);
    });

  return {
    version: MAIN_RP_SUPPLY_PROMOTION_PROPOSAL_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    proposals,
    draftRoutePrEligibleCount: proposals.filter(
      (row) => row.draftRoutePrEligible
    ).length,
    crossProviderReviewRequiredCount: proposals.filter(
      (row) => row.transitionKind === "CROSS_PROVIDER_PROCUREMENT"
    ).length,
    automaticMergeEligibleCount: 0,
    notes: [
      "This packet is advisory evidence. It never mutates routing or pricing.",
      "Same-OpenRouter-transport promotion may proceed to a Draft route PR only through the canonical route registry; the proposed service tier is null because live qualification tests the alternate endpoint with inherited production service_tier removed.",
      "Cross-provider procurement changes are a STOP condition until billing, provider-cost, receipt provenance, and transport-control parity are reviewed.",
      "No proposal is eligible for automatic merge.",
    ],
  };
}

function n(value: number | null, digits = 2): string {
  return value == null ? "n/a" : value.toFixed(digits);
}

export function renderMainRpSupplyPromotionProposalMarkdown(
  packet: MainRpSupplyPromotionProposalPacket
): string {
  const lines = [
    "# Main RP Supply Promotion Proposal Packet",
    "",
    `- generated: ${packet.generatedAt}`,
    `- proposals: **${packet.proposals.length}**`,
    `- same-transport Draft PR eligible: **${packet.draftRoutePrEligibleCount}**`,
    `- cross-provider review required: **${packet.crossProviderReviewRequiredCount}**`,
    `- automatic merge eligible: **0**`,
    "",
    "| Model | Candidate | Proposed route | Current procurement | Transition | Draft route PR | Savings | Market span | Live pairs/span | Worst total | Worst TTFT | STOP |",
    "|---|---|---|---|---|---|---:|---:|---|---:|---:|---|",
  ];

  for (const row of packet.proposals) {
    lines.push(
      `| ${row.modelId} | ${row.candidateProviderName} (${row.candidateProviderSlug}) | ${row.proposedRoute ? `${row.proposedRoute.providerSlug} / serviceTier=default` : "n/a"} | ${row.currentProcurementProvider ?? "unknown"} | ${row.transitionKind} | ${row.draftRoutePrEligible ? "YES" : "NO"} | ${n(row.evidence.latestSavingsPercent, 1)}% | ${n(row.evidence.marketObservationSpanDays, 1)}d | ${row.evidence.completeLivePairs} / ${n(row.evidence.liveObservationSpanDays, 1)}d | ${n(row.evidence.worstCandidateTotalVsBaselineRatio, 3)} | ${n(row.evidence.worstCandidateTtftVsBaselineRatio, 3)} | ${row.stopReason ?? "none"} |`
    );
  }

  if (!packet.proposals.length) {
    lines.push("| — | — | — | — | — | — | — | — | — | — | — | no PROMOTION_READY evidence yet |");
  }

  lines.push("", "## Interpretation boundary", "");
  for (const note of packet.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
