/**
 * Terra confirmation blind/review packet — no PASS before ChatGPT.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ART = process.env.OUT_ROOT ?? "/opt/cursor/artifacts/terra-confirmation";
const DOCS = "docs/audits/48-terra-confirmation";

type Row = {
  attempt_id: string;
  test_set: string;
  turn: number;
  user_input: string;
  provider_raw: string;
  visible_chars: number;
  finish_reason: string | null;
  cost_points: number | null;
  api_raw_cost_krw: number | null;
};

function save(name: string, content: string | object) {
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(
    join(DOCS, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function main() {
  const rows = JSON.parse(
    readFileSync(join(ART, "all_valid_rows.json"), "utf8")
  ) as Row[];
  const idx = JSON.parse(readFileSync(join(ART, "outputs_index.json"), "utf8"));

  const raw = ["# Terra confirmation RAW", "", "Model: gpt-5.6-terra (labeled — for operators)", ""];
  const blind = [
    "# Terra confirmation review packet",
    "",
    "```text",
    "TERRA_CONFIRMATION_HUMAN_REVIEW_PENDING",
    "```",
    "",
    "Pass criteria (human):",
    "- relationship average >= 75",
    "- action average >= 82",
    "- severe hard fail = 0/4",
    "- major replay = 0",
    "- external takeover = 0",
    "",
    "If passed: `TERRA_PUBLIC_PREMIUM_CANDIDATE`",
    "Do not declare candidate before scoring.",
    "",
  ];

  for (const row of rows) {
    raw.push(`## ${row.attempt_id}`, "", `chars=${row.visible_chars} finish=${row.finish_reason}`, "", "```text", row.provider_raw.trimEnd(), "```", "");
    blind.push(`## ${row.attempt_id} (${row.test_set} T${row.turn})`, "", "**User**", "", "```text", row.user_input, "```", "", "**Output**", "", "```text", row.provider_raw.trimEnd(), "```", "");
  }

  save("RAW_OUTPUTS_FULL.md", raw.join("\n"));
  save("REVIEW_PACKET.md", blind.join("\n"));
  save("RUNTIME_RESULTS.json", {
    status: "TERRA_CONFIRMATION_HUMAN_REVIEW_PENDING",
    model: "gpt-5.6-terra",
    architecture: "PR #248 collaborative; Terra terminal owner only",
    attempts: idx.attempts,
    valid: idx.valid,
    replacement_calls: idx.replacement_calls,
    exclusions: idx.exclusions,
    human_review: "NOT_RUN — waiting for ChatGPT",
  });
  save("README.md", [
    "# Audit 48 — Terra confirmation",
    "",
    "```text",
    "TERRA_CONFIRMATION_HUMAN_REVIEW_PENDING",
    "```",
    "",
  ].join("\n"));
  console.log(JSON.stringify({ docs: DOCS, valid: rows.length }, null, 2));
}

main();
