import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { MainRpSupplyRadarReport } from "./lib/mainRpSupplyRadar";
import type { MainRpSupplyPromotionProposalPacket } from "./lib/mainRpSupplyPromotionProposal";
import {
  MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH,
  planMainRpSupplyAutoDrafts,
  serializeRouteConfig,
  type MainRpOpenRouterRouteConfig,
  type SupplyAutoDraftPlan,
} from "./lib/mainRpSupplyAutoDraftPr";

const OUT_DIR =
  process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() ||
  "artifacts/main-rp-supply-radar";
const API = "https://api.github.com";

type JsonObject = Record<string, unknown>;

type DraftResult = {
  modelId: string;
  candidateProviderSlug: string;
  branchName: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  status:
    | "CREATED_DRAFT_PR"
    | "SKIPPED_EXISTING_OPEN_PR"
    | "SKIPPED_PLANNER"
    | "STOP_MAIN_MOVED"
    | "STOP_BRANCH_EXISTS_WITHOUT_OPEN_PR"
    | "STOP_REPOSITORY_PR_CREATION_SETTING"
    | "VALIDATED_DRY_RUN";
  reason: string | null;
};

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`Missing auto-draft input: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function githubContext(): {
  repo: string;
  owner: string;
  token: string;
  sha: string;
} {
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  const token = process.env.GITHUB_TOKEN?.trim();
  const sha = process.env.GITHUB_SHA?.trim();
  if (!repo || !repo.includes("/") || !token || !sha) {
    throw new Error("Missing GITHUB_REPOSITORY, GITHUB_TOKEN, or GITHUB_SHA");
  }
  return { repo, owner: repo.split("/")[0]!, token, sha };
}

async function githubFetch(
  context: { repo: string; token: string },
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${context.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PlayAI-SupplyAutoDraft/1.0",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function githubJson(
  context: { repo: string; token: string },
  path: string,
  init: RequestInit = {}
): Promise<JsonObject> {
  const response = await githubFetch(context, path, init);
  if (!response.ok) {
    const body = (await response.text()).slice(0, 2_000);
    const error = new Error(
      `GitHub API ${response.status} ${path}: ${body}`
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return {};
  return (await response.json()) as JsonObject;
}

async function mainHeadSha(context: {
  repo: string;
  token: string;
}): Promise<string> {
  const payload = await githubJson(
    context,
    `/repos/${context.repo}/git/ref/heads/main`
  );
  return String((payload.object as JsonObject | undefined)?.sha ?? "");
}

async function existingOpenPr(input: {
  context: { repo: string; owner: string; token: string };
  branchName: string;
}): Promise<{ number: number; url: string } | null> {
  const head = encodeURIComponent(
    `${input.context.owner}:${input.branchName}`
  );
  const payload = await githubJson(
    input.context,
    `/repos/${input.context.repo}/pulls?state=open&head=${head}&per_page=20`
  );
  const rows = Array.isArray(payload)
    ? (payload as unknown as JsonObject[])
    : [];
  const row = rows[0];
  if (!row) return null;
  return {
    number: Number(row.number),
    url: String(row.html_url ?? ""),
  };
}

async function branchExists(input: {
  context: { repo: string; token: string };
  branchName: string;
}): Promise<boolean> {
  const response = await githubFetch(
    input.context,
    `/repos/${input.context.repo}/git/ref/heads/${input.branchName}`
  );
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(
      `GitHub API ${response.status} while checking branch ${input.branchName}`
    );
  }
  return true;
}

function runValidation(plan: SupplyAutoDraftPlan): void {
  const original = readFileSync(MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH, "utf8");
  try {
    writeFileSync(
      MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH,
      serializeRouteConfig(plan.proposedConfig),
      "utf8"
    );
    execFileSync("npm", ["run", "typecheck:app"], {
      stdio: "inherit",
      env: process.env,
    });
    execFileSync(
      "node",
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--test",
        "--test-concurrency=1",
        "src/lib/openRouterConfig.test.ts",
        "src/lib/openRouterClient.test.ts",
        "src/lib/chatModels.gemini.test.ts",
        "src/lib/mainRpModelRegistry.test.ts",
        "scripts/lib/mainRpSupplyPromotionProposal.test.ts",
        "scripts/lib/mainRpSupplyAutoDraftPr.test.ts",
        "scripts/lib/mainRpSupplyLiveQualification.test.ts",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
          MAIN_RP_SUPPLY_LIVE_QUALIFICATION: "0",
          CHEAPER_INFERENCE_API_KEY: "",
          OPENROUTER_API_KEY: "",
          OPENAI_API_KEY: "",
        },
      }
    );
  } finally {
    writeFileSync(MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH, original, "utf8");
  }
}

async function createDraftPr(input: {
  context: {
    repo: string;
    owner: string;
    token: string;
    sha: string;
  };
  plan: SupplyAutoDraftPlan;
}): Promise<DraftResult> {
  const existing = await existingOpenPr({
    context: input.context,
    branchName: input.plan.branchName,
  });
  if (existing) {
    return {
      modelId: input.plan.modelId,
      candidateProviderSlug: input.plan.candidateProviderSlug,
      branchName: input.plan.branchName,
      pullRequestNumber: existing.number,
      pullRequestUrl: existing.url,
      status: "SKIPPED_EXISTING_OPEN_PR",
      reason: "deterministic_branch_already_has_open_pr",
    };
  }

  if (
    await branchExists({
      context: input.context,
      branchName: input.plan.branchName,
    })
  ) {
    return {
      modelId: input.plan.modelId,
      candidateProviderSlug: input.plan.candidateProviderSlug,
      branchName: input.plan.branchName,
      pullRequestNumber: null,
      pullRequestUrl: null,
      status: "STOP_BRANCH_EXISTS_WITHOUT_OPEN_PR",
      reason: "ref_exists_but_no_open_pr; manual_review_required",
    };
  }

  runValidation(input.plan);

  const filePayload = await githubJson(
    input.context,
    `/repos/${input.context.repo}/contents/${MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH}?ref=${encodeURIComponent(input.context.sha)}`
  );
  const fileSha = String(filePayload.sha ?? "");
  if (!fileSha) throw new Error("Could not resolve canonical route config blob SHA");

  await githubJson(input.context, `/repos/${input.context.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${input.plan.branchName}`,
      sha: input.context.sha,
    }),
  });

  await githubJson(
    input.context,
    `/repos/${input.context.repo}/contents/${MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `draft(routing): promote ${input.plan.modelId} supplier`,
        content: Buffer.from(
          serializeRouteConfig(input.plan.proposedConfig),
          "utf8"
        ).toString("base64"),
        sha: fileSha,
        branch: input.plan.branchName,
      }),
    }
  );

  try {
    const pr = await githubJson(
      input.context,
      `/repos/${input.context.repo}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: input.plan.title,
          head: input.plan.branchName,
          base: "main",
          body: input.plan.body,
          draft: true,
          maintainer_can_modify: true,
        }),
      }
    );
    return {
      modelId: input.plan.modelId,
      candidateProviderSlug: input.plan.candidateProviderSlug,
      branchName: input.plan.branchName,
      pullRequestNumber: Number(pr.number),
      pullRequestUrl: String(pr.html_url ?? ""),
      status: "CREATED_DRAFT_PR",
      reason: null,
    };
  } catch (error) {
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status?: number }).status)
        : null;
    if (status === 403) {
      return {
        modelId: input.plan.modelId,
        candidateProviderSlug: input.plan.candidateProviderSlug,
        branchName: input.plan.branchName,
        pullRequestNumber: null,
        pullRequestUrl: null,
        status: "STOP_REPOSITORY_PR_CREATION_SETTING",
        reason:
          "GitHub Actions token could not create a PR; verify repository Actions setting 'Allow GitHub Actions to create and approve pull requests'. Branch was created but main was not changed.",
      };
    }
    throw error;
  }
}

function renderResults(input: {
  results: DraftResult[];
  skipped: Array<{ modelId: string; candidateProviderSlug: string; reason: string }>;
  dryRun: boolean;
  mainSha: string;
}): string {
  const lines = [
    "# Main RP Supply Auto Draft Results",
    "",
    `- source main SHA: `${input.mainSha}``,
    `- dry run: **${input.dryRun ? "YES" : "NO"}**`,
    `- Draft PRs created: **${input.results.filter((row) => row.status === "CREATED_DRAFT_PR").length}**`,
    "- automatic merges: **0**",
    "- production-main route mutations: **0**",
    "",
    "| Model | Candidate | Status | Draft PR | Reason |",
    "|---|---|---|---|---|",
  ];
  for (const row of input.results) {
    lines.push(
      `| ${row.modelId} | ${row.candidateProviderSlug} | ${row.status} | ${row.pullRequestUrl || "—"} | ${row.reason ?? "—"} |`
    );
  }
  for (const row of input.skipped) {
    lines.push(
      `| ${row.modelId} | ${row.candidateProviderSlug} | SKIPPED_PLANNER | — | ${row.reason} |`
    );
  }
  if (!input.results.length && !input.skipped.length) {
    lines.push("| — | — | NO_PROMOTION_READY_DRAFTS | — | — |");
  }
  lines.push(
    "",
    "## Safety boundary",
    "",
    "- Only SAME_OPENROUTER_TRANSPORT proposals may create Draft PRs.",
    "- Cross-provider procurement changes remain STOP-only evidence.",
    "- Candidate route mutation is typechecked and regression-tested before branch creation.",
    "- The Draft modifies only the canonical route JSON.",
    "- No code path in this automation merges a pull request.",
    ""
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const packet = readJson<MainRpSupplyPromotionProposalPacket>(
    join(OUT_DIR, "promotion-proposals.json")
  );
  const radar = readJson<MainRpSupplyRadarReport>(join(OUT_DIR, "report.json"));
  const routeConfig = readJson<MainRpOpenRouterRouteConfig>(
    MAIN_RP_SUPPLY_ROUTE_CONFIG_PATH
  );

  const planning = planMainRpSupplyAutoDrafts({
    packet,
    radar,
    routeConfig,
  });
  const dryRun = process.env.MAIN_RP_SUPPLY_AUTO_DRAFT_DRY_RUN === "1";
  const results: DraftResult[] = [];
  let mainSha = process.env.GITHUB_SHA?.trim() || "local";

  if (planning.plans.length > 0) {
    if (dryRun) {
      for (const plan of planning.plans) {
        runValidation(plan);
        results.push({
          modelId: plan.modelId,
          candidateProviderSlug: plan.candidateProviderSlug,
          branchName: plan.branchName,
          pullRequestNumber: null,
          pullRequestUrl: null,
          status: "VALIDATED_DRY_RUN",
          reason: null,
        });
      }
    } else {
      const context = githubContext();
      mainSha = context.sha;
      const currentMainSha = await mainHeadSha(context);
      if (currentMainSha !== context.sha) {
        for (const plan of planning.plans) {
          results.push({
            modelId: plan.modelId,
            candidateProviderSlug: plan.candidateProviderSlug,
            branchName: null,
            pullRequestNumber: null,
            pullRequestUrl: null,
            status: "STOP_MAIN_MOVED",
            reason: `workflow_sha=${context.sha} current_main=${currentMainSha}`,
          });
        }
      } else {
        for (const plan of planning.plans) {
          results.push(await createDraftPr({ context, plan }));
        }
      }
    }
  }

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mainSha,
    dryRun,
    plans: planning.plans.map((plan) => ({
      modelId: plan.modelId,
      openRouterSlug: plan.openRouterSlug,
      candidateProviderSlug: plan.candidateProviderSlug,
      branchName: plan.branchName,
      currentRoute: plan.currentRoute,
      proposedRoute: plan.proposedRoute,
    })),
    skipped: planning.skipped,
    results,
    draftPrCreatedCount: results.filter(
      (row) => row.status === "CREATED_DRAFT_PR"
    ).length,
    automaticMergeEligibleCount: 0,
    productionMainRouteMutations: 0,
  };
  writeFileSync(
    join(OUT_DIR, "auto-draft-results.json"),
    JSON.stringify(output, null, 2),
    "utf8"
  );
  writeFileSync(
    join(OUT_DIR, "AUTO-DRAFT-RESULTS.md"),
    renderResults({
      results,
      skipped: planning.skipped,
      dryRun,
      mainSha,
    }),
    "utf8"
  );

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
