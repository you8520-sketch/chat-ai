/**
 * D2a vs D1 screening verdict.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateScreeningEffect } from "../src/lib/rpDiagnosticCanary";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";

function load(dir: string) {
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

const d1 = load(join(ROOT, "03-ds-dialogue-control"));
const d2 = load(join(ROOT, "04-ds-common-only"));
if (d2.length < 4 || d1.length < 4) {
  const o = { verdict: "NOT_RUN", d2_n: d2.length, d1_n: d1.length };
  writeFileSync(join(ROOT, "00-integrity/D2A_VERDICT.json"), JSON.stringify(o, null, 2));
  console.log(JSON.stringify(o));
  process.exit(0);
}

const avg = (rows: Record<string, unknown>[], k: string) =>
  rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) / rows.length;

const d1Base = {
  manual_resume_per_1000: avg(d1, "manual_resume_per_1000_chars"),
  manual_fragmentation: avg(d1, "manual_fragmentation_multiplier"),
};
const effect = evaluateScreeningEffect(d1Base, {
  manual_resume_per_1000: avg(d2, "manual_resume_per_1000_chars"),
  manual_fragmentation: avg(d2, "manual_fragmentation_multiplier"),
});

let verdict = "COMMON_STACK_PRIMARY_CANDIDATE";
if (effect.effect_confirmed) verdict = "DEEPSEEK_PRO_SPECIFIC_LAYER_CONFIRMED";

const out = {
  generated_at: new Date().toISOString(),
  verdict,
  effect,
  d2_canonical_avg: Math.round(avg(d2, "provider_raw_ws")),
  needs_confirmation_6: effect.effect_confirmed,
};

writeFileSync(join(ROOT, "00-integrity/D2A_VERDICT.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
