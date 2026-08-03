/**
 * Aggregate Terra dialogue-root experiment metrics → FINAL_STATS.json + screening verdicts.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.ART_ROOT ?? "/opt/cursor/artifacts/terra-dialogue-root-final";

type TurnMetric = {
  resume_bundles_auto: number;
  npc_subplot: boolean;
  trailing_reaction_points: number;
  scene_completion: boolean;
  canonical_length_ws: number;
  narration_ratio_pct: number;
  like_dialogue_blocks: number;
  external_dialogue_blocks: number;
  api?: { reasoning_tokens?: number; lengthRecoveryPasses?: number; raw_equals_final?: boolean };
};

function loadVariantMetrics(dir: string): TurnMetric[] {
  if (!existsSync(dir)) return [];
  const runs = readdirSync(dir).filter((d) => d.startsWith("run"));
  const out: TurnMetric[] = [];
  for (const run of runs) {
    for (let t = 1; t <= 4; t++) {
      const p = join(dir, run, `turn${t}-metrics.json`);
      if (!existsSync(p)) continue;
      out.push(JSON.parse(readFileSync(p, "utf8")) as TurnMetric);
    }
  }
  return out;
}

function stats(rows: TurnMetric[]) {
  if (rows.length === 0) return null;
  const avg = (fn: (r: TurnMetric) => number) =>
    rows.reduce((a, r) => a + fn(r), 0) / rows.length;
  const resume = rows.map((r) => r.resume_bundles_auto).sort((a, b) => a - b);
  const med = resume[Math.floor(resume.length / 2)] ?? 0;
  return {
    n: rows.length,
    canonical_avg: Math.round(avg((r) => r.canonical_length_ws)),
    canonical_min: Math.min(...rows.map((r) => r.canonical_length_ws)),
    canonical_max: Math.max(...rows.map((r) => r.canonical_length_ws)),
    narr_avg: Math.round(avg((r) => r.narration_ratio_pct) * 10) / 10,
    like_dlg_avg: Math.round(avg((r) => r.like_dialogue_blocks) * 10) / 10,
    ext_dlg_avg: Math.round(avg((r) => r.external_dialogue_blocks) * 10) / 10,
    resume_avg: Math.round(avg((r) => r.resume_bundles_auto) * 10) / 10,
    resume_median: med,
    resume_max: Math.max(...rows.map((r) => r.resume_bundles_auto)),
    npc_subplot_rate: `${rows.filter((r) => r.npc_subplot).length}/${rows.length}`,
    trailing_success: `${rows.filter((r) => r.trailing_reaction_points >= 1).length}/${rows.length}`,
    scene_completion: `${rows.filter((r) => r.scene_completion).length}/${rows.length}`,
    reasoning_nonzero: rows.filter((r) => (r.api?.reasoning_tokens ?? 0) > 0).length,
    recovery_nonzero: rows.filter((r) => (r.api?.lengthRecoveryPasses ?? 0) > 0).length,
    raw_ne_final: rows.filter((r) => r.api?.raw_equals_final === false).length,
  };
}

function screeningVerdict(
  baseline: NonNullable<ReturnType<typeof stats>>,
  candidate: NonNullable<ReturnType<typeof stats>>
): { pass: boolean; resume_delta_pct: number; notes: string[] } {
  const resumeDelta =
    baseline.resume_avg === 0
      ? 0
      : ((candidate.resume_avg - baseline.resume_avg) / baseline.resume_avg) * 100;
  const notes: string[] = [];
  const passResume = resumeDelta <= -30;
  const passTrailing =
    Number(candidate.trailing_success.split("/")[0]) >=
    Number(baseline.trailing_success.split("/")[0]);
  const passLen = candidate.canonical_avg >= baseline.canonical_avg * 0.9;
  const baselineNpc = Number(baseline.npc_subplot_rate.split("/")[0]);
  const candNpc = Number(candidate.npc_subplot_rate.split("/")[0]);
  const passNpc = candNpc <= baselineNpc;
  if (!passResume) notes.push(`resume ${resumeDelta.toFixed(1)}% (need ≤-30%)`);
  if (!passTrailing) notes.push("trailing reaction degraded");
  if (!passLen) notes.push("canonical length dropped >10%");
  if (!passNpc) notes.push("NPC subplot increased");
  return {
    pass: passResume && passTrailing && passLen && passNpc,
    resume_delta_pct: resumeDelta,
    notes,
  };
}

function main() {
  mkdirSync(ROOT, { recursive: true });
  const variants = {
    baseline: "01-baseline",
    greeting: "02-greeting-dialogue-bundled",
    terminal: "03-terminal-continuous-scene",
    scope: "04-dialogue-reference-scope",
    combined: "06-best-structure-t07",
    temp05: "07-best-structure-t05",
    temp06: "08-best-structure-t06",
  };

  const loaded: Record<string, ReturnType<typeof stats>> = {};
  for (const [k, sub] of Object.entries(variants)) {
    loaded[k] = stats(loadVariantMetrics(join(ROOT, sub)));
  }

  const baseline = loaded.baseline;
  const screening: Record<string, unknown> = {};
  if (baseline) {
    for (const [label, key] of [
      ["greeting_dialogue_bundled", "greeting"],
      ["terminal_continuous_scene", "terminal"],
      ["dialogue_reference_scope", "scope"],
    ] as const) {
      const cand = loaded[key];
      if (cand) {
        const v = screeningVerdict(baseline, cand);
        screening[label] = {
          verdict: v.pass
            ? label === "greeting_dialogue_bundled"
              ? "ROOT_CAUSE_GREETING_RHYTHM_CONFIRMED"
              : label === "terminal_continuous_scene"
                ? "ROOT_CAUSE_TERMINAL_ENUMERATION_CONFIRMED"
                : "ROOT_CAUSE_DIALOGUE_REFERENCE_SCOPE_CONFIRMED"
            : label === "greeting_dialogue_bundled"
              ? "GREETING_RHYTHM_NOT_PRIMARY"
              : label === "terminal_continuous_scene"
                ? "TERMINAL_ENUMERATION_NOT_PRIMARY"
                : "DIALOGUE_REFERENCE_SCOPE_NOT_PRIMARY",
          ...v,
        };
      }
    }
  }

  const layoutAudit = {
    verdict: "COMMON_LAYOUT_ALREADY_TESTED_NOT_PRIMARY",
    note: "Prior canary + static audit; no new unverified strong recency owner in code path",
  };

  const out = {
    generated_at: new Date().toISOString(),
    variants: loaded,
    screening,
    layout_audit: layoutAudit,
  };
  writeFileSync(join(ROOT, "FINAL_STATS.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main();
