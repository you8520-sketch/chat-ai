/**
 * Audit 56 — re-aggregate length using production visibleAssistantDisplayCharCount.
 * No API re-calls. Does not overwrite COST_RESULTS.json.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const LIVE =
  process.env.OUT_ROOT ?? "/opt/cursor/artifacts/opus-quality-anchor";
const DOCS = "docs/audits/56-opus-quality-anchor";

async function main() {
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  function koreanChars(text: string): number {
    return [...text].filter((ch) => /[\uAC00-\uD7A3]/.test(ch)).length;
  }

  const rows: Record<string, unknown>[] = [];
  const liveRoot = join(LIVE, "live");
  for (const sc of readdirSync(liveRoot)) {
    for (const armDir of readdirSync(join(liveRoot, sc))) {
      const arm = armDir.replace(/^arm-/, "");
      const runDir = join(liveRoot, sc, armDir, "run1");
      for (const turn of [1, 2] as const) {
        const rawPath = join(runDir, `turn${turn}-provider-raw.txt`);
        const metaPath = join(runDir, `turn${turn}-meta.json`);
        if (!existsSync(rawPath) || !existsSync(metaPath)) continue;
        const raw = readFileSync(rawPath, "utf8");
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<
          string,
          unknown
        >;
        const totalVisible = visibleAssistantDisplayCharCount(raw);
        const korean = koreanChars(raw);
        const oldFlag = meta.natural_stop_flag;
        const finish = meta.finish_reason;
        const correctedFlag =
          finish === "stop" && totalVisible < 3200
            ? "NATURAL_STOP_BELOW_NUMERIC_TARGET"
            : null;
        const inTarget = totalVisible >= 3200 && totalVisible <= 4200;
        const belowTarget = totalVisible < 3200;
        const aboveTarget = totalVisible > 4200;
        rows.push({
          attempt_id: meta.attempt_id,
          arm,
          scenario_id: sc,
          turn,
          finish_reason: finish,
          old_visible_chars: meta.visible_chars,
          old_visible_korean_chars: meta.visible_korean_chars,
          old_natural_stop_flag: oldFlag,
          corrected_total_visible_chars: totalVisible,
          visible_korean_chars_aux: korean,
          corrected_natural_stop_flag: correctedFlag,
          in_target_3200_4200: inTarget,
          below_3200: belowTarget,
          above_4200: aboveTarget,
          api_raw_cost_krw: meta.api_raw_cost_krw,
          input_tokens: meta.input_tokens,
          latency_s: meta.latency_s,
        });
      }
    }
  }

  const byArm: Record<string, Record<string, unknown>> = {};
  for (const arm of ["A", "B", "C"]) {
    const m = rows.filter((r) => r.arm === arm);
    const totals = m.map((r) => r.corrected_total_visible_chars as number);
    const oldNatural = m.filter(
      (r) => r.old_natural_stop_flag === "NATURAL_STOP_BELOW_NUMERIC_TARGET"
    ).length;
    const newNatural = m.filter(
      (r) => r.corrected_natural_stop_flag === "NATURAL_STOP_BELOW_NUMERIC_TARGET"
    ).length;
    const inTarget = m.filter((r) => r.in_target_3200_4200).length;
    const below = m.filter((r) => r.below_3200).length;
    const above = m.filter((r) => r.above_4200).length;
    const avg = totals.length
      ? totals.reduce((a, b) => a + b, 0) / totals.length
      : null;
    const sorted = [...totals].sort((a, b) => a - b);
    const median = sorted.length
      ? sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]!
        : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
      : null;
    byArm[arm] = {
      outputs: m.length,
      old_natural_stop_count_INVALID: oldNatural,
      corrected_natural_stop_below_3200: newNatural,
      in_target_3200_4200: inTarget,
      below_3200: below,
      above_4200: above,
      avg_total_visible_chars: avg,
      median_total_visible_chars: median,
      min_total_visible_chars: sorted[0] ?? null,
      max_total_visible_chars: sorted[sorted.length - 1] ?? null,
      sum_api_raw_cost_krw: m
        .map((r) => r.api_raw_cost_krw)
        .filter((x): x is number => typeof x === "number")
        .reduce((a, b) => a + b, 0),
    };
  }

  mkdirSync(DOCS, { recursive: true });
  writeFileSync(
    join(DOCS, "COST_RESULTS_CORRECTED.json"),
    JSON.stringify(
      {
        basis:
          "corrected_total_visible_chars = visibleAssistantDisplayCharCount(raw) (production display length). No API re-calls. COST_RESULTS.json left untouched.",
        old_natural_stop_counts: "INVALID",
        byArm,
        rows,
      },
      null,
      2
    ),
    "utf8"
  );

  const md = `# LENGTH_METRIC_CORRECTION — Audit 56

## Bug

Phase-1 scripts compared Hangul-only count \`koreanChars(text)\` against the \`3,200~4,200자\` target.

Production length uses **total visible display characters**:

\`\`\`ts
visibleAssistantDisplayCharCount(finalText)
\`\`\`

## Correction

Re-aggregated all 36 existing raw outputs with \`visibleAssistantDisplayCharCount\` (no API re-calls).

\`visible_korean_chars\` retained only as a language-hygiene auxiliary metric.

\`COST_RESULTS.json\` was **not** overwritten. See \`COST_RESULTS_CORRECTED.json\`.

## Summary

\`\`\`text
old natural-stop counts: INVALID
\`\`\`

| Arm | old natural-stop (INVALID) | corrected natural-stop (<3200 total visible) | in 3200–4200 | below 3200 | above 4200 | median total visible |
|---|---:|---:|---:|---:|---:|---:|
| A | ${byArm.A!.old_natural_stop_count_INVALID} | ${byArm.A!.corrected_natural_stop_below_3200} | ${byArm.A!.in_target_3200_4200} | ${byArm.A!.below_3200} | ${byArm.A!.above_4200} | ${byArm.A!.median_total_visible_chars} |
| B | ${byArm.B!.old_natural_stop_count_INVALID} | ${byArm.B!.corrected_natural_stop_below_3200} | ${byArm.B!.in_target_3200_4200} | ${byArm.B!.below_3200} | ${byArm.B!.above_4200} | ${byArm.B!.median_total_visible_chars} |
| C | ${byArm.C!.old_natural_stop_count_INVALID} | ${byArm.C!.corrected_natural_stop_below_3200} | ${byArm.C!.in_target_3200_4200} | ${byArm.C!.below_3200} | ${byArm.C!.above_4200} | ${byArm.C!.median_total_visible_chars} |

\`\`\`text
AUDIT56_LENGTH_METRIC_BUG
\`\`\`
`;
  writeFileSync(join(DOCS, "LENGTH_METRIC_CORRECTION.md"), md, "utf8");
  console.log(JSON.stringify({ byArm, rows: rows.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
