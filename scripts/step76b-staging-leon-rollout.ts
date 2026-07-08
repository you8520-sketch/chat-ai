/**
 * Step 7.6b — Staging Leon rollout (local staging DB: DATA_DIR=data).
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step76b-staging-leon-rollout.ts --validate-only
 *   npm.cmd exec tsx -- scripts/step76b-staging-leon-rollout.ts --apply-db
 *   npm.cmd exec tsx -- scripts/step76b-staging-leon-rollout.ts --apply-db --generate --n=12
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { getDb } from "@/lib/db";
import {
  validateBracketTaggedExampleDialog,
} from "@/lib/exampleDialogSceneFilter";
import {
  LEON_EXAMPLE_MIXED,
  LEON_EXAMPLE_TAGGED,
  LEON_SCENES,
  buildLeonContextWithExampleVariant,
} from "./lib/exampleDialogContextAuditLib";
import {
  classifyLineRegister,
  evaluateRegisterCompliance,
} from "@/lib/characterRegisterCompliance";
import { evaluateStep73Sample } from "@/lib/registerMetaAudit";
import { extractDialogueLines } from "@/lib/registerMetaAudit";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import type { ContextBuildInput } from "@/types";
import type { RegisterValidationScene } from "./lib/leon-ren-register-fixtures";
import {
  buildStagingContextFromDb,
  LEON_STAGING_CHARACTER_ID,
} from "./lib/step76LeonStagingContext";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";

const SCENE_ID = "leon-private-1";
const OUT_DIR = join(process.cwd(), "output");
const OUT_MD = join(OUT_DIR, "step76b-staging-leon-rollout.md");
const OUT_JSON = join(OUT_DIR, "step76b-staging-leon-rollout.json");
const LOCAL_BASELINE_PASS = 41.7;

export const LEON_STAGING_TAGGED_EXAMPLE = LEON_EXAMPLE_TAGGED;

type VariantRun = "mixed_baseline" | "staging_tagged_db";

type SampleRow = {
  run: number;
  variant: VariantRun;
  compliance: number;
  pass: boolean;
  registerDrift: boolean;
  failurePatterns: string[];
  text: string;
};

function parseN(): number {
  const arg = process.argv.find((a) => a.startsWith("--n="));
  const n = arg ? Number.parseInt(arg.split("=")[1] ?? "12", 10) : 12;
  return Number.isFinite(n) && n >= 10 ? n : 12;
}

function gateStep4(): void {
  const v = validateBracketTaggedExampleDialog(LEON_STAGING_TAGGED_EXAMPLE);
  if (!v.valid) {
    console.error("Step 4 gate FAILED — Leon tagged example invalid:");
    for (const e of v.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `Step 4 gate PASS — ${v.bracketTagLineCount} bracket tags, 0 unbracketed context lines`
  );
}

function applyLeonStagingExampleDialog(): { id: number; name: string; before: string; after: string } {
  const db = getDb();
  const row = db
    .prepare(`SELECT id, name, example_dialog FROM characters WHERE id = ?`)
    .get(LEON_STAGING_CHARACTER_ID) as { id: number; name: string; example_dialog: string } | undefined;

  if (!row) {
    throw new Error(`Leon staging character id=${LEON_STAGING_CHARACTER_ID} not found`);
  }
  if (row.name !== "레온") {
    throw new Error(`Safety: character id=${row.id} name="${row.name}" is not 레온 — abort`);
  }

  const before = row.example_dialog ?? "";
  db.prepare(`UPDATE characters SET example_dialog = ? WHERE id = ?`).run(
    LEON_STAGING_TAGGED_EXAMPLE,
    row.id
  );

  const after = (
    db.prepare(`SELECT example_dialog FROM characters WHERE id = ?`).get(row.id) as {
      example_dialog: string;
    }
  ).example_dialog;

  const verify = validateBracketTaggedExampleDialog(after);
  if (!verify.valid) {
    throw new Error(`DB write verification failed: ${verify.errors.join("; ")}`);
  }

  return { id: row.id, name: row.name, before, after };
}

function classifyFailurePatterns(text: string, expected: "haeyo"): string[] {
  const patterns = new Set<string>();
  for (const line of extractDialogueLines(text)) {
    const reg = classifyLineRegister(line);
    if (reg === "banmal") patterns.add("banmal");
    if (reg === "danakka") patterns.add("danakka_drift");
    if (reg === "formal") patterns.add("formal_drift");
    if (reg === "haeyo") patterns.add("haeyo_ok");
    if (reg === "other") patterns.add("unclassified");
    if (expected === "haeyo" && (reg === "danakka" || reg === "formal" || reg === "banmal")) {
      patterns.add("wrong_register");
    }
  }
  if (extractDialogueLines(text).length === 0) patterns.add("no_dialogue");
  return [...patterns];
}

async function generateOne(variant: VariantRun, run: number, attempt = 1): Promise<string> {
  const scene = LEON_SCENES.find((s) => s.id === SCENE_ID);
  if (!scene) throw new Error(`Missing scene ${SCENE_ID}`);

  process.env.EXAMPLE_DIALOG_SCENE_FILTER = variant === "staging_tagged_db" ? "1" : "0";

  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { buildContext } = await import("@/services/contextBuilder");

  const input =
    variant === "staging_tagged_db"
      ? buildStagingContextFromDb(scene)
      : buildLeonContextWithExampleVariant(scene, "mixed");

  const built = buildContext(input);

  try {
    const res = await callOpenRouterCompletion({
      system: built.systemPrompt,
      history: built.history,
      model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      temperature: resolveDeepSeekTemperatureForTarget(3200),
      maxTokens: 4096,
      requestKind: `step76b-staging-${variant}-run${run}`,
    });
    return res.text.trim();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return generateOne(variant, run, attempt + 1);
  }
}

function measure(variant: VariantRun, run: number, text: string): SampleRow {
  const scene = LEON_SCENES.find((s) => s.id === SCENE_ID)!;
  const comp = evaluateRegisterCompliance(text, scene.expectedRegister);
  const reg = evaluateStep73Sample(scene.id, text, scene.genres);
  const failurePatterns = classifyFailurePatterns(text, "haeyo");
  if (!comp.driftKinds.length && comp.complianceRate >= 70) {
    /* pass */
  } else {
    for (const k of comp.driftKinds) failurePatterns.push(`drift_${k}`);
  }
  return {
    run,
    variant,
    compliance: comp.complianceRate,
    pass: comp.complianceRate >= 70 && reg.registerSwitching !== "FAIL",
    registerDrift: comp.driftKinds.length > 0 || reg.registerSwitching === "FAIL",
    failurePatterns: [...new Set(failurePatterns)],
    text,
  };
}

