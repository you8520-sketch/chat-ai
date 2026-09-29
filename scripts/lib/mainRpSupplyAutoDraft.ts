import type {
  MainRpSupplyPromotionProposalPacket,
  SupplyPromotionProposal,
} from "./mainRpSupplyPromotionProposal";

export const MAIN_RP_SUPPLY_AUTO_DRAFT_VERSION = 1;
export const MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH =
  "src/lib/mainRpOpenRouterRoutes.json";

export type MainRpOpenRouterRouteRegistryEntry = {
  providerSlug: string;
  providerLabel: string;
  serviceTier: "flex" | null;
};

export type MainRpOpenRouterRouteRegistry = Record<
  string,
  MainRpOpenRouterRouteRegistryEntry
>;

export type SupplyAutoDraftMutation = {
  modelId: string;
  candidateProviderSlug: string;
  candidateProviderName: string;
  branchName: string;
  title: string;
  body: string;
  currentRoute: MainRpOpenRouterRouteRegistryEntry;
  nextRoute: MainRpOpenRouterRouteRegistryEntry;
  updatedRegistry: MainRpOpenRouterRouteRegistry;
};

export type SupplyAutoDraftDecision = {
  modelId: string;
  candidateProviderSlug: string | null;
  status: "CREATE_DRAFT_PR" | "SKIP" | "STOP";
  reason: string;
};

export type MainRpSupplyAutoDraftPlan = {
  version: number;
  generatedAt: string;
  mutations: SupplyAutoDraftMutation[];
  decisions: SupplyAutoDraftDecision[];
  automaticMergeEligibleCount: 0;
};

const SAFE_PROVIDER_SLUG = /^[a-z0-9][a-z0-9._-]*$/;

function safeBranchPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cloneRegistry(
  registry: MainRpOpenRouterRouteRegistry
): MainRpOpenRouterRouteRegistry {
  return Object.fromEntries(
    Object.entries(registry).map(([key, value]) => [key, { ...value }])
  );
}

function sameRoute(
  current: MainRpOpenRouterRouteRegistryEntry,
  next: MainRpOpenRouterRouteRegistryEntry
): boolean {
  return (
    current.providerSlug === next.providerSlug &&
    current.serviceTier === next.serviceTier
  );
}

function proposalBody(input: {
  proposal: SupplyPromotionProposal;
  currentRoute: MainRpOpenRouterRouteRegistryEntry;
  nextRoute: MainRpOpenRouterRouteRegistryEntry;
}): string {
  const { proposal, currentRoute, nextRoute } = input;
  const evidence = proposal.evidence;
  return [
    "## AUTO-GENERATED DRAFT — Main RP supplier route proposal",
    "",
    "> This PR was created by the evidence-gated Main RP Supply Radar. It is intentionally Draft and is never auto-merged.",
    "",
    "### Route change",
    `- model: \`${proposal.modelId}\``,
    `- current provider: \`${currentRoute.providerLabel}\` (\`${currentRoute.providerSlug}\`)`,
    `- current service tier: \`${currentRoute.serviceTier ?? "default"}\``,
    `- proposed provider: \`${nextRoute.providerLabel}\` (\`${nextRoute.providerSlug}\`)`,
    `- proposed service tier: \`${nextRoute.serviceTier ?? "default"}\``,
    "- fallback: disabled",
    "",
    "The proposed service tier is `default` because alternate-provider live qualification explicitly removed the inherited production `service_tier`; this Draft therefore matches the tested route/service-class instead of silently preserving Flex.",
    "",
    "### Promotion evidence",
    `- qualifying market snapshots: **${evidence.qualifyingMarketSnapshots}**`,
    `- market observation span: **${evidence.marketObservationSpanDays.toFixed(1)} days**`,
    `- complete canonical two-turn live pairs: **${evidence.completeLivePairs}**`,
    `- live observation span: **${evidence.liveObservationSpanDays.toFixed(1)} days**`,
    `- latest representative-rate saving: **${evidence.latestSavingsPercent == null ? "n/a" : evidence.latestSavingsPercent.toFixed(1) + "%"}**`,
    `- worst candidate/current total-time ratio: **${evidence.worstCandidateTotalVsBaselineRatio == null ? "n/a" : evidence.worstCandidateTotalVsBaselineRatio.toFixed(3)}**`,
    `- worst candidate/current TTFT ratio: **${evidence.worstCandidateTtftVsBaselineRatio == null ? "n/a" : evidence.worstCandidateTtftVsBaselineRatio.toFixed(3)}**`,
    "",
    "### Canonical owner",
    `Only \`${MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH}\` is changed. UI provider hint and production route policy both derive from this registry.`,
    "",
    "### Required review / rollback",
    "- Confirm PR CI is green.",
    "- Review the supply-radar artifacts linked from the originating scheduled run.",
    "- Merge remains a human/GPT decision; this automation never merges.",
    `- Rollback: restore \`${proposal.modelId}\` to provider \`${currentRoute.providerSlug}\` with serviceTier \`${currentRoute.serviceTier ?? "default"}\` in the same canonical registry.`,
    "",
    "### System delta",
    "**BEFORE:** production OpenRouter route uses the current registry entry.",
    "",
    "**AFTER:** only this model's OpenRouter sub-provider route entry changes to the repeatedly-qualified candidate.",
    "",
    "**PRESERVED:** model identity, prompt/runtime controls, user-facing published pricing, fallback-disabled invariant, and all other model routes.",
    "",
    "### STOP",
    "Do not merge if CI reveals parameter/control drift, if current procurement has changed since this proposal, or if the change is no longer same-OpenRouter-transport.",
    "",
  ].join("\n");
}

