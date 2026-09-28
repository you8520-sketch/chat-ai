import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MainRpSupplyRadarReport } from "./lib/mainRpSupplyRadar";
import {
  buildSupplyLiveReport,
  renderSupplyLiveReportMarkdown,
  runOpenRouterSupplyCandidatePair,
  selectMainRpSupplyLiveCandidates,
  type SupplyLiveCandidateResult,
} from "./lib/mainRpSupplyLiveQualification";
import {
  resolveOptInOpenRouterSupplyBenchmarkApiKey,
  sanitizeSupplyBenchmarkCredentialText,
} from "./lib/mainRpSupplyLiveQualificationCredential";

const RADAR_DIR =
  process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() ||
  "artifacts/main-rp-supply-radar";
const RADAR_REPORT =
  process.env.MAIN_RP_SUPPLY_RADAR_REPORT?.trim() ||
  join(RADAR_DIR, "report.json");
const LIVE_DIR =
  process.env.MAIN_RP_SUPPLY_LIVE_OUTPUT_DIR?.trim() ||
  join(RADAR_DIR, "live");

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function writeArtifacts(input: {
  report: ReturnType<typeof buildSupplyLiveReport>;
  errors: string[];
}): void {
  mkdirSync(LIVE_DIR, { recursive: true });
  writeFileSync(
    join(LIVE_DIR, "live-qualification.json"),
    JSON.stringify({ ...input.report, errors: input.errors }, null, 2),
    "utf8"
  );
  writeFileSync(
    join(LIVE_DIR, "LIVE-QUALIFICATION.md"),
    renderSupplyLiveReportMarkdown(input.report) +
      (input.errors.length
        ? "\n## Runner notes\n\n" +
          input.errors.map((error) => `- ${error}`).join("\n") +
          "\n"
        : ""),
    "utf8"
  );

  for (const result of input.report.results) {
    const dir = join(
      LIVE_DIR,
      safePart(result.candidate.modelId),
      safePart(result.candidate.providerSlug)
    );
    mkdirSync(dir, { recursive: true });
    for (const turn of result.turns) {
      writeFileSync(
        join(dir, `turn-${turn.turn}.txt`),
        turn.text,
        "utf8"
      );
      const { text: _text, ...meta } = turn;
      writeFileSync(
        join(dir, `turn-${turn.turn}-meta.json`),
        JSON.stringify(meta, null, 2),
        "utf8"
      );
    }
  }
}

async function main(): Promise<void> {
  const radar = JSON.parse(readFileSync(RADAR_REPORT, "utf8")) as MainRpSupplyRadarReport;
  const selection = selectMainRpSupplyLiveCandidates(radar);
  const credential = resolveOptInOpenRouterSupplyBenchmarkApiKey();
  const errors: string[] = [];

  if (!credential.ok) {
    const report = buildSupplyLiveReport({
      selection,
      results: [],
      notRunReason: credential.reason,
    });
    writeArtifacts({ report, errors });
    console.log(
      JSON.stringify(
        {
          status: report.status,
          provider_generation_calls: report.providerGenerationCalls,
          selected_candidates: selection.candidates.length,
          reason: credential.reason,
        },
        null,
        2
      )
    );
    return;
  }

  const results: SupplyLiveCandidateResult[] = [];
  const runId =
    process.env.GITHUB_RUN_ID?.trim() ||
    `manual-${new Date().toISOString().slice(0, 16)}`;

  for (const candidate of selection.candidates) {
    try {
      const sessionId = [
        "supply-live",
        runId,
        safePart(candidate.modelId),
        safePart(candidate.providerSlug),
      ]
        .join("-")
        .slice(0, 256);
      const result = await runOpenRouterSupplyCandidatePair({
        apiKey: credential.apiKey,
        candidate,
        sessionId,
      });
      results.push(result);
    } catch (error) {
      errors.push(
        `${candidate.modelId}/${candidate.providerName}: ${sanitizeSupplyBenchmarkCredentialText(
          error instanceof Error ? error.stack ?? error.message : String(error)
        )}`
      );
    }
  }

  const report = buildSupplyLiveReport({
    selection,
    results,
  });
  writeArtifacts({ report, errors });

  console.log(
    JSON.stringify(
      {
        status: report.status,
        provider_generation_calls: report.providerGenerationCalls,
        max_provider_generation_calls: report.maxProviderGenerationCalls,
        selected_candidates: selection.candidates.length,
        completed_pairs: results.filter((result) => result.livePairComplete).length,
        second_turn_cache_hits: results.filter(
          (result) => result.secondTurnCacheReadObserved
        ).length,
        errors,
        output_dir: LIVE_DIR,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    sanitizeSupplyBenchmarkCredentialText(
      error instanceof Error ? error.stack ?? error.message : String(error)
    )
  );
  console.log("provider_generation_calls=0");
  process.exitCode = 1;
});