function stats(rows: SampleRow[]) {
  const n = rows.length;
  const passCount = rows.filter((r) => r.pass).length;
  const compliances = rows.map((r) => r.compliance);
  const mean = n ? compliances.reduce((a, b) => a + b, 0) / n : 0;
  return {
    n,
    passRate: n ? Math.round((passCount / n) * 1000) / 10 : 0,
    passCount,
    meanCompliance: Math.round(mean * 10) / 10,
  };
}

function aggregateFailurePatterns(rows: SampleRow[]): { pattern: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows.filter((x) => !x.pass)) {
    for (const p of r.failurePatterns) {
      if (p === "haeyo_ok") continue;
      map.set(p, (map.get(p) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);
}

async function runVariant(
  variant: VariantRun,
  targetN: number,
  doGenerate: boolean
): Promise<SampleRow[]> {
  const cachePath = join(OUT_DIR, `step76b-staging-${variant}.json`);
  const rows: SampleRow[] = [];
  const cached = new Set<number>();

  if (existsSync(cachePath)) {
    try {
      const j = JSON.parse(readFileSync(cachePath, "utf8")) as { samples?: SampleRow[] };
      for (const s of j.samples ?? []) {
        if (!s.text) continue;
        rows.push(s);
        cached.add(s.run);
      }
    } catch {
      /* fresh */
    }
  }

  if (doGenerate) {
    for (let run = 1; run <= targetN; run++) {
      if (cached.has(run)) continue;
      console.log(`[staging ${variant}] run ${run}/${targetN}…`);
      const text = await generateOne(variant, run);
      rows.push(measure(variant, run, text));
      rows.sort((a, b) => a.run - b.run);
      writeFileSync(cachePath, JSON.stringify({ variant, samples: rows }, null, 2));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return rows.sort((a, b) => a.run - b.run);
}

async function main() {
  const validateOnly = process.argv.includes("--validate-only");
  const applyDb = process.argv.includes("--apply-db");
  const doGenerate = process.argv.includes("--generate");
  const targetN = parseN();
  mkdirSync(OUT_DIR, { recursive: true });

  gateStep4();

  if (validateOnly) {
    console.log("Validate-only complete.");
    return;
  }

  let dbApply: ReturnType<typeof applyLeonStagingExampleDialog> | null = null;
  if (applyDb) {
    dbApply = applyLeonStagingExampleDialog();
    console.log(`Staging DB updated: character id=${dbApply.id} (${dbApply.name})`);
  } else if (doGenerate) {
    const db = getDb();
    const row = db
      .prepare(`SELECT example_dialog FROM characters WHERE id = ?`)
      .get(LEON_STAGING_CHARACTER_ID) as { example_dialog: string } | undefined;
    const v = validateBracketTaggedExampleDialog(row?.example_dialog ?? "");
    if (!v.valid) {
      console.error("Run with --apply-db first (Leon example_dialog not tagged in DB)");
      process.exit(1);
    }
  }

  let mixed: SampleRow[] = [];
  let staging: SampleRow[] = [];

  mixed = await runVariant("mixed_baseline", targetN, doGenerate);
  staging = await runVariant("staging_tagged_db", targetN, doGenerate);

  const mixedStats = stats(mixed);
  const stagingStats = stats(staging);
  const stagingFails = aggregateFailurePatterns(staging);
  const mixedFails = aggregateFailurePatterns(mixed);

  const stagingFailDetail = staging
    .filter((r) => !r.pass)
    .map((r) => ({
      run: r.run,
      compliance: r.compliance,
      patterns: r.failurePatterns.filter((p) => p !== "haeyo_ok"),
      dialogueSample: extractDialogueLines(r.text).slice(0, 4),
    }));

  const mixedFailDetail = mixed
    .filter((r) => !r.pass)
    .map((r) => ({
      run: r.run,
      compliance: r.compliance,
      patterns: r.failurePatterns.filter((p) => p !== "haeyo_ok"),
      dialogueSample: extractDialogueLines(r.text).slice(0, 4),
    }));

  const vsBaseline =
    stagingStats.n >= 10
      ? stagingStats.passRate >= LOCAL_BASELINE_PASS
        ? stagingStats.passRate > LOCAL_BASELINE_PASS
          ? "above_local_baseline"
          : "near_local_baseline"
        : "below_local_baseline"
      : "insufficient_n";

  const md = [
    "# Step 7.6b — Staging Leon Rollout",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Pre-deploy gate (Step 4)",
    "",
    "- Bracket-only tag parser deployed (`공적:` card prose no longer matches)",
    `- Leon tagged example validation: **PASS** (${validateBracketTaggedExampleDialog(LEON_STAGING_TAGGED_EXAMPLE).bracketTagLineCount} bracket tags)`,
    "",
    "## Staging config",
    "",
    `- \`EXAMPLE_DIALOG_SCENE_FILTER=1\``,
    `- Character: id=${LEON_STAGING_CHARACTER_ID} (레온) example_dialog tagged rewrite${dbApply ? " **applied**" : ""}`,
    `- DATA_DIR: ${process.env.DATA_DIR ?? "(default)"}`,
    "",
    "## Bed remeasure (n=" + targetN + ")",
    "",
    "| Variant | n | pass rate | mean compliance |",
    "|---------|---|-----------|-----------------|",
    `| mixed (fixture baseline) | ${mixedStats.n} | ${mixedStats.passRate}% | ${mixedStats.meanCompliance}% |`,
    `| staging tagged (DB Leon + filter) | ${stagingStats.n} | ${stagingStats.passRate}% | ${stagingStats.meanCompliance}% |`,
    "",
    `Local harness baseline (prior): tagged+filter **${LOCAL_BASELINE_PASS}%** pass`,
    "",
    `**vs baseline:** ${vsBaseline}`,
    "",
    "### Staging failure patterns (non-pass runs)",
    "",
    stagingFails.length
      ? stagingFails.map((p) => `- ${p.pattern}: ${p.count}/${stagingStats.n - stagingStats.passCount} fails`).join("\n")
      : "- (none — all pass or no samples)",
    "",
    stagingFailDetail.length
      ? "**Per-run dialogue samples (staging fails):**\n" +
        stagingFailDetail
          .map(
            (r) =>
              `- run ${r.run} (${r.compliance}%): ${r.patterns.join(", ") || "low_compliance"} → ${r.dialogueSample.map((d) => `"${d.slice(0, 40)}"`).join(", ")}`
          )
          .join("\n")
      : "",
    "",
    "### Mixed baseline failure patterns (comparison)",
    "",
    mixedFails.length
      ? mixedFails.map((p) => `- ${p.pattern}: ${p.count}/${mixedStats.n - mixedStats.passCount} fails`).join("\n")
      : "- (none)",
    "",
    mixedFailDetail.length
      ? "**Per-run dialogue samples (mixed fails):**\n" +
        mixedFailDetail
          .map(
            (r) =>
              `- run ${r.run} (${r.compliance}%): ${r.patterns.join(", ") || "low_compliance"} → ${r.dialogueSample.map((d) => `"${d.slice(0, 40)}"`).join(", ")}`
          )
          .join("\n")
      : "",
    "",
    "## Next step per gate rules",
    "",
    vsBaseline === "below_local_baseline"
      ? "**Investigate environment difference first** — do not tune filter yet."
      : vsBaseline === "near_local_baseline" || vsBaseline === "above_local_baseline"
        ? "**Filter tuning discussion** may start if needed (bed fallback, cue regex)."
        : "Run `--apply-db --generate` to collect samples.",
    "",
  ];

  writeFileSync(OUT_MD, md.join("\n"));
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dbApply,
        mixedStats,
        stagingStats,
        vsBaseline,
        stagingFails,
        mixedFails,
        stagingFailDetail,
        mixedFailDetail,
        mixed,
        staging,
      },
      null,
      2
    )
  );

  console.log(`Wrote ${OUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