function eligibleProposalGroups(
  packet: MainRpSupplyPromotionProposalPacket
): Map<string, SupplyPromotionProposal[]> {
  const groups = new Map<string, SupplyPromotionProposal[]>();
  for (const proposal of packet.proposals) {
    const rows = groups.get(proposal.modelId) ?? [];
    rows.push(proposal);
    groups.set(proposal.modelId, rows);
  }
  return groups;
}

export function buildMainRpSupplyAutoDraftPlan(input: {
  packet: MainRpSupplyPromotionProposalPacket;
  routeRegistry: MainRpOpenRouterRouteRegistry;
  runId: string;
  generatedAt?: string;
}): MainRpSupplyAutoDraftPlan {
  const mutations: SupplyAutoDraftMutation[] = [];
  const decisions: SupplyAutoDraftDecision[] = [];
  const groups = eligibleProposalGroups(input.packet);

  for (const [modelId, proposals] of groups) {
    for (const proposal of proposals) {
      if (proposal.transitionKind === "CROSS_PROVIDER_PROCUREMENT") {
        decisions.push({
          modelId,
          candidateProviderSlug: proposal.candidateProviderSlug,
          status: "STOP",
          reason:
            proposal.stopReason ??
            "cross_provider_procurement_requires_explicit_review",
        });
      } else if (proposal.transitionKind === "UNKNOWN_CURRENT_PROCUREMENT") {
        decisions.push({
          modelId,
          candidateProviderSlug: proposal.candidateProviderSlug,
          status: "STOP",
          reason: proposal.stopReason ?? "current_procurement_owner_unresolved",
        });
      }
    }

    const eligible = proposals.filter(
      (proposal) =>
        proposal.transitionKind === "SAME_OPENROUTER_TRANSPORT" &&
        proposal.draftRoutePrEligible &&
        proposal.proposedRoute != null
    );

    if (eligible.length === 0) continue;

    if (eligible.length > 1) {
      for (const proposal of eligible) {
        decisions.push({
          modelId,
          candidateProviderSlug: proposal.candidateProviderSlug,
          status: "STOP",
          reason: "multiple_promotion_ready_candidates_for_same_model",
        });
      }
      continue;
    }

    const proposal = eligible[0]!;
    const currentRoute = input.routeRegistry[modelId];
    if (!currentRoute) {
      decisions.push({
        modelId,
        candidateProviderSlug: proposal.candidateProviderSlug,
        status: "STOP",
        reason: "canonical_openrouter_route_registry_entry_missing",
      });
      continue;
    }

    const proposed = proposal.proposedRoute!;
    if (!SAFE_PROVIDER_SLUG.test(proposed.providerSlug)) {
      decisions.push({
        modelId,
        candidateProviderSlug: proposal.candidateProviderSlug,
        status: "STOP",
        reason: "unsafe_provider_slug",
      });
      continue;
    }
    if (!proposed.providerLabel.trim()) {
      decisions.push({
        modelId,
        candidateProviderSlug: proposal.candidateProviderSlug,
        status: "STOP",
        reason: "provider_label_missing",
      });
      continue;
    }

    const nextRoute: MainRpOpenRouterRouteRegistryEntry = {
      providerSlug: proposed.providerSlug,
      providerLabel: proposed.providerLabel.trim(),
      serviceTier: null,
    };

    if (sameRoute(currentRoute, nextRoute)) {
      decisions.push({
        modelId,
        candidateProviderSlug: proposal.candidateProviderSlug,
        status: "SKIP",
        reason: "route_already_matches_proposal",
      });
      continue;
    }

    const updatedRegistry = cloneRegistry(input.routeRegistry);
    updatedRegistry[modelId] = nextRoute;
    const branchName = [
      "automation",
      "supply-route",
      safeBranchPart(modelId),
      safeBranchPart(proposed.providerSlug),
      safeBranchPart(input.runId),
    ].join("/");

    const title = `[auto] Main RP supply route: ${modelId} → ${proposed.providerLabel}`;
    mutations.push({
      modelId,
      candidateProviderSlug: proposed.providerSlug,
      candidateProviderName: proposed.providerLabel,
      branchName,
      title,
      body: proposalBody({ proposal, currentRoute, nextRoute }),
      currentRoute: { ...currentRoute },
      nextRoute,
      updatedRegistry,
    });
    decisions.push({
      modelId,
      candidateProviderSlug: proposal.candidateProviderSlug,
      status: "CREATE_DRAFT_PR",
      reason: "same_openrouter_transport_promotion_ready",
    });
  }

  return {
    version: MAIN_RP_SUPPLY_AUTO_DRAFT_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    mutations,
    decisions,
    automaticMergeEligibleCount: 0,
  };
}

