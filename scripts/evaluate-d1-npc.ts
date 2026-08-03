/**
 * D1 NPC control screening vs D0 manual baseline.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateScreeningEffect } from "../src/lib/rpDiagnosticCanary";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";
const D0 = JSON.parse(
  readFileSync(join(ROOT, "02-ds-pro-real-production/METRICS_V2.json"), "utf8")
) as {
  manual_resume_per_1000_avg: number;
  manual_fragmentation_median: number;
  npc_subplot_rate: string;
};

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

const rows = load(join(ROOT, "03-ds-dialogue-control"));
if (rows.length < 4) {
  const o = { verdict: "NOT_RUN", n: rows.length };
  writeFileSync(join(ROOT, "00-integrity/D1_NPC_VERDICT.json"), JSON.stringify(o, null, 2));
  console.log(JSON.stringify(o));
  process.exit(0);
}

const avg = (k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) / rows.length;
const npc = rows.filter((r) => r.npc_subplot).length;
const effect = evaluateScreeningEffect(
  {
    manual_resume_per_1000: D0.manual_resume_per_1000_avg,
    manual_fragmentation: D0.manual_fragmentation_median,
  },
  { manual_resume_per_1000: avg("manual_resume_per_1000_chars"), manual_fragmentation: avg("manual_fragmentation_multiplier") }
);

let verdict = "NO_EFFECT_AT_THRESHOLD";
if (npc < Number(D0.npc_subplot_rate.split("/")[0]) && !effect.effect_confirmed) {
  verdict = "SCENE_AXIS_CONFIRMED_FOR_NPC_ONLY";
} else if (effect.effect_confirmed) {
  verdict = "D1_EFFECT_CONFIRMED";
}

const out = {
  generated_at: new Date().toISOString(),
  verdict,
  npc_rate: `${npc}/${rows.length}`,
  d0_npc_rate: D0.npc_subplot_rate,
  effect,
  manual_resume_per_1000: avg("manual_resume_per_1000_chars"),
  manual_frag_avg: avg("manual_fragmentation_multiplier"),
  canonical_avg: Math.round(avg("provider_raw_ws")),
  needs_confirmation_6: effect.effect_confirmed,
};

writeFileSync(join(ROOT, "00-integrity/D1_NPC_VERDICT.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
