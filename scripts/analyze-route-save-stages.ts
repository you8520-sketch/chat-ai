/**
 * Analyze route_save_stages from a production diagnostic_pipeline capture
 * to pinpoint the exact stage where paragraph_count inflates.
 *
 * Usage: node --import tsx scripts/analyze-route-save-stages.ts <turn-pipeline.json>
 *        node --import tsx scripts/analyze-route-save-stages.ts --dir <dir-with-turn-pipeline.json>
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

type StageSummary = {
  stage: string;
  char_len: number;
  paragraph_count: number;
  blank_line_count: number;
  quote_pair_count: number;
};

function analyze(label: string, capture: { route_save_stages?: { stages: StageSummary[]; first_inflation: { from: string; to: string; delta: number } | null } }) {
  const rs = capture.route_save_stages;
  if (!rs) {
    console.log(`${label}: NO route_save_stages (capture from older deploy)`);
    return;
  }
  console.log(`\n=== ${label} ===`);
  console.log("first_inflation:", rs.first_inflation ?? "none");
  let prev = -1;
  for (const s of rs.stages) {
    const delta = prev < 0 ? 0 : s.paragraph_count - prev;
    const marker = delta >= 2 ? "  <<< INFLATION" : delta <= -2 ? "  <<< DEFLATION" : "";
    console.log(
      `  ${s.stage.padEnd(42)} paras=${String(s.paragraph_count).padStart(4)} chars=${String(s.char_len).padStart(5)} blanks=${String(s.blank_line_count).padStart(4)} quotes=${String(s.quote_pair_count).padStart(3)} Δ=${delta >= 0 ? "+" : ""}${delta}${marker}`
    );
    prev = s.paragraph_count;
  }
}

function main() {
  const arg = process.argv[2];
  if (arg === "--dir") {
    const dir = process.argv[3]!;
    for (const f of readdirSync(dir).filter((f) => f.endsWith("-pipeline.json"))) {
      const p = join(dir, f);
      const cap = JSON.parse(readFileSync(p, "utf8")) as never;
      analyze(f, cap);
    }
  } else if (arg && existsSync(arg)) {
    const cap = JSON.parse(readFileSync(arg, "utf8")) as never;
    analyze(arg, cap);
  } else {
    console.error("Usage: analyze-route-save-stages.ts <pipeline.json> | --dir <dir>");
    process.exit(1);
  }
}

main();
