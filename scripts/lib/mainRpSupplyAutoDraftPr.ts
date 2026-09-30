import type { MainRpOpenRouterRouteConfigEntry } from "@/lib/openRouterConfig";
import type { MainRpSupplyLiveQualificationReport } from "./mainRpSupplyLiveQualification";
import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";
import type {
  MainRpSupplyPromotionProposalPacket,
  SupplyPromotionProposal,
} from "./mainRpSupplyPromotionProposal";

// Monthly auto-Draft planner; write execution remains isolated in the scheduled workflow job.
export const MAIN_RP_SUPPLY_AUTO_DRAFT_VERSION = 2;
export const MAIN_RP_SUPPLY_AUTO_DRAFT_MAX_PRS_PER_RUN = 3;
export const MAIN_RP_SUPPLY_AUTO_DRAFT_MAX_FRESHNESS_MS = 6 * 60 * 60 * 1_000;
export const MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH =
  "config/main-rp-openrouter-routes.json";

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

function isoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameRunFreshnessOk(input: {
  radarGeneratedAt: string;
  liveGeneratedAt: string;
}): boolean {
  const radar = isoMs(input.radarGeneratedAt);
  const live = isoMs(input.liveGeneratedAt);
  if (radar == null || live == null) return false;
  return Math.abs(live - radar) <= MAIN_RP_SUPPLY_AUTO_DRAFT_MAX_FRESHNESS_MS;
}

function formatTier(value: MainRpOpenRouterRouteConfigEntry["serviceTier"]): string {
  return value == null ? "null" : JSON.stringify(value);
}

function draftBody(input: {
  proposal: SupplyPromotionProposal;
  openRouterSlug: string;
  currentRoute: MainRpOpenRouterRouteConfigEntry;
  proposedRoute: MainRpOpenRouterRouteConfigEntry;
}): string {
  const p = input.proposal;
  const providerName = cleanText(p.candidateProviderName);
  return [
    `<!-- main-rp-supply-auto-draft-v2 model=${p.modelId} provider=${p.candidateProviderSlug} -->`,
    "",
    "## Automated supplier promotion Draft",
    "",
    "This Draft PR was created only after the durable promotion history gate reached `PROMOTION_READY` **and the current monthly Supply Radar run freshly completed the same provider's canonical two-turn RP qualification**.",
    "It is intentionally **not eligible for automatic merge**.",
    "",
    "### Route delta",
    `- model: \`${p.modelId}\``,
    `- OpenRouter wire model: \`${input.openRouterSlug}\``,
    `- current provider pin: \`${input.currentRoute.providerSlug}\``,
    `- proposed provider pin: \`${input.proposedRoute.providerSlug}\``,
    `- current service tier: \`${formatTier(input.currentRoute.serviceTier)}\``,
    `- proposed service tier: \`${formatTier(input.proposedRoute.serviceTier)}\``,
    "",
    "The provider pin is the only route-data change. The production service tier is preserved exactly because the live qualification uses the current production tier while replacing only the provider pin.",
    "",
    "### Evidence",
    `- candidate: ${providerName} (\`${p.candidateProviderSlug}\`)`,
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
    "- production `service_tier`",
    "- `allow_fallbacks: false`",
    "- `require_parameters: true`",
    "- existing reasoning/prompt assembly",
    "",
    "### Rollback",
    `Restore \`${MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH}\` for \`${input.openRouterSlug}\` to provider \`${input.currentRoute.providerSlug}\` with service tier \`${formatTier(input.currentRoute.serviceTier)}\`, then redeploy.`,
    "",
    "### Review boundary",
    "- This PR changes only the canonical route-data owner.",
    "- The exact proposed route was typechecked/regression-tested before this branch was created.",
    "- Do not merge if provider economics, privacy terms, model identity, or endpoint capability changed after the evidence window.",
    "- Automatic merge is prohibited.",
    "",
  ].join("\n");
}

function planOne(input: {
  proposal: SupplyPromotionProposal;
  radar: MainRpSupplyRadarReport;
  live: MainRpSupplyLiveQualificationReport;
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
  if (!validProviderSlug(p.candidateProviderSlug)) {
    return skip("candidate_provider_slug_invalid");
  }
  if (
    !sameRunFreshnessOk({
      radarGeneratedAt: input.radar.generatedAt,
      liveGeneratedAt: input.live.generatedAt,
    })
  ) {
    return skip("fresh_live_report_missing_or_stale");
  }

  const fresh = input.live.results.find(
    (result) =>
      result.candidate.modelId === p.modelId &&
      result.candidate.providerSlug === p.candidateProviderSlug
  );
  if (!fresh) return skip("fresh_live_candidate_not_tested_this_run");
  if (!fresh.livePairComplete || fresh.turns.length !== 2) {
    return skip("fresh_live_pair_incomplete");
  }
  if (!fresh.turns.every((turn) => turn.servedProviderMatch === true)) {
    return skip("fresh_live_provider_identity_unproven");
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

  const proposedRoute: MainRpOpenRouterRouteConfigEntry = {
    providerSlug: p.candidateProviderSlug,
    serviceTier: currentRoute.serviceTier,
  };
  const proposedConfig = cloneConfig(input.routeConfig);
  proposedConfig[model.openRouterSlug] = proposedRoute;

  return {
    plan: {
      modelId: p.modelId,
      openRouterSlug: model.openRouterSlug,
      branchName: `automation/supply-${modelToken}-${providerToken}`.slice(0, 180),
      title: `draft(routing): promote ${p.modelId} to ${p.candidateProviderSlug}`,
      body: draftBody({
        proposal: p,
        openRouterSlug: model.openRouterSlug,
        currentRoute,
        proposedRoute,
      }),
      currentRoute: { ...currentRoute },
      proposedRoute,
      proposedConfig,
      candidateProviderName: cleanText(p.candidateProviderName),
      candidateProviderSlug: p.candidateProviderSlug,
    },
  };
}

export function planMainRpSupplyAutoDrafts(input: {
  packet: MainRpSupplyPromotionProposalPacket;
  radar: MainRpSupplyRadarReport;
  live: MainRpSupplyLiveQualificationReport;
  routeConfig: MainRpOpenRouterRouteConfig;
}): SupplyAutoDraftPlanningResult {
  const plans: SupplyAutoDraftPlan[] = [];
  const skipped: SupplyAutoDraftSkip[] = [];

  for (const proposal of input.packet.proposals) {
    const result = planOne({
      proposal,
      radar: input.radar,
      live: input.live,
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
