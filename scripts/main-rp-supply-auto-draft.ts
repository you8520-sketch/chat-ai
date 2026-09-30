import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveMainRpOpenRouterRoutePolicy,
  resolveRpOpenRouterModelId,
} from "@/lib/openRouterConfig";
import type {
  MainRpSupplyPromotionProposalPacket,
  SupplyPromotionProposal,
} from "./lib/mainRpSupplyPromotionProposal";
import {
  MAIN_RP_SUPPLY_AUTO_DRAFT_MAX_PER_RUN,
  autoDraftMarker,
  patchMainRpOpenRouterProvider,
  safeBranchComponent,
  validateProviderSlug,
} from "./lib/mainRpSupplyAutoDraft";

const OUT_DIR =
  process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() ||
  "artifacts/main-rp-supply-radar";
const PROPOSAL_PATH = join(OUT_DIR, "promotion-proposals.json");
const ROUTE_OWNER_PATH = "src/lib/openRouterConfig.ts";

type DraftResult = {
  modelId: string;
  candidateProviderSlug: string;
  status:
    | "CREATED"
    | "SKIPPED_NO_CHANGE"
    | "SKIPPED_EXISTING_DRAFT"
    | "SKIPPED_NOT_ELIGIBLE"
    | "FAILED";
  draftPrUrl: string | null;
  branch: string | null;
  reason: string | null;
};

