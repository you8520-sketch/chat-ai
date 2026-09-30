import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MainRpSupplyPromotionProposalPacket } from "./mainRpSupplyPromotionProposal";
import {
  buildMainRpSupplyAutoDraftPlan,
  executeGitHubDraftRoutePr,
  type MainRpOpenRouterRouteRegistry,
} from "./mainRpSupplyAutoDraft";

function proposal(input: {
  modelId?: "gemini-3.7-flash" | "deepseek-v4.1-flash";
  providerSlug?: string;
  providerName?: string;
  transition?: "SAME_OPENROUTER_TRANSPORT" | "CROSS_PROVIDER_PROCUREMENT";
  eligible?: boolean;
} = {}) {
  const modelId = input.modelId ?? "gemini-3.7-flash";
  const providerSlug = input.providerSlug ?? "qualified-provider";
  const providerName = input.providerName ?? "Qualified Provider";
  const transition = input.transition ?? "SAME_OPENROUTER_TRANSPORT";
  const eligible = input.eligible ?? transition === "SAME_OPENROUTER_TRANSPORT";
  return {
    modelId,
    candidateProviderName: providerName,
    candidateProviderSlug: providerSlug,
    proposedRoute: eligible
      ? {
          providerSlug,
          providerLabel: providerName,
          serviceTier: null as const,
        }
      : null,
    currentProcurementProvider:
      transition === "SAME_OPENROUTER_TRANSPORT"
        ? ("openrouter" as const)
        : ("cheaperinference" as const),
    transitionKind: transition,
    draftRoutePrEligible: eligible,
    automaticMergeEligible: false as const,
    stopReason:
      transition === "CROSS_PROVIDER_PROCUREMENT"
        ? "provider_call_cost_or_billing_path_changes_require_explicit_review_before_route_mutation"
        : null,
    evidence: {
      qualifyingMarketSnapshots: 4,
      marketObservationSpanDays: 21,
      completeLivePairs: 2,
      liveObservationSpanDays: 21,
      latestSavingsPercent: 18,
      worstCandidateTotalVsBaselineRatio: 0.82,
      worstCandidateTtftVsBaselineRatio: 0.9,
    },
    requiredReviewOwners: [],
  };
}

function packet(
  proposals: ReturnType<typeof proposal>[]
): MainRpSupplyPromotionProposalPacket {
  return {
    version: 1,
    generatedAt: "2026-10-22T00:00:00.000Z",
    proposals,
    draftRoutePrEligibleCount: proposals.filter((row) => row.draftRoutePrEligible)
      .length,
    crossProviderReviewRequiredCount: proposals.filter(
      (row) => row.transitionKind === "CROSS_PROVIDER_PROCUREMENT"
    ).length,
    automaticMergeEligibleCount: 0,
    notes: [],
  };
}

function registry(): MainRpOpenRouterRouteRegistry {
  return {
    "gemini-3.1-pro-preview": {
      providerSlug: "google-ai-studio",
      providerLabel: "Google AI Studio",
      serviceTier: "flex",
    },
    "gemini-3.7-flash": {
      providerSlug: "google-ai-studio",
      providerLabel: "Google AI Studio",
      serviceTier: "flex",
    },
    "gemini-3.8-flash": {
      providerSlug: "google-ai-studio",
      providerLabel: "Google AI Studio",
      serviceTier: "flex",
    },
  };
}

