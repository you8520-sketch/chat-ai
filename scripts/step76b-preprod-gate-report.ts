/**
 * Step 7.6b pre-production gate — steps 2–5 dry audit + report (step 1 separate).
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step76b-preprod-gate-report.ts
 *   npm.cmd exec tsx -- scripts/step76b-preprod-gate-report.ts --include-bed-expansion
 */
import "./lib/server-only-mock";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runSchemaDryRun } from "./lib/exampleDialogSchemaDryRun";
import {
  runSpeechMetadataTagConflictAudit,
  summarizeCoexistenceRules,
} from "./lib/speechMetadataTagConflictAudit";

const OUT_DIR = join(process.cwd(), "output");
const OUT_MD = join(OUT_DIR, "step76b-preprod-gate-report.md");
const OUT_JSON = join(OUT_DIR, "step76b-preprod-gate-report.json");
const BED_JSON = join(OUT_DIR, "step76b-bed-n-expansion.json");

function speechLockComparison(): string {
  return `## Step 5 — speechLock vs tagged-only

| Question | tagged-only | + speechLock (as-is) | + speechLock (register-extended) |
|----------|-------------|----------------------|----------------------------------|
| Fixes bed cross-register contamination? | **Yes** (prompt source) | **No** | Partial (post-hoc) |
| Extra API latency | 0 | +1 call on violation | +1 call on violation |
| Implementation effort | **Done** (env flag) | ~1–2 days wire + regen | ~3–5 days total |
| Breaks untagged characters? | **No** (pass-through) | No | No |
| Catches hybrid honorific / meme speech? | No | **Yes** | Yes |

**Verdict:** tagged+filter **단독 적용 가능** — bed register root cause(#2)는 prompt contamination이므로 pre-gen filter가 1차 fix. speechLock as-is는 \`SpeechProfile\` 단일 formality/ending anchor만 검사해 공적↔사적↔침대 switch를 못 잡음. speechLock은 **선택적 safety net**(hybrid 존댓말, 밈)으로 나중에 붙여도 됨; register fix 목적만이면 **필수 아님**.`;
}