function run(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {}
): string {
  return execFileSync(command, args, {
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function readPacket(): MainRpSupplyPromotionProposalPacket {
  if (!existsSync(PROPOSAL_PATH)) {
    throw new Error("Missing promotion proposal packet: " + PROPOSAL_PATH);
  }
  return JSON.parse(
    readFileSync(PROPOSAL_PATH, "utf8")
  ) as MainRpSupplyPromotionProposalPacket;
}

function isEligible(proposal: SupplyPromotionProposal): boolean {
  return (
    proposal.draftRoutePrEligible === true &&
    proposal.automaticMergeEligible === false &&
    proposal.transitionKind === "SAME_OPENROUTER_TRANSPORT" &&
    proposal.currentProcurementProvider === "openrouter" &&
    proposal.stopReason == null
  );
}

function openPullRequests(repo: string, token: string): Array<{
  number: number;
  url: string;
  body: string;
  headRefName: string;
}> {
  const raw = run(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,url,body,headRefName",
    ],
    { env: { ...process.env, GH_TOKEN: token } }
  );
  return JSON.parse(raw) as Array<{
    number: number;
    url: string;
    body: string;
    headRefName: string;
  }>;
}

function n(value: number | null, digits = 2): string {
  return value == null ? "n/a" : value.toFixed(digits);
}

function draftBody(input: {
  proposal: SupplyPromotionProposal;
  currentProviderSlug: string;
  branch: string;
  marker: string;
}): string {
  const e = input.proposal.evidence;
  return [
    input.marker,
    "## Automated Main RP supplier promotion — Draft only",
    "",
    "This Draft PR was created by the existing Main RP Supply Radar after the durable promotion gate passed.",
    "",
    "### Exact route change",
    "- model: " + input.proposal.modelId,
    "- current OpenRouter provider pin: " + input.currentProviderSlug,
    "- candidate OpenRouter provider pin: " + input.proposal.candidateProviderSlug,
    "- transport: OpenRouter → OpenRouter",
    "- service tier: flex preserved",
    "- provider fallback: remains disabled",
    "- required-parameter enforcement: remains enabled",
    "",
    "No model-registry, user-price, billing, or procurement-provider family change is included.",
    "",
    "### Durable evidence",
    "- qualifying market snapshots: " + e.qualifyingMarketSnapshots,
    "- market observation span: " + n(e.marketObservationSpanDays, 1) + " days",
    "- complete canonical two-turn RP pairs: " + e.completeLivePairs,
    "- live observation span: " + n(e.liveObservationSpanDays, 1) + " days",
    "- latest representative raw-rate saving: " + n(e.latestSavingsPercent, 1) + "%",
    "- worst total-time ratio vs current baseline: " +
      n(e.worstCandidateTotalVsBaselineRatio, 3),
    "- worst TTFT ratio vs current baseline: " +
      n(e.worstCandidateTtftVsBaselineRatio, 3),
    "",
    "### Generated-branch proof",
    "Before this Draft was pushed, the automation ran on the modified branch:",
    "- git diff --check",
    "- npm run typecheck:app",
    "- Main RP provider/model-registry regressions",
    "- OpenRouter request regressions",
    "- supply live-qualification regressions",
    "- promotion proposal and auto-Draft patch regressions",
    "- explicit runtime assertion for candidate provider + Flex/no-fallback invariants",
    "",
    "### Rollback",
    "Restore providerSlug in " + ROUTE_OWNER_PATH + " from " +
      input.proposal.candidateProviderSlug + " to " + input.currentProviderSlug +
      ", or revert the single route-change commit.",
    "",
    "### Safety boundary",
    "- Draft only",
    "- automatic merge: disabled",
    "- production main is unchanged until this PR is explicitly merged",
    "- cross-provider procurement changes are not eligible for this automation",
    "",
    "Automation branch: " + input.branch,
    "",
  ].join("\n");
}

function validateModifiedRoute(input: {
  modelId: string;
  candidateProviderSlug: string;
}): void {
  run(
    "node",
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/main-rp-supply-route-assert.ts",
    ],
    {
      env: {
        ...process.env,
        MAIN_RP_SUPPLY_ASSERT_MODEL_ID: input.modelId,
        MAIN_RP_SUPPLY_ASSERT_PROVIDER_SLUG: input.candidateProviderSlug,
      },
    }
  );
}

function validateModifiedBranch(input: {
  modelId: string;
  candidateProviderSlug: string;
}): void {
  run("git", ["diff", "--check"]);
  run("npm", ["run", "typecheck:app"]);
  run("node", [
    "--conditions=react-server",
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "src/lib/chatModels.gemini.test.ts",
    "src/lib/mainRpModelRegistry.test.ts",
    "src/lib/openRouterClient.test.ts",
    "scripts/lib/mainRpSupplyLiveQualification.test.ts",
    "scripts/lib/mainRpSupplyPromotionProposal.test.ts",
    "scripts/lib/mainRpSupplyAutoDraft.test.ts",
  ]);
  validateModifiedRoute(input);
}

function writeReport(results: DraftResult[], dryRun: boolean): void {
  const payload = {
    generatedAt: new Date().toISOString(),
    dryRun,
    productionRouteMutations: 0,
    automaticMerges: 0,
    createdDrafts: results.filter((row) => row.status === "CREATED").length,
    results,
  };
  writeFileSync(
    join(OUT_DIR, "auto-draft-results.json"),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
  const lines = [
    "# Main RP Supply Auto Draft",
    "",
    "- dry run: **" + String(dryRun) + "**",
    "- Draft PRs created: **" + payload.createdDrafts + "**",
    "- production route mutations: **0**",
    "- automatic merges: **0**",
    "",
    "| Model | Candidate | Status | Draft PR | Reason |",
    "|---|---|---|---|---|",
  ];
  for (const row of results) {
    lines.push(
      "| " + row.modelId + " | " + row.candidateProviderSlug + " | " +
        row.status + " | " + (row.draftPrUrl ?? "—") + " | " +
        (row.reason ?? "—") + " |"
    );
  }
  if (!results.length) {
    lines.push("| — | — | no eligible promotion proposals | — | — |");
  }
  lines.push("");
  writeFileSync(join(OUT_DIR, "AUTO-DRAFT.md"), lines.join("\n"), "utf8");
}

function main(): void {
  const packet = readPacket();
  const results: DraftResult[] = [];
  const dryRun = process.env.MAIN_RP_SUPPLY_AUTO_DRAFT_DRY_RUN === "1";
  const eventName = process.env.GITHUB_EVENT_NAME?.trim() ?? "";
  const refName = process.env.GITHUB_REF_NAME?.trim() ?? "";
  const repo = process.env.GITHUB_REPOSITORY?.trim() ?? "";
  const token = process.env.GITHUB_TOKEN?.trim() ?? "";
  const runId = process.env.GITHUB_RUN_ID?.trim() || String(Date.now());

  if (!dryRun) {
    if (!["schedule", "workflow_dispatch"].includes(eventName)) {
      throw new Error("Auto Draft is not allowed for event " + (eventName || "unknown"));
    }
    if (refName !== "main") {
      throw new Error("Auto Draft requires main ref, got " + (refName || "unknown"));
    }
    if (!repo || !token) {
      throw new Error("Auto Draft requires GITHUB_REPOSITORY and GITHUB_TOKEN");
    }
  }

  const eligible = packet.proposals
    .filter(isEligible)
    .slice(0, MAIN_RP_SUPPLY_AUTO_DRAFT_MAX_PER_RUN);

  if (!eligible.length) {
    writeReport(results, dryRun);
    console.log(JSON.stringify({
      eligible: 0,
      created: 0,
      production_route_mutations: 0,
      automatic_merges: 0,
    }));
    return;
  }

  const baseSha = run("git", ["rev-parse", "HEAD"]);
  const originalSource = readFileSync(ROUTE_OWNER_PATH, "utf8");
  const openPrs = dryRun ? [] : openPullRequests(repo, token);
  let failed = false;

  run("git", ["config", "user.name", "hav-supply-radar[bot]"]);
  run("git", ["config", "user.email", "hav-supply-radar[bot]@users.noreply.github.com"]);

  for (const proposal of eligible) {
    const candidateProviderSlug = validateProviderSlug(proposal.candidateProviderSlug);
    const marker = autoDraftMarker(proposal.modelId, candidateProviderSlug);
    const existing = openPrs.find((pr) => pr.body?.includes(marker));
    if (existing) {
      results.push({
        modelId: proposal.modelId,
        candidateProviderSlug,
        status: "SKIPPED_EXISTING_DRAFT",
        draftPrUrl: existing.url,
        branch: existing.headRefName,
        reason: "matching_open_draft_already_exists",
      });
      continue;
    }

    const currentPolicy = resolveMainRpOpenRouterRoutePolicy(proposal.modelId);
    if (
      !currentPolicy ||
      currentPolicy.provider.only.length !== 1 ||
      currentPolicy.serviceTier !== "flex" ||
      currentPolicy.provider.allow_fallbacks !== false ||
      currentPolicy.provider.require_parameters !== true
    ) {
      results.push({
        modelId: proposal.modelId,
        candidateProviderSlug,
        status: "SKIPPED_NOT_ELIGIBLE",
        draftPrUrl: null,
        branch: null,
        reason: "current_openrouter_route_invariant_mismatch",
      });
      failed = true;
      continue;
    }

    const currentProviderSlug = validateProviderSlug(currentPolicy.provider.only[0]!);
    const openRouterModelId = resolveRpOpenRouterModelId(proposal.modelId);
    const branchName = [
      "automation/main-rp-supply",
      safeBranchComponent(proposal.modelId),
      safeBranchComponent(candidateProviderSlug),
      safeBranchComponent(runId),
    ].join("-");

    try {
      const patched = patchMainRpOpenRouterProvider({
        source: originalSource,
        openRouterModelId,
        expectedCurrentProviderSlug: currentProviderSlug,
        candidateProviderSlug,
      });
      if (!patched.changed) {
        results.push({
          modelId: proposal.modelId,
          candidateProviderSlug,
          status: "SKIPPED_NO_CHANGE",
          draftPrUrl: null,
          branch: null,
          reason: "candidate_is_already_current_route",
        });
        continue;
      }

      run("git", ["checkout", "--detach", baseSha]);
      run("git", ["checkout", "-B", branchName, baseSha]);
      writeFileSync(ROUTE_OWNER_PATH, patched.source, "utf8");
      validateModifiedBranch({
        modelId: proposal.modelId,
        candidateProviderSlug,
      });

      if (dryRun) {
        results.push({
          modelId: proposal.modelId,
          candidateProviderSlug,
          status: "CREATED",
          draftPrUrl: "DRY_RUN",
          branch: branchName,
          reason: "validated_without_push",
        });
        continue;
      }

      run("git", ["add", ROUTE_OWNER_PATH]);
      run("git", [
        "commit",
        "-m",
        "route(main-rp): promote " + proposal.modelId + " to " +
          candidateProviderSlug,
      ]);
      run("git", ["push", "origin", "HEAD:refs/heads/" + branchName]);

      const body = draftBody({
        proposal,
        currentProviderSlug,
        branch: branchName,
        marker,
      });
      const title =
        "draft: promote " + proposal.modelId +
        " OpenRouter provider to " + candidateProviderSlug;
      const url = run(
        "gh",
        [
          "pr",
          "create",
          "--repo",
          repo,
          "--base",
          "main",
          "--head",
          branchName,
          "--draft",
          "--title",
          title,
          "--body",
          body,
        ],
        { env: { ...process.env, GH_TOKEN: token } }
      );

      results.push({
        modelId: proposal.modelId,
        candidateProviderSlug,
        status: "CREATED",
        draftPrUrl: url,
        branch: branchName,
        reason: null,
      });
    } catch (error) {
      failed = true;
      results.push({
        modelId: proposal.modelId,
        candidateProviderSlug,
        status: "FAILED",
        draftPrUrl: null,
        branch: branchName,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      try {
        run("git", ["checkout", "--detach", baseSha]);
        writeFileSync(ROUTE_OWNER_PATH, originalSource, "utf8");
      } catch {
        failed = true;
      }
    }
  }

  writeReport(results, dryRun);
  console.log(JSON.stringify({
    eligible: eligible.length,
    created: results.filter((row) => row.status === "CREATED").length,
    failed: results.filter((row) => row.status === "FAILED").length,
    production_route_mutations: 0,
    automatic_merges: 0,
  }, null, 2));

  if (failed) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