describe("Main RP supply auto-Draft plan", () => {
  it("changes only the promoted model route and matches the tested default service tier", () => {
    const current = registry();
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([proposal()]),
      routeRegistry: current,
      runId: "12345",
      generatedAt: "2026-10-22T00:00:00.000Z",
    });

    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.automaticMergeEligibleCount, 0);
    const mutation = plan.mutations[0]!;
    assert.deepEqual(mutation.currentRoute, {
      providerSlug: "google-ai-studio",
      providerLabel: "Google AI Studio",
      serviceTier: "flex",
    });
    assert.deepEqual(mutation.nextRoute, {
      providerSlug: "qualified-provider",
      providerLabel: "Qualified Provider",
      serviceTier: null,
    });
    assert.deepEqual(
      mutation.updatedRegistry["gemini-3.1-pro-preview"],
      current["gemini-3.1-pro-preview"]
    );
    assert.deepEqual(
      mutation.updatedRegistry["gemini-3.8-flash"],
      current["gemini-3.8-flash"]
    );
    assert.match(mutation.body, /service tier: `default`/);
    assert.match(mutation.body, /never auto-merged/);
  });

  it("never creates a branch plan for cross-provider procurement", () => {
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([
        proposal({
          modelId: "deepseek-v4.1-flash",
          transition: "CROSS_PROVIDER_PROCUREMENT",
          eligible: false,
        }),
      ]),
      routeRegistry: registry(),
      runId: "12345",
    });
    assert.equal(plan.mutations.length, 0);
    assert.equal(plan.decisions[0]?.status, "STOP");
    assert.match(plan.decisions[0]?.reason ?? "", /billing_path_changes/);
  });

  it("stops instead of ranking multiple promotion-ready suppliers for the same model", () => {
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([
        proposal({ providerSlug: "provider-a", providerName: "Provider A" }),
        proposal({ providerSlug: "provider-b", providerName: "Provider B" }),
      ]),
      routeRegistry: registry(),
      runId: "12345",
    });
    assert.equal(plan.mutations.length, 0);
    assert.equal(
      plan.decisions.filter(
        (row) =>
          row.status === "STOP" &&
          row.reason === "multiple_promotion_ready_candidates_for_same_model"
      ).length,
      2
    );
  });

  it("skips an already-applied exact route instead of opening duplicate PRs", () => {
    const current = registry();
    current["gemini-3.7-flash"] = {
      providerSlug: "qualified-provider",
      providerLabel: "Qualified Provider",
      serviceTier: null,
    };
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([proposal()]),
      routeRegistry: current,
      runId: "12345",
    });
    assert.equal(plan.mutations.length, 0);
    assert.equal(plan.decisions[0]?.status, "SKIP");
    assert.equal(plan.decisions[0]?.reason, "route_already_matches_proposal");
  });

  it("fails closed on unsafe provider slugs", () => {
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([
        proposal({ providerSlug: "bad/provider", providerName: "Bad Provider" }),
      ]),
      routeRegistry: registry(),
      runId: "12345",
    });
    assert.equal(plan.mutations.length, 0);
    assert.equal(plan.decisions[0]?.reason, "unsafe_provider_slug");
  });
});

