/**
 * P1 display grouping verdict — compares P1 vs P0 provider RAW + pipeline stages.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";
import { judgePostprocessPrimary } from "../src/lib/rpDiagnosticCanary";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";
const P0 = join(ROOT, "01-postprocess/ds_pipeline_baseline");
const P1 = join(ROOT, "01-postprocess/ds_display_grouping_bypass");

function loadMetrics(dir: string) {
  if (!existsSync(dir)) return [];
  const out: Record<string, unknown>[] = [];
  for (const run of readdirSync(dir).filter((d) => d.startsWith("run"))) {
    for (let t = 1; t <= 2; t++) {
      const p = join(dir, run, `turn${t}-metrics.json`);
      if (existsSync(p)) out.push(JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>);
    }
  }
  return out;
}

function avg(rows: Record<string, unknown>[], key: string): number {
  if (!rows.length) return 0;
  return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0) / rows.length;
}

function countBlankLines(text: string): number {
  return (text.match(/\n\s*\n/g) ?? []).length;
}

const p0 = loadMetrics(P0);
const p1 = loadMetrics(P1);

if (p1.length < 4) {
  const partial = {
    verdict: "NOT_RUN",
    reason: "INSUFFICIENT_P1_SAMPLES",
    n: p1.length,
  };
  writeFileSync(join(ROOT, "00-integrity/P1_DISPLAY_VERDICT.json"), JSON.stringify(partial, null, 2));
  console.log(JSON.stringify(partial));
  process.exit(0);
}

const p1Pipelines = [];
for (const run of readdirSync(P1).filter((d) => d.startsWith("run"))) {
  for (let t = 1; t <= 2; t++) {
    const pj = join(P1, run, `turn${t}-pipeline.json`);
    if (!existsSync(pj)) continue;
    const raw = JSON.parse(readFileSync(pj, "utf8")) as { metrics?: unknown; pipeline?: Record<string, string> };
    if (raw.metrics && raw.pipeline) {
      p1Pipelines.push({ metrics: raw.metrics, pipeline: raw.pipeline });
    }
  }
}

const displayRows = p1.map((r, i) => {
  const run = Math.floor(i / 2) + 1;
  const turn = (i % 2) + 1;
  const pre = readFileSync(join(P1, `run${run}`, `turn${turn}-pre-display-grouping.txt`), "utf8");
  const post = readFileSync(join(P1, `run${run}`, `turn${turn}-post-display-grouping.txt`), "utf8");
  const sse = readFileSync(join(P1, `run${run}`, `turn${turn}-sse-final.txt`), "utf8");
  return {
    pre_paragraphs: computeDialogueMetrics({ text: pre }).paragraph_count,
    post_paragraphs: computeDialogueMetrics({ text: post }).paragraph_count,
    sse_paragraphs: computeDialogueMetrics({ text: sse }).paragraph_count,
    pre_blanks: countBlankLines(pre),
    post_blanks: countBlankLines(post),
    sse_blanks: countBlankLines(sse),
    raw_quotes: r.raw_quote_blocks,
    manual_resume: r.manual_resume_transitions,
    manual_frag: r.manual_fragmentation_multiplier,
  };
});

const rawSimilar =
  Math.abs(avg(p1, "raw_quote_blocks") - avg(p0, "raw_quote_blocks")) /
    Math.max(avg(p0, "raw_quote_blocks"), 1) <
  0.15;

const paragraphDrop =
  avg(displayRows as Record<string, unknown>[], "post_paragraphs") -
  avg(displayRows as Record<string, unknown>[], "sse_paragraphs");

const verdicts = p1Pipelines.map((p) =>
  judgePostprocessPrimary({
    provider_raw_merged: p.pipeline.provider_raw_merged ?? "",
    pre_normalize: "",
    post_normalize: "",
    pre_display_grouping: p.pipeline.pre_display_grouping ?? "",
    post_display_grouping: p.pipeline.post_display_grouping ?? "",
    sse_final: p.pipeline.sse_final ?? "",
    db_saved: p.pipeline.db_saved ?? "",
    metrics: p.metrics as never,
  })
);

let verdict: string = "POSTPROCESS_NOT_PRIMARY";
if (verdicts.includes("POSTPROCESS_CREATES_FRAGMENTATION")) {
  verdict = "POSTPROCESS_CREATES_FRAGMENTATION";
} else if (rawSimilar && paragraphDrop > 2) {
  verdict = "POSTPROCESS_VISUAL_AMPLIFIER";
} else if (verdicts.includes("POSTPROCESS_VISUAL_AMPLIFIER")) {
  verdict = "POSTPROCESS_VISUAL_AMPLIFIER";
}

const out = {
  generated_at: new Date().toISOString(),
  verdict,
  raw_similar_to_p0: rawSimilar,
  p0_manual_resume_per_1000: avg(p0, "manual_resume_per_1000_chars"),
  p1_manual_resume_per_1000: avg(p1, "manual_resume_per_1000_chars"),
  p1_manual_frag_median: avg(p1, "manual_fragmentation_multiplier"),
  display_paragraph_drop_avg: paragraphDrop,
  display_rows: displayRows,
  pipeline_verdicts: verdicts,
};

writeFileSync(join(ROOT, "00-integrity/P1_DISPLAY_VERDICT.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
