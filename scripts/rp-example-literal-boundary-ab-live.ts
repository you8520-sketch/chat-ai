import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveOptInTestCheaperInferenceApiKey,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";
import { RP_ACTIVE_MODEL_QUALITY_LIVE_FLAG } from "./lib/rpActiveModelQualityLive";
import {
  RP_EXAMPLE_LITERAL_AB_MAX_CALLS,
  renderRpExampleLiteralBoundaryAbMarkdown,
  runRpExampleLiteralBoundaryAb,
} from "./lib/rpExampleLiteralBoundaryAb";

const OUTPUT_DIR =
  process.env.RP_EXAMPLE_LITERAL_AB_OUTPUT_DIR?.trim() ||
  "artifacts/rp-example-literal-boundary-ab";

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

async function main(): Promise<void> {
  const ciKey = resolveOptInTestCheaperInferenceApiKey(
    RP_ACTIVE_MODEL_QUALITY_LIVE_FLAG
  );
  const globalOptIn = process.env.REGULAR_TEST_REAL_PROVIDER_CALLS?.trim() === "1";
  const qualityOptIn = process.env[RP_ACTIVE_MODEL_QUALITY_LIVE_FLAG]?.trim() === "1";
  const openRouterKey =
    globalOptIn && qualityOptIn
      ? process.env.OPENROUTER_SUPPLY_BENCHMARK_API_KEY?.trim() || null
      : null;

  if (!ciKey || !openRouterKey) {
    throw new Error("missing_explicit_live_opt_in_or_required_benchmark_credential");
  }

  const report = await runRpExampleLiteralBoundaryAb({
    credentials: {
      cheaperinference: ciKey,
      openrouter: openRouterKey,
    },
    runId: process.env.GITHUB_RUN_ID?.trim() || "manual",
  });

  if (report.providerCalls > RP_EXAMPLE_LITERAL_AB_MAX_CALLS) {
    throw new Error("provider_call_budget_exceeded");
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(
    join(OUTPUT_DIR, "REPORT.md"),
    renderRpExampleLiteralBoundaryAbMarkdown(report),
    "utf8"
  );

  for (const row of report.rows) {
    const dir = join(OUTPUT_DIR, safePart(row.modelId), row.arm);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, \`\${row.caseId}.txt\`), row.text, "utf8");
    const { text: _text, ...meta } = row;
    writeFileSync(join(dir, \`\${row.caseId}.json\`), JSON.stringify(meta, null, 2), "utf8");
  }

  console.log(
    JSON.stringify(
      {
        status: report.rows.every((row) => row.status === "COMPLETE")
          ? "COMPLETE"
          : "PARTIAL",
        providerCalls: report.providerCalls,
        maxProviderCalls: report.maxProviderCalls,
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