describe("GitHub Draft route PR executor", () => {
  it("dry-run performs zero GitHub requests", async () => {
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([proposal()]),
      routeRegistry: registry(),
      runId: "12345",
    });
    let calls = 0;
    const result = await executeGitHubDraftRoutePr({
      repo: "owner/repo",
      token: "token",
      baseSha: "base-sha",
      baseBranch: "main",
      mutation: plan.mutations[0]!,
      dryRun: true,
      fetchImpl: (async () => {
        calls += 1;
        throw new Error("must not fetch");
      }) as typeof fetch,
    });
    assert.equal(result.status, "DRY_RUN");
    assert.equal(calls, 0);
  });

  it("creates a branch, updates only the route registry, and opens a Draft PR", async () => {
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([proposal()]),
      routeRegistry: registry(),
      runId: "12345",
    });
    const mutation = plan.mutations[0]!;
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const responses = [
      new Response(JSON.stringify([]), { status: 200 }),
      new Response(JSON.stringify({ object: { sha: "base-sha" } }), {
        status: 200,
      }),
      new Response(JSON.stringify({ ref: "created" }), { status: 201 }),
      new Response(JSON.stringify({ sha: "route-file-sha" }), { status: 200 }),
      new Response(JSON.stringify({ content: { sha: "new-file" } }), {
        status: 200,
      }),
      new Response(JSON.stringify({ object: { sha: "base-sha" } }), {
        status: 200,
      }),
      new Response(
        JSON.stringify({
          html_url: "https://github.com/owner/repo/pull/42",
          number: 42,
        }),
        { status: 201 }
      ),
    ];
    const fakeFetch = (async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      return next;
    }) as typeof fetch;

    const result = await executeGitHubDraftRoutePr({
      repo: "owner/repo",
      token: "token",
      baseSha: "base-sha",
      baseBranch: "main",
      mutation,
      dryRun: false,
      fetchImpl: fakeFetch,
    });

    assert.equal(result.status, "CREATED");
    assert.equal(result.pullRequestUrl, "https://github.com/owner/repo/pull/42");
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET", "GET", "POST", "GET", "PUT", "GET", "POST"]
    );
    assert.equal(
      calls.filter((call) => call.url.includes("/contents/")).length,
      2
    );
    const update = calls.find((call) => call.method === "PUT")!;
    assert.match(update.url, /mainRpOpenRouterRoutes\.json$/);
    const updateBody = update.body as Record<string, unknown>;
    const decoded = Buffer.from(String(updateBody.content), "base64").toString(
      "utf8"
    );
    const updatedRegistry = JSON.parse(decoded) as MainRpOpenRouterRouteRegistry;
    assert.deepEqual(updatedRegistry["gemini-3.7-flash"], {
      providerSlug: "qualified-provider",
      providerLabel: "Qualified Provider",
      serviceTier: null,
    });

    const createPull = calls.find(
      (call) => call.method === "POST" && call.url.endsWith("/pulls")
    )!;
    assert.equal((createPull.body as Record<string, unknown>).draft, true);
  });

  it("stops when another auto route PR for the same model is already open", async () => {
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([proposal()]),
      routeRegistry: registry(),
      runId: "12345",
    });
    const mutation = plan.mutations[0]!;
    const calls: string[] = [];
    const fakeFetch = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      calls.push(init?.method ?? "GET");
      return new Response(
        JSON.stringify([
          {
            title:
              "[auto] Main RP supply route: gemini-3.7-flash → Another Provider",
            html_url: "https://github.com/owner/repo/pull/41",
            head: {
              ref: "automation/supply-route/gemini-3.7-flash/another/old-run",
            },
          },
        ]),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await executeGitHubDraftRoutePr({
      repo: "owner/repo",
      token: "token",
      baseSha: "base-sha",
      baseBranch: "main",
      mutation,
      dryRun: false,
      fetchImpl: fakeFetch,
    });

    assert.equal(result.status, "CONFLICTING_OPEN_PR_STOP");
    assert.equal(
      result.pullRequestUrl,
      "https://github.com/owner/repo/pull/41"
    );
    assert.match(result.error ?? "", /another_auto_route_pr/);
    assert.deepEqual(calls, ["GET"]);
  });

  it("deletes the just-created branch and stops if main moves before PR creation", async () => {
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([proposal()]),
      routeRegistry: registry(),
      runId: "12345",
    });
    const mutation = plan.mutations[0]!;
    const calls: Array<{ url: string; method: string }> = [];
    const responses = [
      new Response(JSON.stringify([]), { status: 200 }),
      new Response(JSON.stringify({ object: { sha: "base-sha" } }), {
        status: 200,
      }),
      new Response(JSON.stringify({ ref: "created" }), { status: 201 }),
      new Response(JSON.stringify({ sha: "route-file-sha" }), { status: 200 }),
      new Response(JSON.stringify({ content: { sha: "new-file" } }), {
        status: 200,
      }),
      new Response(JSON.stringify({ object: { sha: "new-main" } }), {
        status: 200,
      }),
      new Response("", { status: 204 }),
    ];
    const fakeFetch = (async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      return next;
    }) as typeof fetch;

    const result = await executeGitHubDraftRoutePr({
      repo: "owner/repo",
      token: "token",
      baseSha: "base-sha",
      baseBranch: "main",
      mutation,
      dryRun: false,
      fetchImpl: fakeFetch,
    });

    assert.equal(result.status, "STALE_MAIN_STOP");
    assert.match(result.error ?? "", /actual_main=new-main/);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["GET", "GET", "POST", "GET", "PUT", "GET", "DELETE"]
    );
    assert.equal(
      calls.some(
        (call) => call.method === "POST" && call.url.endsWith("/pulls")
      ),
      false
    );
  });

  it("stops before any write when main moved after evidence generation", async () => {
    const plan = buildMainRpSupplyAutoDraftPlan({
      packet: packet([proposal()]),
      routeRegistry: registry(),
      runId: "12345",
    });
    const methods: string[] = [];
    const fakeFetch = (async (
      _url: string | URL | Request,
      init?: RequestInit
    ) => {
      methods.push(init?.method ?? "GET");
      if (methods.length === 1) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ object: { sha: "new-main" } }), {
        status: 200,
      });
    }) as typeof fetch;

    const result = await executeGitHubDraftRoutePr({
      repo: "owner/repo",
      token: "token",
      baseSha: "old-main",
      baseBranch: "main",
      mutation: plan.mutations[0]!,
      dryRun: false,
      fetchImpl: fakeFetch,
    });
    assert.equal(result.status, "STALE_MAIN_STOP");
    assert.deepEqual(methods, ["GET", "GET"]);
  });
});
