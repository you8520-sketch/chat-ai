import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";
import type {
  MainRpSupplyPromotionProposalPacket,
  SupplyPromotionProposal,
} from "./mainRpSupplyPromotionProposal";

export const MAIN_RP_SUPPLY_AUTO_DRAFT_VERSION = 1;
export const MAIN_RP_SUPPLY_AUTO_DRAFT_MAX_PRS_PER_RUN = 3;
export const MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH =
  "config/main-rp-openrouter-routes.json";

export type MainRpOpenRouterRouteConfigEntry = {
  providerSlug: string;
  serviceTier: "flex" | null;
};

export type MainRpOpenRouterRouteConfig = Record<
  string,
  MainRpOpenRouterRouteConfigEntry
>;

export type SupplyAutoDraftPlan = {
  modelId: string;
  openRouterSlug: string;
  branchName: string;
  title: string;
  body: string;
  currentRoute: MainRpOpenRouterRouteConfigEntry;
  proposedRoute: MainRpOpenRouterRouteConfigEntry;
  proposedConfig: MainRpOpenRouterRouteConfig;
  candidateProviderName: string;
  candidateProviderSlug: string;
};

export type SupplyAutoDraftSkip = {
  modelId: string;
  candidateProviderSlug: string;
  reason: string;
};

export type SupplyAutoDraftPlanningResult = {
  version: number;
  plans: SupplyAutoDraftPlan[];
  skipped: SupplyAutoDraftSkip[];
  automaticMergeEligibleCount: 0;
};

function safeToken(value: string, max = 80): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function cleanText(value: string, max = 160): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function validProviderSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value);
}

function cloneConfig(
  value: MainRpOpenRouterRouteConfig
): MainRpOpenRouterRouteConfig {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, { ...entry }])
  );
}

function draftBody(input: {
  proposal: SupplyPromotionProposal;
  openRouterSlug: string;
  currentRoute: MainRpOpenRouterRouteConfigEntry;
}): string {
  const p = input.proposal;
  const providerName = cleanText(p.candidateProviderName);
  const rollbackTier =
    input.currentRoute.serviceTier == null
      ? "null"
      : JSON.stringify(input.currentRoute.serviceTier);
  return [
    `<!-- main-rp-supply-auto-draft model=${p.modelId} provider=${p.candidateProviderSlug} -->`,
    "",
    "## Automated supplier promotion Draft",
    "",
    "This Draft PR was created only after the existing durable supply gate reached `PROMOTION_READY`.",
    "It is intentionally **not eligible for automatic merge**.",
    "",
    "### Route delta",
    `- model: `${p.modelId}``,
    `- OpenRouter wire model: `${input.openRouterSlug}``,
    `- current provider pin: `${input.currentRoute.providerSlug}``,
    `- proposed provider pin: `${p.testedRoute.providerSlug}``,
    `- current service tier: `${rollbackTier}``,
    "- proposed service tier: `null`",
    "",
    "The proposed route shape exactly matches live qualification: explicit provider pin, no OpenRouter fallback, and no `service_tier`.",
    "",
    "### Evidence",
    `- candidate: ${providerName} (`${p.candidateProviderSlug}`)`,
    `- qualifying market snapshots: **${p.evidence.qualifyingMarketSnapshots}**`,
    `- market observation span: **${p.evidence.marketObservationSpanDays.toFixed(1)} days**`,
    `- complete canonical two-turn live pairs: **${p.evidence.completeLivePairs}**`,
    `- live observation span: **${p.evidence.liveObservationSpanDays.toFixed(1)} days**`,
    `- latest representative raw-rate saving: **${p.evidence.latestSavingsPercent?.toFixed(1) ?? "n/a"}%**`,
    `- worst candidate total-time / current-baseline ratio: **${p.evidence.worstCandidateTotalVsBaselineRatio?.toFixed(3) ?? "n/a"}**`,
    `- worst candidate TTFT / current-baseline ratio: **${p.evidence.worstCandidateTtftVsBaselineRatio?.toFixed(3) ?? "n/a"}**`,
    "",
    "### Preserved",
    "- model identity and Main RP registry",
    "- published user pricing",
    "- OpenRouter transport",
    "- `allow_fallbacks: false`",
    "- `require_parameters: true`",
    "- existing model controls and RP prompt assembly",
    "",
    "### Rollback",
    `Restore `${MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH}` for `${input.openRouterSlug}` to provider `${input.currentRoute.providerSlug}` and service tier `${rollbackTier}`, then redeploy.`,
    "",
    "### Review boundary",
    "- This PR changes only the canonical route-data owner.",
    "- It was prevalidated by the originating Supply Radar workflow before branch creation.",
    "- Do not merge if current provider economics, privacy terms, model identity, or endpoint capability changed after the evidence window.",
    "- Automatic merge is prohibited.",
    "",
  ].join("\n");
}

