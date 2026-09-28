import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveOptInTestCheaperInferenceApiKey,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";
import {
  RP_ACTIVE_MODEL_QUALITY_LIVE_FLAG,
  RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
  RP_ACTIVE_MODEL_QUALITY_MAX_CALLS,
  renderRpActiveModelQualityMarkdown,
  runRpActiveModelQualityLive,
} from "./lib/rpActiveModelQualityLive";

const OUTPUT_DIR =
  process.env.RP_ACTIVE_MODEL_QUALITY_OUTPUT_DIR?.trim() ||
  "artifacts/rp-active-model-quality";

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function writeNotRun(reason: string): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const report = {
    status: "NOT_RUN",
    reason,
    providerCalls: 0,
    maxProviderCalls: RP_ACTIVE_MODEL_QUALITY_MAX_CALLS,
    modelIds: RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
  };
  writeFileSync(
    join(OUTPUT_DIR, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  writeFileSync(
    join(OUTPUT_DIR, "REPORT.md"),
    [
      "# Active Main RP — Human Quality Review Evidence",
      "",
      "- status: **NOT_RUN**",
      `- reason: ${reason}`,
      "- provider calls: **0**",
      "",
    ].join("\n"),
    "utf8"
  );
}

async function main(): Promise<void> {
  const apiKey = resolveOptInTestCheaperInferenceApiKey(
    RP_ACTIVE_MODEL_QUALITY_LIVE_FLAG
  );
  if (!apiKey) {
    writeNotRun("missing_explicit_live_opt_in_or_benchmark_credential");
    console.log("NOT_RUN — provider calls=0");
    return;
  }

  const runId =
    process.env.GITHUB_RUN_ID?.trim() ||
    `manual-${new Date().toISOString().slice(0, 16)}`;
  const report = await runRpActiveModelQualityLive({ apiKey, runId });

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    join(OUTPUT_DIR, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  writeFileSync(
    join(OUTPUT_DIR, "REPORT.md"),
    renderRpActiveModelQualityMarkdown(report),
    "utf8"
  );

  for (const result of report.results) {
    const dir = join(OUTPUT_DIR, safePart(result.modelId));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${safePart(result.caseId)}.txt`),
      result.text,
      "utf8"
    );
    const { text: _text, ...meta } = result;
    writeFileSync(
      join(dir, `${safePart(result.caseId)}.json`),
      JSON.stringify(meta, null, 2),
      "utf8"
    );
  }

  console.log(
    JSON.stringify(
      {
        status: report.results.every((row) => row.status === "COMPLETE")
          ? "COMPLETE"
          : "PARTIAL",
        providerCalls: report.providerCalls,
        maxProviderCalls: report.maxProviderCalls,
        models: report.modelIds,
        completed: report.results.filter((row) => row.status === "COMPLETE").length,
        failed: report.results.filter((row) => row.status === "FAILED").length,
        outputDir: OUTPUT_DIR,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    sanitizeBenchmarkCredentialText(
      error instanceof Error ? error.stack ?? error.message : String(error)
    )
  );
  process.exitCode = 1;
});
