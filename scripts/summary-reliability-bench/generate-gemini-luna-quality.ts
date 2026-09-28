/**
 * Reassemble Gemini vs Luna ROUND 1 outputs from existing reliability raw-results.
 * No API calls — GPT/Human review artifact only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "docs/audits/3-model-summary-reliability-speed-60");
const FIXTURES_PATH = join(
  process.cwd(),
  "docs/audits/4-model-korean-summary-quality/fixtures.json"
);
const RAW_PATH = join(OUT_DIR, "raw-results.jsonl");
const ARTIFACT_PATH = join(OUT_DIR, "GEMINI_VS_LUNA_QUALITY.md");

const ROUND = 1;
const GEMINI_LABEL = "Gemini 3.1 Flash-Lite";
const LUNA_LABEL = "GPT-5.6 Luna (production background)";
const GEMINI_HEADING = "Gemini 3.1 Flash-Lite";
const LUNA_HEADING = "GPT-5.6 Luna";

type FrozenFixture = {
  fixture_id: string;
  production_style: {
    user_prompt: string;
  };
};

type RawRecord = {
  fixture_id: string;
  round: number;
  model_label: string;
  classification: string;
  raw_provider_response: {
    choices?: { message?: { content?: string | null } }[];
  } | null;
  error_type: string | null;
  provider_message: string | null;
  http_status: number | null;
};

function loadJsonl(path: string): RawRecord[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawRecord);
}

function extractRawOutput(record: RawRecord | undefined): string {
  if (!record) {
    return "CALL_FAILED\n\n(no matching raw result row)";
  }
  const content = record.raw_provider_response?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  return [
    "CALL_FAILED",
    "",
    `classification: ${record.classification}`,
    `error_type: ${record.error_type ?? "NOT_AVAILABLE"}`,
    `http_status: ${record.http_status ?? "NOT_AVAILABLE"}`,
    `provider_message: ${record.provider_message ?? "NOT_AVAILABLE"}`,
  ].join("\n");
}

function main() {
  const fixturesData = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as {
    fixtures: FrozenFixture[];
  };
  const results = loadJsonl(RAW_PATH);

  const lines: string[] = [
    "# Gemini 3.1 Flash-Lite vs GPT-5.6 Luna — Korean Rolling Summary Quality Review",
    "",
    "SOURCE: `docs/audits/3-model-summary-reliability-speed-60/raw-results.jsonl` (ROUND 1 only)",
    "PURPOSE: GPT/Human manual quality comparison before production model change",
    "CURSOR_SCORING: NOT PERFORMED",
    "CURSOR_RANKING: NOT PERFORMED",
    "",
    "---",
    "",
  ];

  for (const fixture of fixturesData.fixtures) {
    const caseNum = fixture.fixture_id.replace("CASE-", "");
    const gemini = results.find(
      (r) =>
        r.fixture_id === fixture.fixture_id &&
        r.round === ROUND &&
        r.model_label === GEMINI_LABEL
    );
    const luna = results.find(
      (r) =>
        r.fixture_id === fixture.fixture_id &&
        r.round === ROUND &&
        r.model_label === LUNA_LABEL
    );

    lines.push(`# CASE ${caseNum}`);
    lines.push("");
    lines.push("## SOURCE");
    lines.push("");
    lines.push(fixture.production_style.user_prompt);
    lines.push("");
    lines.push(`## ${GEMINI_HEADING}`);
    lines.push("");
    lines.push(extractRawOutput(gemini));
    lines.push("");
    lines.push(`## ${LUNA_HEADING}`);
    lines.push("");
    lines.push(extractRawOutput(luna));
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  writeFileSync(ARTIFACT_PATH, lines.join("\n"), "utf8");
  console.log(`Generated ${ARTIFACT_PATH}`);
}

main();
