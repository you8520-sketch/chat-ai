/**
 * D2b length probe verdict vs D1.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateLengthGate } from "../src/lib/rpDiagnosticCanary";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";

function load(dir: string) {
  if (!existsSync(dir)) return [];
  const out: number[] = [];
  for (const run of readdirSync(dir).filter((d) => d.startsWith("run"))) {
    for (let t = 1; t <= 2; t++) {
      const p = join(dir, run, `turn${t}-metrics.json`);
      if (existsSync(p)) {
        const m = JSON.parse(readFileSync(p, "utf8")) as { provider_raw_ws?: number };
        if (m.provider_raw_ws) out.push(m.provider_raw_ws);
      }
    }
  }
  return out;
}

const d1Lens = load(join(ROOT, "03-ds-dialogue-control"));
const d2bLens = load(join(ROOT, "04-ds-common-only-length-probe"));

if (d2bLens.length < 4) {
  const o = { verdict: "NOT_RUN", n: d2bLens.length };
  writeFileSync(join(ROOT, "00-integrity/D2B_VERDICT.json"), JSON.stringify(o, null, 2));
  console.log(JSON.stringify(o));
  process.exit(0);
}

const d1Avg = d1Lens.reduce((a, b) => a + b, 0) / d1Lens.length;
const gate = evaluateLengthGate(d2bLens, { baselineAvg: d1Avg, minAvg: 2700, maxShortRatio: 1 / 6, maxDropPct: 15 });

const verdict = gate.pass ? "D2B_LENGTH_GATE_PASS" : "CANDIDATE_LENGTH_INVALID";

const out = {
  generated_at: new Date().toISOString(),
  verdict,
  gate,
  d2b_canonical_avg: Math.round(d2bLens.reduce((a, b) => a + b, 0) / d2bLens.length),
  d1_canonical_avg: Math.round(d1Avg),
};

writeFileSync(join(ROOT, "00-integrity/D2B_VERDICT.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