type FetchLike = typeof fetch;

async function githubRequest(input: {
  fetchImpl: FetchLike;
  token: string;
  url: string;
  method?: string;
  body?: unknown;
}): Promise<Response> {
  return input.fetchImpl(input.url, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "PlayAI-SupplyAutoDraft/1.0",
    },
    ...(input.body == null ? {} : { body: JSON.stringify(input.body) }),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function base64Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export type GitHubDraftExecutionResult = {
  modelId: string;
  candidateProviderSlug: string;
  status:
    | "CREATED"
    | "DRY_RUN"
    | "EXISTING_OPEN_PR"
    | "STALE_MAIN_STOP"
    | "PREFLIGHT_FAILED"
    | "FAILED";
  pullRequestUrl: string | null;
  branchName: string | null;
  error: string | null;
};

export async function executeGitHubDraftRoutePr(input: {
  repo: string;
  token: string;
  baseSha: string;
  baseBranch: string;
  mutation: SupplyAutoDraftMutation;
  dryRun: boolean;
  fetchImpl?: FetchLike;
}): Promise<GitHubDraftExecutionResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const api = `https://api.github.com/repos/${input.repo}`;

  if (input.dryRun) {
    return {
      modelId: input.mutation.modelId,
      candidateProviderSlug: input.mutation.candidateProviderSlug,
      status: "DRY_RUN",
      pullRequestUrl: null,
      branchName: input.mutation.branchName,
      error: null,
    };
  }

  try {
    const openPullsResponse = await githubRequest({
      fetchImpl,
      token: input.token,
      url: `${api}/pulls?state=open&base=${encodeURIComponent(input.baseBranch)}&per_page=100`,
    });
    if (!openPullsResponse.ok) {
      throw new Error(`list_open_pulls_http_${openPullsResponse.status}`);
    }
    const openPulls = (await openPullsResponse.json()) as Array<
      Record<string, unknown>
    >;
    const duplicate = openPulls.find(
      (pull) => String(pull.title ?? "") === input.mutation.title
    );
    if (duplicate) {
      return {
        modelId: input.mutation.modelId,
        candidateProviderSlug: input.mutation.candidateProviderSlug,
        status: "EXISTING_OPEN_PR",
        pullRequestUrl:
          typeof duplicate.html_url === "string" ? duplicate.html_url : null,
        branchName:
          typeof (duplicate.head as Record<string, unknown> | undefined)?.ref ===
          "string"
            ? String((duplicate.head as Record<string, unknown>).ref)
            : null,
        error: null,
      };
    }

    const baseRefResponse = await githubRequest({
      fetchImpl,
      token: input.token,
      url: `${api}/git/ref/heads/${encodeURIComponent(input.baseBranch)}`,
    });
    if (!baseRefResponse.ok) {
      throw new Error(`base_ref_http_${baseRefResponse.status}`);
    }
    const baseRef = await responseJson(baseRefResponse);
    const currentMainSha = String(
      (baseRef.object as Record<string, unknown> | undefined)?.sha ?? ""
    );
    if (currentMainSha !== input.baseSha) {
      return {
        modelId: input.mutation.modelId,
        candidateProviderSlug: input.mutation.candidateProviderSlug,
        status: "STALE_MAIN_STOP",
        pullRequestUrl: null,
        branchName: null,
        error: `expected_main=${input.baseSha} actual_main=${currentMainSha}`,
      };
    }

    const createRefResponse = await githubRequest({
      fetchImpl,
      token: input.token,
      url: `${api}/git/refs`,
      method: "POST",
      body: {
        ref: `refs/heads/${input.mutation.branchName}`,
        sha: input.baseSha,
      },
    });
    if (!createRefResponse.ok) {
      throw new Error(`create_ref_http_${createRefResponse.status}`);
    }

    let branchCreated = true;
    try {
      const contentResponse = await githubRequest({
        fetchImpl,
        token: input.token,
        url:
          `${api}/contents/${MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH}` +
          `?ref=${encodeURIComponent(input.baseSha)}`,
      });
      if (!contentResponse.ok) {
        throw new Error(`route_registry_http_${contentResponse.status}`);
      }
      const contentInfo = await responseJson(contentResponse);
      const fileSha = String(contentInfo.sha ?? "");
      if (!fileSha) throw new Error("route_registry_sha_missing");

      const content = JSON.stringify(input.mutation.updatedRegistry, null, 2) + "\n";
      const updateResponse = await githubRequest({
        fetchImpl,
        token: input.token,
        url: `${api}/contents/${MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH}`,
        method: "PUT",
        body: {
          message: `chore(routing): propose ${input.mutation.modelId} supplier route`,
          content: base64Utf8(content),
          sha: fileSha,
          branch: input.mutation.branchName,
        },
      });
      if (!updateResponse.ok) {
        throw new Error(`update_route_registry_http_${updateResponse.status}`);
      }

      const pullResponse = await githubRequest({
        fetchImpl,
        token: input.token,
        url: `${api}/pulls`,
        method: "POST",
        body: {
          title: input.mutation.title,
          head: input.mutation.branchName,
          base: input.baseBranch,
          body: input.mutation.body,
          draft: true,
          maintainer_can_modify: true,
        },
      });
      if (!pullResponse.ok) {
        throw new Error(`create_pull_http_${pullResponse.status}`);
      }
      const pull = await responseJson(pullResponse);
      branchCreated = false;
      return {
        modelId: input.mutation.modelId,
        candidateProviderSlug: input.mutation.candidateProviderSlug,
        status: "CREATED",
        pullRequestUrl:
          typeof pull.html_url === "string" ? pull.html_url : null,
        branchName: input.mutation.branchName,
        error: null,
      };
    } catch (error) {
      if (branchCreated) {
        try {
          await githubRequest({
            fetchImpl,
            token: input.token,
            url: `${api}/git/refs/heads/${input.mutation.branchName
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`,
            method: "DELETE",
          });
        } catch {
          // Best-effort cleanup only. Never hide the primary failure.
        }
      }
      throw error;
    }
  } catch (error) {
    return {
      modelId: input.mutation.modelId,
      candidateProviderSlug: input.mutation.candidateProviderSlug,
      status: "FAILED",
      pullRequestUrl: null,
      branchName: input.mutation.branchName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function renderMainRpSupplyAutoDraftMarkdown(input: {
  plan: MainRpSupplyAutoDraftPlan;
  executions: GitHubDraftExecutionResult[];
  dryRun: boolean;
}): string {
  const lines = [
    "# Main RP Supply Auto-Draft",
    "",
    `- dry run: **${input.dryRun ? "YES" : "NO"}**`,
    `- planned Draft route PRs: **${input.plan.mutations.length}**`,
    `- automatic merge eligible: **0**`,
    "",
    "## Decisions",
    "",
    "| Model | Candidate | Status | Reason |",
    "|---|---|---|---|",
  ];
  for (const row of input.plan.decisions) {
    lines.push(
      `| ${row.modelId} | ${row.candidateProviderSlug ?? "n/a"} | ${row.status} | ${row.reason} |`
    );
  }
  if (!input.plan.decisions.length) {
    lines.push("| — | — | SKIP | no promotion-ready proposal |");
  }

  lines.push("", "## GitHub execution", "");
  for (const row of input.executions) {
    lines.push(
      `- ${row.modelId} / ${row.candidateProviderSlug}: **${row.status}**` +
        (row.pullRequestUrl ? ` — ${row.pullRequestUrl}` : "") +
        (row.error ? ` — ${row.error}` : "")
    );
  }
  if (!input.executions.length) lines.push("- no GitHub write attempted");
  lines.push(
    "",
    "## Safety boundary",
    "",
    "- Cross-provider procurement proposals never create a branch.",
    "- Multiple promotion-ready candidates for the same model stop for review.",
    "- The automation changes only the canonical Main RP OpenRouter route registry.",
    "- All generated pull requests are Draft.",
    "- This code contains no merge operation.",
    ""
  );
  return lines.join("\n");
}
