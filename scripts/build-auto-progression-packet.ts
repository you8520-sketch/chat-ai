/**
 * Build Audit 45 auto-progression human review packet.
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/auto-progression-ai-focal";
const DOCS = "docs/audits/45-auto-progression-ai-focal";
const ART = "data/human-review/45-auto-progression-ai-focal";

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function main() {
  const idx = JSON.parse(
    readFileSync(join(ROOT, "outputs_index.json"), "utf8")
  ) as {
    auto_valid: number;
    new_calls: number;
    replacement_calls: number;
    exclusions: unknown[];
    outputs: Array<Record<string, unknown>>;
  };

  const rows: Array<{
    attempt_id: string;
    run: number;
    provider_raw: string;
    meta: Record<string, unknown>;
  }> = [];
  for (const run of [1, 2]) {
    const raw = join(ROOT, `run${run}`, "auto-provider-raw.txt");
    const meta = join(ROOT, `run${run}`, "auto-meta.json");
    if (!existsSync(raw) || !existsSync(meta)) {
      throw new Error(`missing auto run${run}`);
    }
    rows.push({
      attempt_id: `AUTO-R${run}`,
      run,
      provider_raw: readFileSync(raw, "utf8"),
      meta: JSON.parse(readFileSync(meta, "utf8")) as Record<string, unknown>,
    });
  }

  const runtime = {
    status: "AUTO_PROGRESSION_HUMAN_REVIEW_PENDING",
    generated_at: new Date().toISOString(),
    model: "deepseek-v4-pro",
    architecture: "PR #248 collaborative default + AI-focal auto owner",
    attempts: idx.new_calls,
    valid: rows.length,
    replacement_calls: idx.replacement_calls,
    exclusions: idx.exclusions,
    chars: rows.map((r) => [...r.provider_raw].length),
    human_review: "NOT_RUN — waiting for ChatGPT",
    note: "Do not auto-declare PASS/FAIL. Separate track from Luna/Terra bake-off.",
  };

  const promptCapture = [
    "# Mode prompt capture — auto progression",
    "",
    "```text",
    "runtimeMode = auto_progression",
    "noGodmodding = autoContinue",
    "owner = [AUTO PROGRESSION — AI-FOCAL CO-NARRATION] ×1",
    "legacy novel owner = 0",
    "isContinue = true",
    "explicit user input = none",
    "```",
    "",
    "Allowed: [B] external action/dialogue with USER_PERSONA voice; AI-focal POV.",
    "Forbidden: [B] 1st-person / inner monologue / private desire confirmation / major decisions; Like exits.",
    "",
  ].join("\n");

  const review: string[] = [
    "# Auto-progression human review packet\n",
    "Status: `AUTO_PROGRESSION_HUMAN_REVIEW_PENDING`\n",
    "Model: deepseek-v4-pro · architecture from PR #248.\n",
    "Do **not** auto-declare PASS/FAIL.\n",
    "\n## Checklist per output\n",
    "```text",
    "AI character or external 3rd-person focalization",
    "렌 external action present",
    "렌 USER_PERSONA-voice dialogue present",
    "no 렌 inner monologue",
    "no omniscient 렌 emotion/desire lock",
    "라이크 remains primary scene character",
    "scene actually advances",
    "```\n",
  ];

  const raw: string[] = [
    "# RAW auto-progression outputs\n",
    "Status: `AUTO_PROGRESSION_HUMAN_REVIEW_PENDING`\n",
  ];

  for (const r of rows) {
    review.push(
      `\n---\n\n## ${r.attempt_id}\n\n` +
        `### Context\n\nStandard T1→T2 already played in this chat; then \`isContinue=true\`.\n\n` +
        `### Assistant (auto-progression)\n\n\`\`\`text\n${r.provider_raw}\n\`\`\`\n`
    );
    raw.push(
      `\n---\n\n## ${r.attempt_id}\n\n` +
        `- finish: ${r.meta.finish_reason}\n` +
        `- raw_chars: ${[...r.provider_raw].length}\n` +
        `- charged_points: ${r.meta.charged_points}\n\n` +
        `\`\`\`text\n${r.provider_raw}\n\`\`\`\n`
    );
  }

  mkdirSync(DOCS, { recursive: true });
  mkdirSync(ART, { recursive: true });
  save(DOCS, "RUNTIME_RESULTS.json", runtime);
  save(DOCS, "MODE_PROMPT_CAPTURE.md", promptCapture);
  save(DOCS, "AUTO_PROGRESSION_REVIEW_PACKET.md", review.join("\n"));
  save(DOCS, "RAW_OUTPUTS_FULL.md", raw.join("\n"));
  save(
    DOCS,
    "README.md",
    [
      "# 45 — Auto-progression AI-focal screen",
      "",
      "```text",
      "AUTO_PROGRESSION_HUMAN_REVIEW_PENDING",
      "valid: 2",
      "```",
      "",
      "Separate track from Luna/Terra bake-off — do not gate bake-off on this.",
      "",
    ].join("\n")
  );

  for (const name of [
    "RUNTIME_RESULTS.json",
    "MODE_PROMPT_CAPTURE.md",
    "AUTO_PROGRESSION_REVIEW_PACKET.md",
    "RAW_OUTPUTS_FULL.md",
    "README.md",
  ]) {
    copyFileSync(join(DOCS, name), join(ART, name));
  }
  try {
    execSync(
      `cd ${ART} && zip -q -r 45-auto-progression-ai-focal.zip AUTO_PROGRESSION_REVIEW_PACKET.md RAW_OUTPUTS_FULL.md MODE_PROMPT_CAPTURE.md RUNTIME_RESULTS.json README.md`,
      { stdio: "inherit" }
    );
  } catch {
    /* ignore */
  }
  console.log(JSON.stringify(runtime, null, 2));
}

main();
