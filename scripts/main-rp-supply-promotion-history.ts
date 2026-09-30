import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MainRpSupplyRadarReport } from "./lib/mainRpSupplyRadar";
import type { MainRpSupplyLiveQualificationReport } from "./lib/mainRpSupplyLiveQualification";
import type { SupplyTransportComparisonReport } from "./lib/mainRpSupplyCurrentBaseline";
import {
  MAIN_RP_SUPPLY_PROMOTION_MAX_HISTORY_SNAPSHOTS,
  evaluateMainRpSupplyPromotionHistory,
  renderMainRpSupplyPromotionHistoryMarkdown,
  type SupplyHistorySnapshot,
} from "./lib/mainRpSupplyPromotionHistory";

const OUT_DIR =
  process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() ||
  "artifacts/main-rp-supply-radar";
const WORKFLOW_FILE = "main-rp-supply-radar.yml";
const API = "https://api.github.com";

type JsonObject = Record<string, unknown>;

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function currentSnapshot(): SupplyHistorySnapshot | null {
  const report = readJsonIfExists<MainRpSupplyRadarReport>(
    join(OUT_DIR, "report.json")
  );
  if (!report) return null;
  return {
    runId: process.env.GITHUB_RUN_ID?.trim() || "current-local",
    report,
    live: readJsonIfExists<MainRpSupplyLiveQualificationReport>(
      join(OUT_DIR, "live", "live-qualification.json")
    ),
    comparison: readJsonIfExists<SupplyTransportComparisonReport>(
      join(OUT_DIR, "live", "comparison.json")
    ),
  };
}

function githubContext(): { repo: string; token: string } | null {
  const repo = process.env.GITHUB_REPOSITORY?.trim();
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!repo || !token) return null;
  return { repo, token };
}

async function githubJson(
  context: { repo: string; token: string },
  path: string
): Promise<JsonObject> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${context.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PlayAI-SupplyPromotionHistory/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
  return (await response.json()) as JsonObject;
}

async function downloadArtifactZip(input: {
  context: { repo: string; token: string };
  artifactId: number;
  target: string;
}): Promise<void> {
  const response = await fetch(
    `${API}/repos/${input.context.repo}/actions/artifacts/${input.artifactId}/zip`,
    {
      headers: {
        Authorization: `Bearer ${input.context.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "PlayAI-SupplyPromotionHistory/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `GitHub artifact download ${response.status} for ${input.artifactId}`
    );
  }
  writeFileSync(input.target, Buffer.from(await response.arrayBuffer()));
}

function unzipJson<T>(zipPath: string, entry: string): T | null {
  try {
    const text = execFileSync("unzip", ["-p", zipPath, entry], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function historicalSnapshots(
  context: { repo: string; token: string }
): Promise<SupplyHistorySnapshot[]> {
  const workflow = encodeURIComponent(WORKFLOW_FILE);
  const runsPayload = await githubJson(
    context,
    `/repos/${context.repo}/actions/workflows/${workflow}/runs?branch=main&status=success&per_page=50`
  );
  const runs = Array.isArray(runsPayload.workflow_runs)
    ? (runsPayload.workflow_runs as JsonObject[])
    : [];
  const currentRunId = process.env.GITHUB_RUN_ID?.trim() ?? "";
  const priorRuns = runs
    .filter((run) => String(run.id ?? "") !== currentRunId)
    .filter(
      (run) =>
        run.event === "schedule" ||
        run.event === "workflow_dispatch"
    )
    .slice(0, MAIN_RP_SUPPLY_PROMOTION_MAX_HISTORY_SNAPSHOTS - 1);

  const tempDir = mkdtempSync(join(tmpdir(), "supply-history-"));
  const snapshots: SupplyHistorySnapshot[] = [];
  try {
    for (const run of priorRuns) {
      const runId = Number(run.id);
      if (!Number.isFinite(runId)) continue;
      let artifactsPayload: JsonObject;
      try {
        artifactsPayload = await githubJson(
          context,
          `/repos/${context.repo}/actions/runs/${runId}/artifacts?per_page=100`
        );
      } catch {
        continue;
      }
      const artifacts = Array.isArray(artifactsPayload.artifacts)
        ? (artifactsPayload.artifacts as JsonObject[])
        : [];
      const artifact = artifacts.find(
        (row) =>
          row.expired !== true &&
          row.name === `main-rp-supply-radar-${runId}`
      );
      const artifactId = Number(artifact?.id);
      if (!Number.isFinite(artifactId)) continue;

      const zipPath = join(tempDir, `${runId}.zip`);
      try {
        await downloadArtifactZip({
          context,
          artifactId,
          target: zipPath,
        });
      } catch {
        continue;
      }

      const report = unzipJson<MainRpSupplyRadarReport>(zipPath, "report.json");
      if (!report) continue;
      snapshots.push({
        runId: String(runId),
        report,
        live: unzipJson<MainRpSupplyLiveQualificationReport>(
          zipPath,
          "live/live-qualification.json"
        ),
        comparison: unzipJson<SupplyTransportComparisonReport>(
          zipPath,
          "live/comparison.json"
        ),
      });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return snapshots;
}

async function main(): Promise<void> {
  const snapshots: SupplyHistorySnapshot[] = [];
  const current = currentSnapshot();
  if (current) snapshots.push(current);

  const context = githubContext();
  let historySource = "current_artifact_only";
  let historyError: string | null = null;
  if (context) {
    try {
      snapshots.push(...(await historicalSnapshots(context)));
      historySource = "github_actions_artifacts";
    } catch (error) {
      historyError = error instanceof Error ? error.message : String(error);
    }
  } else {
    historyError = "missing_GITHUB_REPOSITORY_or_GITHUB_TOKEN";
  }

  const deduped = [
    ...new Map(snapshots.map((snapshot) => [snapshot.runId, snapshot])).values(),
  ];
  const report = evaluateMainRpSupplyPromotionHistory({ snapshots: deduped });
  writeFileSync(
    join(OUT_DIR, "promotion-history.json"),
    JSON.stringify(
      {
        ...report,
        historySource,
        historyError,
        providerGenerationCalls: 0,
      },
      null,
      2
    ),
    "utf8"
  );
  writeFileSync(
    join(OUT_DIR, "PROMOTION-HISTORY.md"),
    renderMainRpSupplyPromotionHistoryMarkdown(report) +
      `\n## History source\n\n- source: ${historySource}\n- error: ${historyError ?? "none"}\n- provider generation calls: **0**\n`,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        snapshots_examined: report.snapshotsExamined,
        candidates: report.candidates.length,
        promotion_ready: report.promotionReadyCount,
        history_source: historySource,
        provider_generation_calls: 0,
        output: join(OUT_DIR, "promotion-history.json"),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
