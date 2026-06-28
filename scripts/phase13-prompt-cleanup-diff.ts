/**
 * Diff before/after Phase 13 main system prompt cleanup (DeepSeek variant from all-model dump).
 */
import fs from "fs";
import path from "path";

const BEFORE = path.join("output", "all-model-system-prompts.before-phase13-cleanup.txt");
const AFTER = path.join("output", "all-model-system-prompts.txt");
const OUT = path.join("output", "phase13-cleanup-diff-report.txt");

const REMOVED_MARKERS = [
  "[Character Critical/",
  "<PROSE_STYLE_POLICY>",
  "</PROSE_STYLE_POLICY>",
  "<ADVANCED_PROSE_NSFW>",
  "<KOREAN_WEBNOVEL_STYLE>",
  "Format: [KOREAN_WEBNOVEL_STYLE]",
  "[NARRATIVE CORE]",
  "[USER PERSONA NARRATION]",
  "[APPEARANCE LOCK",
  "[최우선 절대 지침",
  "[FLASH-OWNED — PRIMARY MODEL",
  "[HTML VISUAL CARD — MAIN MODEL",
  "[HTML VISUAL CARD — SERVER GENERATED]",
  "[RELATIONSHIP MEMORY — SELF-EXTRACT]",
  "[STATUS UI — FLASH-OWNED",
  "일상 및 텐션 빌드업 구간 (Mode A)",
  "본격적인 19금 육체적 접촉 구간 (Mode B)",
];

function extractDeepSeekPrompt(dump: string): string {
  const marker = "MODEL: DeepSeek V4 Pro";
  const start = dump.indexOf(marker);
  if (start < 0) return "";
  const next = dump.indexOf("####################################################################################################", start + 1);
  const slice = next > start ? dump.slice(start, next) : dump.slice(start);
  const fullMarker = "── FULL SYSTEM PROMPT ──";
  const fs = slice.indexOf(fullMarker);
  if (fs < 0) return slice;
  return slice.slice(fs + fullMarker.length);
}

function lineBody(line: string): string {
  return line.replace(/^\d+\|\s?/, "");
}

function parseNumberedLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => lineBody(l).trimEnd())
    .filter((l) => l.trim().length > 0);
}

function main() {
  if (!fs.existsSync(BEFORE) || !fs.existsSync(AFTER)) {
    console.error("Missing dump files. Run dump-all-model-system-prompts.ts first.");
    process.exit(1);
  }
  const beforeRaw = fs.readFileSync(BEFORE, "utf8");
  const afterRaw = fs.readFileSync(AFTER, "utf8");
  const beforeLines = parseNumberedLines(extractDeepSeekPrompt(beforeRaw));
  const afterLines = parseNumberedLines(extractDeepSeekPrompt(afterRaw));
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  const removed = beforeLines.filter((l) => !afterSet.has(l));
  const added = afterLines.filter((l) => !beforeSet.has(l));

  const lines: string[] = [
    "Phase 13 — MAIN SYSTEM PROMPT cleanup diff (DeepSeek V4 Pro variant)",
    `before: ${BEFORE}`,
    `after:  ${AFTER}`,
    "",
    "=== REMOVED LINES (in before, not in after) ===",
    `count: ${removed.length}`,
    "",
  ];
  for (const l of removed.slice(0, 200)) {
    lines.push(`- ${l}`);
  }
  if (removed.length > 200) lines.push(`... (${removed.length - 200} more)`);

  lines.push("", "=== ADDED LINES (in after, not in before) ===", `count: ${added.length}`, "");
  for (const l of added.slice(0, 80)) {
    lines.push(`+ ${l}`);
  }
  if (added.length > 80) lines.push(`... (${added.length - 80} more)`);

  lines.push("", "=== DELETION TARGET CHECKLIST ===");
  for (const m of REMOVED_MARKERS) {
    const inBefore = beforeRaw.includes(m);
    const inAfter = afterRaw.includes(m);
    lines.push(`${inAfter ? "STILL IN DUMP" : "removed"}: ${m} (was in before: ${inBefore})`);
  }

  const beforeTok = beforeRaw.match(/DeepSeek V4 Pro[\s\S]*?≈([\d,]+) tok/);
  const afterTok = afterRaw.match(/DeepSeek V4 Pro[\s\S]*?≈([\d,]+) tok/);
  lines.push(
    "",
    "=== TOKEN SUMMARY (DeepSeek section header) ===",
    `before: ${beforeTok?.[1] ?? "?"} tok`,
    `after:  ${afterTok?.[1] ?? "?"} tok`,
  );

  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`Wrote ${OUT}`);
}

main();