function planOne(input: {
  proposal: SupplyPromotionProposal;
  radar: MainRpSupplyRadarReport;
  routeConfig: MainRpOpenRouterRouteConfig;
}): { plan?: SupplyAutoDraftPlan; skip?: SupplyAutoDraftSkip } {
  const p = input.proposal;
  const skip = (reason: string): { skip: SupplyAutoDraftSkip } => ({
    skip: {
      modelId: p.modelId,
      candidateProviderSlug: p.candidateProviderSlug,
      reason,
    },
  });

  if (!p.draftRoutePrEligible) return skip(p.stopReason ?? "draft_not_eligible");
  if (p.transitionKind !== "SAME_OPENROUTER_TRANSPORT") {
    return skip("transition_not_same_openrouter_transport");
  }
  if (p.currentProcurementProvider !== "openrouter") {
    return skip("current_procurement_not_openrouter");
  }
  if (p.automaticMergeEligible !== false) {
    return skip("automatic_merge_invariant_violated");
  }
  if (p.testedRoute.serviceTier !== null) {
    return skip("tested_route_service_tier_must_be_null");
  }
  if (
    !validProviderSlug(p.candidateProviderSlug) ||
    p.testedRoute.providerSlug !== p.candidateProviderSlug
  ) {
    return skip("candidate_provider_slug_invalid_or_drifted");
  }

  const model = input.radar.models.find((row) => row.modelId === p.modelId);
  if (!model) return skip("model_missing_from_current_radar");
  if (model.currentProcurement?.provider !== "openrouter") {
    return skip("radar_current_procurement_not_openrouter");
  }
  if (!model.openRouterSlug?.trim()) {
    return skip("openrouter_wire_slug_missing");
  }

  const currentRoute = input.routeConfig[model.openRouterSlug];
  if (!currentRoute) return skip("canonical_route_entry_missing");
  if (!validProviderSlug(currentRoute.providerSlug)) {
    return skip("canonical_current_provider_slug_invalid");
  }
  if (currentRoute.providerSlug === p.candidateProviderSlug) {
    return skip("already_routed_to_candidate");
  }

  const modelToken = safeToken(p.modelId);
  const providerToken = safeToken(p.candidateProviderSlug);
  if (!modelToken || !providerToken) return skip("branch_token_invalid");

  const proposedConfig = cloneConfig(input.routeConfig);
  proposedConfig[model.openRouterSlug] = {
    providerSlug: p.candidateProviderSlug,
    serviceTier: null,
  };

  return {
    plan: {
      modelId: p.modelId,
      openRouterSlug: model.openRouterSlug,
      branchName: `automation/supply-${modelToken}-${providerToken}`.slice(
        0,
        180
      ),
      title: `draft(routing): promote ${p.modelId} to ${p.candidateProviderSlug}`,
      body: draftBody({
        proposal: p,
        openRouterSlug: model.openRouterSlug,
        currentRoute,
      }),
      currentRoute: { ...currentRoute },
      proposedRoute: {
        providerSlug: p.candidateProviderSlug,
        serviceTier: null,
      },
      proposedConfig,
      candidateProviderName: cleanText(p.candidateProviderName),
      candidateProviderSlug: p.candidateProviderSlug,
    },
  };
}

export function planMainRpSupplyAutoDrafts(input: {
  packet: MainRpSupplyPromotionProposalPacket;
  radar: MainRpSupplyRadarReport;
  routeConfig: MainRpOpenRouterRouteConfig;
}): SupplyAutoDraftPlanningResult {
  const plans: SupplyAutoDraftPlan[] = [];
  const skipped: SupplyAutoDraftSkip[] = [];

  for (const proposal of input.packet.proposals) {
    const result = planOne({
      proposal,
      radar: input.radar,
      routeConfig: input.routeConfig,
    });
    if (result.skip) skipped.push(result.skip);
    if (!result.plan) continue;

    if (plans.length >= MAIN_RP_SUPPLY_AUTO_DRAFT_MAX_PRS_PER_RUN) {
      skipped.push({
        modelId: proposal.modelId,
        candidateProviderSlug: proposal.candidateProviderSlug,
        reason: "per_run_draft_pr_count_guard",
      });
      continue;
    }
    plans.push(result.plan);
  }

  return {
    version: MAIN_RP_SUPPLY_AUTO_DRAFT_VERSION,
    plans,
    skipped,
    automaticMergeEligibleCount: 0,
  };
}

export function serializeRouteConfig(
  config: MainRpOpenRouterRouteConfig
): string {
  const ordered = Object.fromEntries(
    Object.entries(config).sort(([a], [b]) => a.localeCompare(b))
  );
  return JSON.stringify(ordered, null, 2) + "\n";
}