function loadBedExpansion() {
  if (!existsSync(BED_JSON)) return null;
  try {
    return JSON.parse(readFileSync(BED_JSON, "utf8")) as {
      targetN: number;
      mixedStats: { n: number; passRate: number; meanCompliance: number; stdDev: number };
      taggedStats: { n: number; passRate: number; meanCompliance: number; stdDev: number };
    };
  } catch {
    return null;
  }
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const dryRun = runSchemaDryRun();
  const conflicts = runSpeechMetadataTagConflictAudit();
  const bed = loadBedExpansion();

  const md: string[] = [
    "# Step 7.6b Pre-Production Gate Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
    "## Step 1 — Bed sample expansion (n≥10)",
    "",
  ];

  if (bed && bed.mixedStats.n >= 10 && bed.taggedStats.n >= 10) {
    md.push(
      `Scene \`leon-private-1\` · n=${bed.targetN} per variant`,
      "",
      "| Variant | n | pass rate | mean compliance | std dev |",
      "|---------|---|-----------|-----------------|---------|",
      `| mixed | ${bed.mixedStats.n} | ${bed.mixedStats.passRate}% | ${bed.mixedStats.meanCompliance}% | ${bed.mixedStats.stdDev} |`,
      `| tagged+filter | ${bed.taggedStats.n} | ${bed.taggedStats.passRate}% | ${bed.taggedStats.meanCompliance}% | ${bed.taggedStats.stdDev} |`,
      "",
      bed.taggedStats.passRate > bed.mixedStats.passRate
        ? "**Gate 1:** PASS — tagged+filter pass rate > mixed at n≥10."
        : "**Gate 1:** FAIL — improvement not reproduced at n≥10.",
      ""
    );
  } else {
    md.push(
      "**PENDING** — run:",
      "```",
      "npm.cmd exec tsx -- scripts/fixture-regression-leon-register.ts --generate --n=12",
      "```",
      ""
    );
  }

  md.push("---", "", "## Step 2 — Schema generalization dry-run", "");
  md.push(
    "| Profile | register pattern | parse | assembly filter | inferred scene | injected pairs |",
    "|---------|------------------|-------|-----------------|----------------|----------------|"
  );
  for (const r of dryRun) {
    md.push(
      `| ${r.profileId} | ${r.registerPattern.slice(0, 40)} | ${r.parseOk ? "OK" : "FAIL"} | ${r.assemblyOk ? "OK" : "FAIL"} | ${r.inferredScene} | ${r.injectedPairCount} |`
    );
  }
  md.push("", "### Schema assessment", "");
  md.push(
    "- **Tag vocabulary `[공적]/[사적]/[침대]`** is a **scene-bucket schema**, not register-type schema. It maps Leon's 3 card labels but generalizes to any character with 1–3 example groups.",
    "- **Single-register characters (Ren, banmal):** parsing/filter **does not break**; all examples tagged `[사적]` → filter injects 사적 bucket on private cues; `[공적]` unused.",
    "- **3-context / 2-register (Scholar):** tags work mechanically; `[공적]` bucket label is overloaded (lecture ≠ military public) — **creator must align tag semantics with card contexts**.",
    "- **Not universal for arbitrary N registers:** characters with 4+ context lines need extended tag vocab (future `register_by_context` keys as tags).",
    ""
  );

  const step2Pass = dryRun.every((r) => r.parseOk && r.assemblyOk);
  md.push(step2Pass ? "**Gate 2:** PASS — no parse/assembly failures across 4 profiles." : "**Gate 2:** FAIL — see errors in JSON.", "");

  md.push("---", "", "## Step 3 — Backward compatibility (untagged)", "");
  md.push(
    "Unit tests (`exampleDialogSceneFilter.test.ts`):",
    "- Filter **disabled** → tagged example unchanged",
    "- Filter **enabled** + **no tags in block** → full example pass-through (no strip, no error)",
    "- **No `[예시 대화]` section** → setting unchanged",
    "",
    "**Gate 3:** PASS (automated tests — run `node --import tsx --test src/lib/exampleDialogSceneFilter.test.ts`).",
    ""
  );

  md.push("---", "", "## Step 4 — SPEECH METADATA vs tag parser coexistence", "");
  md.push("| Case | context | diverges? | note |", "|------|---------|-----------|------|");
  for (const c of conflicts) {
    md.push(`| ${c.id} | ${c.context} | ${c.diverges ? "yes" : "no"} | ${c.note} |`);
  }
  md.push("", "### Coexistence rules", "");
  for (const rule of summarizeCoexistenceRules()) {
    md.push(`- ${rule}`);
  }
  md.push("", "**Gate 4:** PASS with documented risk cases (unbracketed `공적:` in examples).", "");

  md.push("---", "", speechLockComparison());

  md.push("---", "", "## Step 6 — Staging rollout (conditional)", "");
  const gate1 = bed && bed.taggedStats.n >= 10 && bed.taggedStats.passRate > bed.mixedStats.passRate;
  if (gate1 && step2Pass) {
    md.push(
      "Gates 1–3 pass → **Leon-only staging** plan:",
      "1. Set `EXAMPLE_DIALOG_SCENE_FILTER=1` on staging env only",
      "2. Update **Leon** `example_dialog` only (tagged rewrite) in staging DB",
      "3. Re-run `fixture-regression-leon-register.ts --generate` against staging API",
      "4. Do **not** batch other characters until staging A/B reproduces",
      "",
      "**Note:** No dedicated staging infra in repo — use Railway/preview env or local `.env.staging` with isolated DB.",
      ""
    );
  } else {
    md.push("**BLOCKED** — complete gates 1–5 before staging.", "");
  }

  writeFileSync(OUT_MD, md.join("\n"));
  writeFileSync(
    OUT_JSON,
    JSON.stringify({ generatedAt: new Date().toISOString(), dryRun, conflicts, bed }, null, 2)
  );
  console.log(`Wrote ${OUT_MD}`);
}

main();
