import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { MainRpSupplyPromotionProposalPacket } from "./lib/mainRpSupplyPromotionProposal";
import {
  buildMainRpSupplyAutoDraftPlan,
  executeGitHubDraftRoutePr,
  MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH,
  renderMainRpSupplyAutoDraftMarkdown,
  type GitHubDraftExecutionResult,
  type MainRpOpenRouterRouteRegistry,
  type SupplyAutoDraftMutation,
} from "./lib/mainRpSupplyAutoDraft";

const OUT_DIR =
  process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() ||
  "artifacts/main-rp-supply-radar";
const PROPOSAL_PATH = join(OUT_DIR, "promotion-proposals.json");
const AUTO_DRAFT_DIR = join(OUT_DIR, "auto-draft");
const BASE_BRANCH = "main";

function boolEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`Missing required input: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function runPreflight(mutation: SupplyAutoDraftMutation): {
  ok: boolean;
  error: string | null;
} {
  const original = readFileSync(MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH, "utf8");
  try {
    writeFileSync(
      MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH,
      JSON.stringify(mutation.updatedRegistry, null, 2) + "\n",
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
        "src/lib/chatModels.gemini.test.ts",
        "src/lib/mainRpModelRegistry.test.ts",
        "src/lib/openRouterClient.test.ts",
        "scripts/lib/mainRpSupplyPromotionProposal.test.ts",
        "scripts/lib/mainRpSupplyAutoDraft.test.ts",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
          MAIN_RP_SUPPLY_LIVE_QUALIFICATION: "0",
          OPENROUTER_API_KEY: "",
          CHEAPER_INFERENCE_API_KEY: "",
          OPENAI_API_KEY: "",
        },
      }
    );
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    writeFileSync(MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH, original, "utf8");
  }
}

async function main(): Promise<void> {
  const packet = readJson<MainRpSupplyPromotionProposalPacket>(PROPOSAL_PATH);
  const routeRegistry = readJson<MainRpOpenRouterRouteRegistry>(
    MAIN_RP_OPENROUTER_ROUTE_REGISTRY_PATH
  );
  const runId = process.env.GITHUB_RUN_ID?.trim() || "local";
  const eventName = process.env.GITHUB_EVENT_NAME?.trim() || "local";
  const refName = process.env.GITHUB_REF_NAME?.trim() || "";
  const requestedDryRun = boolEnv("MAIN_RP_SUPPLY_AUTO_DRAFT_DRY_RUN");
  const writeEventAllowed =
    eventName === "schedule" || eventName === "workflow_dispatch";
  const onMain = refName === BASE_BRANCH;
  const dryRun = requestedDryRun || !writeEventAllowed || !onMain;

  const plan = buildMainRpSupplyAutoDraftPlan({
    packet,
    routeRegistry,
    runId,
  });

  const executions: GitHubDraftExecutionResult[] = [];
  const repo = process.env.GITHUB_REPOSITORY?.trim() || "";
  const token = process.env.GITHUB_TOKEN?.trim() || "";
  const baseSha = process.env.GITHUB_SHA?.trim() || "";

  for (const mutation of plan.mutations) {
    if (!dryRun) {
      const preflight = runPreflight(mutation);
      if (!preflight.ok) {
        executions.push({
          modelId: mutation.modelId,
          candidateProviderSlug: mutation.candidateProviderSlug,
          status: "PREFLIGHT_FAILED",
          pullRequestUrl: null,
          branchName: mutation.branchName,
          error: preflight.error,
        });
        continue;
      }
    }

    if (!repo || !token || !baseSha) {
      if (dryRun) {
        executions.push(
          await executeGitHubDraftRoutePr({
            repo: repo || "dry-run/repo",
            token: token || "dry-run-token",
            baseSha: baseSha || "dry-run-sha",
            baseBranch: BASE_BRANCH,
            mutation,
            dryRun: true,
          })
        );
        continue;
      }
      executions.push({
        modelId: mutation.modelId,
        candidateProviderSlug: mutation.candidateProviderSlug,
        status: "FAILED",
        pullRequestUrl: null,
        branchName: mutation.branchName,
        error: "missing_GITHUB_REPOSITORY_or_GITHUB_TOKEN_or_GITHUB_SHA",
      });
      continue;
    }

    executions.push(
      await executeGitHubDraftRoutePr({
        repo,
        token,
        baseSha,
        baseBranch: BASE_BRANCH,
        mutation,
        dryRun,
      })
    );
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    eventName,
    refName,
    requestedDryRun,
    effectiveDryRun: dryRun,
    writeEventAllowed,
    onMain,
    automaticMergeEligibleCount: 0,
    plan,
    executions,
  };

  if (!existsSync(AUTO_DRAFT_DIR)) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(AUTO_DRAFT_DIR, { recursive: true });
  }
  writeJson(join(AUTO_DRAFT_DIR, "auto-draft.json"), report);
  writeFileSync(
    join(AUTO_DRAFT_DIR, "AUTO-DRAFT.md"),
    renderMainRpSupplyAutoDraftMarkdown({
      plan,
      executions,
      dryRun,
    }),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        planned: plan.mutations.length,
        decisions: plan.decisions.length,
        created: executions.filter((row) => row.status === "CREATED").length,
        existing_open_pr: executions.filter(
          (row) => row.status === "EXISTING_OPEN_PR"
        ).length,
        preflight_failed: executions.filter(
          (row) => row.status === "PREFLIGHT_FAILED"
        ).length,
        failed: executions.filter((row) => row.status === "FAILED").length,
        stale_main_stop: executions.filter(
          (row) => row.status === "STALE_MAIN_STOP"
        ).length,
        effective_dry_run: dryRun,
        automatic_merge_eligible: 0,
      },
      null,
      2
    )
  );

  if (
    executions.some(
      (row) => row.status === "FAILED" || row.status === "PREFLIGHT_FAILED"
    )
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
