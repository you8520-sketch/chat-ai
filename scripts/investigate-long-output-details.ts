/**
 * Extract investigation tables: sweep max + forensic long samples.
 * Usage: npx.cmd tsx scripts/investigate-long-output-details.ts
 */
import fs from "fs";
import path from "path";
import { estimateTokens } from "../src/lib/tokenEstimate";

const FLOOR = 2200;
const TARGET_CHARS = 3300;

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

function main() {
  const sweepPath = path.resolve("output/history-depth-sweep.jsonl");
  const forensicPath = path.resolve("output/forensic-long-output-deepseek.jsonl");
  const outPath = path.resolve("output/investigation-long-output-details.txt");

  const lines: string[] = [
    "LONG OUTPUT INVESTIGATION DETAILS",
    `generated: ${new Date().toISOString()}`,
    "",
  ];

  // 1. Sweep max
  lines.push("## 1. History-depth-sweep max output (5523 chars)");
  const sweep = fs
    .readFileSync(sweepPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const maxSweep = sweep.reduce(
    (best: { output_chars: number }, s: { output_chars?: number }) =>
      (s.output_chars ?? 0) > (best.output_chars ?? 0) ? s : best,
    { output_chars: 0 }
  );
  const baseUser = "정말 고장났나봐.... 나랑 떨어져야되는거아니야??";
  lines.push(`  model: deepseek/deepseek-v4-pro`);
  lines.push(`  depth: ${maxSweep.depth} run: ${maxSweep.run}`);
  lines.push(`  finish_reason: ${maxSweep.finish_reason}`);
  lines.push(`  completion_tokens: (not logged in sweep — finish=length suggests near max_tokens cap)`);
  lines.push(`  output_chars: ${maxSweep.output_chars}`);
  lines.push(`  history_tokens: ${maxSweep.history_tokens}`);
  lines.push(`  user_tokens (est. base prompt): ${estimateTokens(baseUser)}`);
  lines.push(`  targetResponseChars: ${TARGET_CHARS} (experiment fixture)`);
  lines.push(`  system_tokens: ${maxSweep.system_tokens}`);
  lines.push("");

  // 2. Forensic >=3000 unique messages
  lines.push("## 2. Forensic production samples >=3000 chars (unique message_id)");
  const forensic = fs
    .readFileSync(forensicPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

  const byMsg = new Map<number, typeof forensic[0]>();
  for (const row of forensic) {
    if (row.output_chars < 3000) continue;
    if (!byMsg.has(row.message_id)) byMsg.set(row.message_id, row);
  }

  const sorted = [...byMsg.values()].sort((a, b) => b.output_chars - a.output_chars);
  lines.push(`  count: ${sorted.length}`);
  lines.push("");

  for (const row of sorted) {
    lines.push(`### message_id=${row.message_id} chat_id=${row.chat_id} ${row.created_at}`);
    lines.push(`  finish_reason: ${row.finish_reason}`);
    lines.push(`  completion_tokens (output_tokens): ${row.output_tokens}`);
    lines.push(`  output_chars: ${row.output_chars}`);
    lines.push(`  history_tokens: ${row.history_tokens}`);
    lines.push(`  user_tokens: ${row.user_tokens}`);
    lines.push(`  targetResponseChars: ${row.target_response_chars}`);
    lines.push(`  model: ${row.model}`);
    lines.push("");
  }

  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`Wrote ${outPath}`);
}

main();
