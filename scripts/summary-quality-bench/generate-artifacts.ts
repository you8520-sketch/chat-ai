/**
 * Generate human/GPT review artifacts from frozen fixtures + raw benchmark results.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "docs/audits/4-model-korean-summary-quality");

type FrozenFixture = {
  fixture_id: string;
  tags: string[];
  production_style: {
    dialogue: string;
    system_prompt: string;
    user_prompt: string;
  };
  approximate_input_tokens_estimated: number;
  source_hash_sha256: string;
};

type BenchResult = {
  fixture_id: string;
  model_label: string;
  requested_model_id: string;
  status: "ok" | "CALL_FAILED";
  parsed_output_text: string | null;
  provider_message: string | null;
  error_type: string | null;
  http_status: number | null;
  total_latency_ms: number;
  reported_model_id: string;
  provider: string;
  finish_reason: string;
  input_tokens: number | string;
  output_tokens: number | string;
};

function loadJsonl(path: string): BenchResult[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BenchResult);
}

function formatOutput(result: BenchResult | undefined): string {
  if (!result) return "CALL_FAILED\n\n(no result row)";
  if (result.status !== "ok" || !result.parsed_output_text) {
    return [
      "CALL_FAILED",
      "",
      `status: ${result.status}`,
      `error_type: ${result.error_type ?? "NOT_AVAILABLE"}`,
      `http_status: ${result.http_status ?? "NOT_AVAILABLE"}`,
      `provider_message: ${result.provider_message ?? "NOT_AVAILABLE"}`,
      `latency_ms: ${result.total_latency_ms}`,
    ].join("\n");
  }
  return result.parsed_output_text;
}

function main() {
  const fixturesData = JSON.parse(
    readFileSync(join(OUT_DIR, "fixtures.json"), "utf8")
  ) as { fixtures: FrozenFixture[] };
  const results = loadJsonl(join(OUT_DIR, "raw-results.jsonl"));
  const invariants = JSON.parse(
    readFileSync(join(OUT_DIR, "run-invariants.json"), "utf8")
  ) as Record<string, unknown>;

  const modelLabels = [
    "GLM-5.3-Flash",
    "Gemini 3.1 Flash-Lite",
    "DeepSeek V4 Flash",
    "DeepSeek V4 Flash-0731",
  ];

  const lines: string[] = [
    "# 4-Model Korean Summary Quality Comparison",
    "",
    "BENCHMARK: 4-model Korean summary quality",
    "PURPOSE: GPT/Human manual scoring",
    "CURSOR_SCORING: NOT PERFORMED",
    "",
    "Review each CASE below. Outputs are raw model text (no Cursor cleanup).",
    "",
    "---",
    "",
  ];

  for (const fixture of fixturesData.fixtures) {
    const caseNum = fixture.fixture_id.replace("CASE-", "");
    lines.push(`# CASE ${caseNum}`);
    lines.push("");
    lines.push(`**Fixture ID:** ${fixture.fixture_id}`);
    lines.push(`**Tags:** ${fixture.tags.join(", ")}`);
    lines.push(`**Approx input tokens (estimated):** ${fixture.approximate_input_tokens_estimated}`);
    lines.push(`**Source SHA-256:** ${fixture.source_hash_sha256}`);
    lines.push("");
    lines.push("## SOURCE");
    lines.push("");
    lines.push("### Production-style dialogue (full)");
    lines.push("");
    lines.push("```text");
    lines.push(fixture.production_style.dialogue);
    lines.push("```");
    lines.push("");
    lines.push("### Production-style user prompt (full)");
    lines.push("");
    lines.push("```text");
    lines.push(fixture.production_style.user_prompt);
    lines.push("```");
    lines.push("");

    for (const label of modelLabels) {
      const row = results.find(
        (r) => r.fixture_id === fixture.fixture_id && r.model_label === label
      );
      lines.push(`## ${label}`);
      lines.push("");
      if (row && row.status === "ok") {
        lines.push(
          `_reported_model_id: ${row.reported_model_id} | provider: ${row.provider} | finish: ${row.finish_reason} | in/out tokens: ${row.input_tokens}/${row.output_tokens}_`
        );
        lines.push("");
      }
      lines.push(formatOutput(row));
      lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push("GPT/HUMAN REVIEW: NOT SCORED YET");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  writeFileSync(join(OUT_DIR, "MODEL_QUALITY_COMPARISON.md"), lines.join("\n"), "utf8");

  const okByModel: Record<string, number> = {};
  for (const label of modelLabels) {
    okByModel[label] = results.filter(
      (r) => r.model_label === label && r.status === "ok"
    ).length;
  }

  const deepseekRows = results.filter((r) =>
    r.requested_model_id.startsWith("deepseek-v4-flash")
  );
  const deepseekObs = deepseekRows.map((r) => ({
    fixture_id: r.fixture_id,
    requested_model_id: r.requested_model_id,
    reported_model_id: r.reported_model_id,
    provider: r.provider,
    status: r.status,
  }));

  const runReport = `# RUN_REPORT — 4-Model Korean Summary Quality Benchmark

## Invariants

\`\`\`json
${JSON.stringify(invariants, null, 2)}
\`\`\`

## Valid outputs by model

| Model | OK / 20 |
|-------|---------|
${modelLabels.map((l) => `| ${l} | ${okByModel[l] ?? 0} / 20 |`).join("\n")}

## Request settings (all models)

- temperature: 0.3
- max_tokens: 350
- production prompt: canonical \`buildRollingSummaryLlmRequest\` from \`memory-rolling-summary.ts\`
- post-processing: none (raw provider text preserved)
- retry/fallback/continuation/recovery/regeneration: 0

### GLM-5.3-Flash
- requested_model_id: \`glm-5.3-flash\`
- reasoning_effort: \`low\`

### Gemini 3.1 Flash-Lite
- requested_model_id: \`gemini-3.1-flash-lite\`
- reasoning_effort: \`none\`

### DeepSeek V4 Flash
- requested_model_id: \`deepseek-v4-flash\`
- thinking: \`{ type: \"disabled\" }\`

### DeepSeek V4 Flash-0731
- requested_model_id: \`deepseek-v4-flash-0731\`
- thinking: \`{ type: \"disabled\" }\`

## DeepSeek model-id observations (factual)

\`\`\`json
${JSON.stringify(deepseekObs, null, 2)}
\`\`\`

## OWNER MAP (production summary path — audited, unchanged)

| Responsibility | Canonical owner |
|----------------|-------------------|
| Summary batch LLM call | \`summarizeTurnBatch\` in \`src/lib/memory/memory-rolling-summary.ts\` |
| System prompt | \`buildRollingSummarySystemPrompt\` + \`ROLLING_SUMMARY_EPISTEMIC_POLICY\` |
| User prompt assembly | \`buildRollingSummaryLlmRequest\` |
| History/dialogue format | \`formatBatchDialogue\` / \`__formatBatchDialogueForTests\` |
| Production model routing | \`callGeminiBackground\` → \`BACKGROUND_OPENROUTER_MODEL\` (Luna default) |
| Provider adapter | \`callOpenRouterCompletion\` + \`adaptCheaperInferenceChatBody\` |
| Retry (production only) | \`summarizeTurnBatch\` up to 3 attempts — **not used in this benchmark** |
| Fallback (production only) | \`resolveBackgroundMemoryFallbackModel\` — **not used in this benchmark** |
| Output clamp (production only) | \`clampMemoryRecordSummary\` — **not used in this benchmark** |

## Infra classification

- **KEEP:** \`docs/audits/final-production-model-smoke/\`, handoff benchmark capsules (unrelated)
- **REPLACED:** N/A (no prior 4-model summary quality bench)
- **SAFE TO DELETE:** \`scripts/summary-quality-bench/_probe-models.ts\` (dev probe only)
- **FOLLOW-UP:** reliability/speed 200–300 call bench; TOP2 selection; production model change

PRODUCTION_CHANGED: false
PROMPT_CHANGED: false (only extracted shared builder; prompt text unchanged)
CURSOR_SCORING: NOT PERFORMED
`;

  writeFileSync(join(OUT_DIR, "RUN_REPORT.md"), runReport, "utf8");
  console.log("Generated MODEL_QUALITY_COMPARISON.md and RUN_REPORT.md");
}

main();
