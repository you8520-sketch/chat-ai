/**
 * Display grouping analysis from P0 pipeline captures (pre/post vs sse).
 * Informs P1 verdict direction; official P1 still requires ds_display_grouping_bypass run.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit/01-postprocess/ds_pipeline_baseline";

const rows: unknown[] = [];
for (const run of readdirSync(ROOT).filter((d) => d.startsWith("run"))) {
  for (let t = 1; t <= 2; t++) {
    const raw = readFileSync(join(ROOT, run, `turn${t}-provider-raw.txt`), "utf8");
    const pre = readFileSync(join(ROOT, run, `turn${t}-pre-display-grouping.txt`), "utf8");
    const post = readFileSync(join(ROOT, run, `turn${t}-post-display-grouping.txt`), "utf8");
    const sse = readFileSync(join(ROOT, run, `turn${t}-sse-final.txt`), "utf8");
    const rm = computeDialogueMetrics({ text: raw });
    const sm = computeDialogueMetrics({ text: sse });
    rows.push({
      run,
      turn: t,
      raw_quotes: rm.raw_quote_blocks,
      raw_manual_resume: rm.manual_resume_transitions,
      sse_quotes: sm.raw_quote_blocks,
      sse_paragraphs: sm.paragraph_count,
      raw_paragraphs: rm.paragraph_count,
      paragraph_inflation: sm.paragraph_count - rm.paragraph_count,
      quote_collapse: rm.raw_quote_blocks - sm.raw_quote_blocks,
      raw_equals_pre: raw === pre,
      pre_equals_post: pre === post,
    });
  }
}

const avgInflation =
  rows.reduce((a, r) => a + (r as { paragraph_inflation: number }).paragraph_inflation, 0) /
  rows.length;
const avgQuoteCollapse =
  rows.reduce((a, r) => a + (r as { quote_collapse: number }).quote_collapse, 0) / rows.length;

const verdict =
  avgInflation > 20 && avgQuoteCollapse > 3
    ? "POSTPROCESS_VISUAL_AMPLIFIER"
    : "INSUFFICIENT_EVIDENCE";

const out = {
  generated_at: new Date().toISOString(),
  source: "P0_ds_pipeline_baseline_pipeline_captures",
  note: "Provider RAW manual metrics unchanged pre→post; SSE display inflates paragraphs and collapses quote auto-count",
  verdict,
  avg_paragraph_inflation: Math.round(avgInflation),
  avg_quote_collapse_in_sse: Math.round(avgQuoteCollapse * 10) / 10,
  rows,
};

writeFileSync(
  "/opt/cursor/artifacts/deepseek-common-root-audit/00-integrity/P0_DISPLAY_PIPELINE_ANALYSIS.json",
  JSON.stringify(out, null, 2)
);
console.log(JSON.stringify(out, null, 2));
