/**
 * D2b length probe verdict vs D1.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";

function loadMetrics(dir: string) {
  if (!existsSync(dir)) return [] as Record<string, unknown>[];
  const out: Record<string, unknown>[] = [];
  for (const run of readdirSync(dir).filter((d) => d.startsWith("run"))) {
    for (let t = 1; t <= 2; t++) {
      const p = join(dir, run, `turn${t}-metrics.json`);
      if (existsSync(p)) out.push(JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>);
    }
  }
  return out;
}

const d1Rows = loadMetrics(join(ROOT, "03-ds-dialogue-control"));
const d2bRows = loadMetrics(join(ROOT, "04-ds-common-only-length-probe"));

if (d2bRows.length < 4) {
  const o = { verdict: "NOT_RUN", n: d2bRows.length };
  writeFileSync(join(ROOT, "00-integrity/D2B_VERDICT.json"), JSON.stringify(o, null, 2));
  console.log(JSON.stringify(o));
  process.exit(0);
}

const lens = d2bRows.map((r) => Number(r.provider_raw_ws ?? 0));
const d1Avg = d1Rows.reduce((a, r) => a + Number(r.provider_raw_ws ?? 0), 0) / d1Rows.length;
const d2bAvg = lens.reduce((a, b) => a + b, 0) / lens.length;
const lt2400 = lens.filter((c) => c < 2400).length;
const dropPct = d1Avg === 0 ? 0 : ((d2bAvg - d1Avg) / d1Avg) * 100;

const reasons: string[] = [];
if (d2bAvg < 2700) reasons.push("canonical_avg_lt_2700");
if (lt2400 > lens.length / 6) reasons.push("canonical_lt_2400_gt_1_6");
if (dropPct < -15) reasons.push("d1_drop_gt_15pct");

const pass = reasons.length === 0;
const verdict = pass ? "D2B_LENGTH_GATE_PASS" : "CANDIDATE_LENGTH_INVALID";

const out = {
  generated_at: new Date().toISOString(),
  verdict,
  pass,
  reasons,
  stats: {
    canonical_avg: Math.round(d2bAvg),
    canonical_lengths: lens,
    count_lt_2400: lt2400,
    d1_baseline_avg: Math.round(d1Avg),
    drop_vs_d1_pct: Math.round(dropPct * 10) / 10,
  },
};

writeFileSync(join(ROOT, "00-integrity/D2B_VERDICT.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
