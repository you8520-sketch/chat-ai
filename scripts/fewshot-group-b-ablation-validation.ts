import "./lib/server-only-mock";

/**
 * Step 7.7 Group B — explain vs show few-shot ablation (Leon, staging path).
 *
 * Hypothesis: show-don't-tell few-shot reduces Group B explanatory meta in output.
 * Methodology mirrors Step 6 hand vs space ablation (paired before/after, one variable).
 *
 * 2 scenes × 5 runs × Before/After = 10 pairs (20 API)
 *
 * Group A (SPEECH_LOCK_NARRATION_LEXICON) untouched — only example_dialog varies.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/fewshot-group-b-ablation-validation.ts --dry-run
 *   npm.cmd exec tsx -- scripts/fewshot-group-b-ablation-validation.ts --fresh --runs=5
 *   npm.cmd exec tsx -- scripts/fewshot-group-b-ablation-validation.ts --analyze-only
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  GROUP_B_ABLATION_SCENES,
  LEON_FEWSHOT_EXPLAIN_BASELINE,
  LEON_FEWSHOT_SHOW_TREATMENT,
  leonGroupBFewShotExample,
  leonGroupBShowMergedForProduction,
  type GroupBFewShotVariant,
} from "./lib/fewshot-group-b-ablation-fixture";
import {
  GROUP_B_PRIMARY_METRIC_DEFS,
  GROUP_B_SECONDARY_METRIC_DEFS,
  analyzeGroupBMetaAudit,
  countExplainLexInExample,
  countShowLexInExample,
  type GroupBMetaMetrics,
} from "./lib/group-b-meta-audit-metrics";
import { buildLeonGroupBAblationContext } from "./lib/step76LeonStagingContext";
import { buildPairedMetricReport, type PairedMetricReport } from "./lib/paired-comparison-stats";
import { improvementDelta, isAfterBetter } from "./lib/prose-variation-metrics";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { evaluateRegisterCompliance, type ExpectedRegister } from "@/lib/characterRegisterCompliance";
import { detectRegisterLexiconInNarration } from "@/lib/speechLock/narrationLexicon";
import { validateBracketTaggedExampleDialog } from "@/lib/exampleDialogSceneFilter";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/dataDir";
import { LEON_STAGING_CHARACTER_ID } from "./lib/step76LeonStagingContext";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.DATA_DIR) process.env.DATA_DIR = "data";

process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";

const TEMPERATURE = 0.85;
const DEFAULT_RUNS = 5;

type SampleMetrics = GroupBMetaMetrics & {
  groupALexiconHitCount: number;
  registerComplianceRate: number;
};

type SampleRecord = {
  sceneId: string;
  runIndex: number;
  version: "before" | "after";
  text: string;
  metrics: SampleMetrics;
};

type PairRecord = {
  sceneId: string;
  sceneLabel: string;
  runIndex: number;
  before: SampleRecord;
  after: SampleRecord;
};

type Checkpoint = {
  model: string;
  temperature: number;
  runsPerScene: number;
  pairs: PairRecord[];
};

function parseRunsArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (!arg) return DEFAULT_RUNS;
  const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUNS;
}

function pairKey(sceneId: string, runIndex: number): string {
  return `${sceneId}#${runIndex}`;
}

async function generateSample(
  callOpenRouterCompletion: typeof import("@/lib/openRouterCompletion").callOpenRouterCompletion,
  model: string,
  system: string,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await callOpenRouterCompletion({
        system,
        history,
        model,
        temperature: TEMPERATURE,
        maxTokens: 4096,
        requestKind: "fewshot-group-b-ablation-validation",
      });
      const text = res.text.trim();
      if (text.length >= 200) return text;
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw new Error("Completion too short after retries");
}

function analyzeSample(text: string, expectedRegister: ExpectedRegister): SampleMetrics {
  const base = analyzeGroupBMetaAudit(text);
  const lex = detectRegisterLexiconInNarration(text);
  const reg = evaluateRegisterCompliance(text, expectedRegister);
  return {
    ...base,
    groupALexiconHitCount: lex.fail ? lex.hits.length : 0,
    registerComplianceRate: reg.complianceRate,
  };
}

type ExtendedMetricDef = {
  key: keyof SampleMetrics;
  label: string;
  higherIsBetter: boolean;
  secondary?: boolean;
};

const EXTENDED_METRIC_DEFS: ExtendedMetricDef[] = [
  ...GROUP_B_PRIMARY_METRIC_DEFS.map((d) => ({ ...d, secondary: false })),
  ...GROUP_B_SECONDARY_METRIC_DEFS.map((d) => ({ ...d, secondary: true })),
  {
    key: "groupALexiconHitCount",
    label: "Group A lexicon hits (narration)",
    higherIsBetter: false,
    secondary: true,
  },
  {
    key: "registerComplianceRate",
    label: "Register compliance % (haeyo)",
    higherIsBetter: true,
    secondary: true,
  },
];

function buildReports(pairs: PairRecord[]): PairedMetricReport[] {
  return EXTENDED_METRIC_DEFS.map((def) => {
    const beforeValues: number[] = [];
    const afterValues: number[] = [];
    const improvements: number[] = [];
    let wins = 0;
    let ties = 0;

    for (const pair of pairs) {
      const b = pair.before.metrics[def.key];
      const a = pair.after.metrics[def.key];
      beforeValues.push(b);
      afterValues.push(a);
      const imp = improvementDelta(b, a, def.higherIsBetter);
      improvements.push(imp);
      if (b === a) ties++;
      else if (isAfterBetter(b, a, def.higherIsBetter)) wins++;
    }

    return buildPairedMetricReport({
      metricKey: def.key,
      label: def.label,
      higherIsBetter: def.higherIsBetter,
      beforeValues,
      afterValues,
      improvements,
      wins,
      ties,
    });
  });
}

function evaluateGroupBAblation(reports: PairedMetricReport[]): {
  keep: boolean;
  reason: string;
  improvedSig: number;
  worseSig: number;
} {
  const primary = reports.find((r) => r.metricKey === "groupBMetaCount");
  const regCompliance = reports.find((r) => r.metricKey === "registerComplianceRate");
  const groupALex = reports.find((r) => r.metricKey === "groupALexiconHitCount");

  const secondaryKeys = new Set([
    "registerLabelInNarration",
    "groupALexiconHitCount",
    "registerComplianceRate",
  ]);
  const worseSig = reports.filter(
    (r) => r.significantAt95 && r.verdict === "worse" && secondaryKeys.has(r.metricKey)
  );
  const worsePrimary = reports.filter(
    (r) =>
      r.significantAt95 &&
      r.verdict === "worse" &&
      GROUP_B_PRIMARY_METRIC_DEFS.some((d) => d.key === r.metricKey)
  );
  const improvedSig = reports.filter(
    (r) =>
      r.significantAt95 &&
      r.verdict === "improved" &&
      GROUP_B_PRIMARY_METRIC_DEFS.some((d) => d.key === r.metricKey)
  );

  if (worsePrimary.length > 0) {
    return {
      keep: false,
      reason: `Primary regression: ${worsePrimary.map((r) => r.label).join(", ")}`,
      improvedSig: improvedSig.length,
      worseSig: worsePrimary.length + worseSig.length,
    };
  }

  if (worseSig.length > 0) {
    return {
      keep: false,
      reason: `Side-effect regression: ${worseSig.map((r) => r.label).join(", ")}`,
      improvedSig: improvedSig.length,
      worseSig: worseSig.length,
    };
  }

  if (regCompliance && regCompliance.improvement.mean < -5 && regCompliance.winRate < 0.45) {
    return {
      keep: false,
      reason: `Register drift: compliance ${regCompliance.before.mean}% → ${regCompliance.after.mean}% (winRate ${(regCompliance.winRate * 100).toFixed(0)}%)`,
      improvedSig: improvedSig.length,
      worseSig: 0,
    };
  }

  if (groupALex && groupALex.after.mean > groupALex.before.mean && groupALex.winRate < 0.4) {
    return {
      keep: false,
      reason: `Group A lexicon hits increased ${groupALex.before.mean} → ${groupALex.after.mean}`,
      improvedSig: improvedSig.length,
      worseSig: 0,
    };
  }

  if (primary?.significantAt95 && primary.verdict === "improved") {
    return {
      keep: true,
      reason: `Hypothesis supported: ${primary.label} reduced (p=${primary.pairedTPValue})`,
      improvedSig: improvedSig.length,
      worseSig: 0,
    };
  }

  return {
    keep: false,
    reason: "Hypothesis not confirmed — primary metric not significant at p<0.05",
    improvedSig: improvedSig.length,
    worseSig: 0,
  };
}

function applyLeonShowMergedExampleDialog(): {
  applied: boolean;
  before: string;
  after: string;
  charLengthBefore: number;
  charLengthAfter: number;
} {
  const merged = leonGroupBShowMergedForProduction();
  const v = validateBracketTaggedExampleDialog(merged);
  if (!v.valid) throw new Error(`Show merge invalid: ${v.errors.join("; ")}`);

  const db = getDb();
  const row = db
    .prepare(`SELECT id, name, example_dialog FROM characters WHERE id = ?`)
    .get(LEON_STAGING_CHARACTER_ID) as
    | { id: number; name: string; example_dialog: string }
    | undefined;
  if (!row) throw new Error(`Leon id=${LEON_STAGING_CHARACTER_ID} not found in ${getDataDir()}`);
  if (row.name !== "레온") throw new Error(`Safety: id=${row.id} name="${row.name}" is not 레온`);

  const before = row.example_dialog ?? "";
  const alreadyApplied = before.trim() === merged.trim();
  if (!alreadyApplied) {
    db.prepare(`UPDATE characters SET example_dialog = ? WHERE id = ?`).run(merged, row.id);
  }
  return {
    applied: !alreadyApplied,
    before,
    after: merged,
    charLengthBefore: before.length,
    charLengthAfter: merged.length,
  };
}

function loadStep6Comparison(): Record<string, unknown> | null {
  const p = join(process.cwd(), "output", "fewshot-hand-ablation-validation.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  const analyzeOnly = process.argv.includes("--analyze-only");
  const fresh = process.argv.includes("--fresh");
  const dryRun = process.argv.includes("--dry-run");
  const runsPerScene = parseRunsArg();
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "fewshot-group-b-ablation-checkpoint.json");
  const resultPath = join(outDir, "fewshot-group-b-ablation-validation.json");
  const mdPath = join(outDir, "fewshot-group-b-ablation-validation.md");

  writeFileSync(join(outDir, "fewshot-group-b-explain-baseline.txt"), LEON_FEWSHOT_EXPLAIN_BASELINE, "utf8");
  writeFileSync(join(outDir, "fewshot-group-b-show-treatment.txt"), LEON_FEWSHOT_SHOW_TREATMENT, "utf8");
  writeFileSync(
    join(outDir, "fewshot-group-b-show-merged-production.txt"),
    leonGroupBShowMergedForProduction(),
    "utf8"
  );

  const { buildContext } = await import("@/services/contextBuilder");

  function systemForVariant(
    variant: GroupBFewShotVariant | "show-merged",
    sceneId: string
  ): {
    system: string;
    history: { role: "user" | "assistant"; content: string }[];
    expectedRegister: ExpectedRegister;
  } {
    const scene = GROUP_B_ABLATION_SCENES.find((s) => s.id === sceneId)!;
    const example =
      variant === "show-merged"
        ? leonGroupBShowMergedForProduction()
        : leonGroupBFewShotExample(variant);
    const built = buildContext(buildLeonGroupBAblationContext(scene, example));
    return {
      system: built.systemPrompt,
      history: built.history
        .filter((m): m is { role: "user" | "assistant"; content: string } =>
          (m.role === "user" || m.role === "assistant") && Boolean(m.content?.trim())
        )
        .map((m) => ({ role: m.role, content: m.content ?? "" })),
      expectedRegister: scene.expectedRegister,
    };
  }

  const baselineLen = systemForVariant("explain-baseline", GROUP_B_ABLATION_SCENES[0]!.id).system
    .length;
  const treatmentLen = systemForVariant("show-merged", GROUP_B_ABLATION_SCENES[0]!.id).system.length;
  const totalPairs = GROUP_B_ABLATION_SCENES.length * runsPerScene;
  const totalApiCalls = totalPairs * 2;

  console.log("=== Few-shot Group B Ablation (Explain → Show merged) ===");
  console.log("Leon staging path | EXAMPLE_DIALOG_SCENE_FILTER=1 | Group A env untouched");
  console.log(`After arm: show merged production candidate (${leonGroupBShowMergedForProduction().length} chars)`);
  console.log(`Explain baseline: harness-only, never written to DB`);
  console.log(`Scenes: ${GROUP_B_ABLATION_SCENES.map((s) => s.id).join(", ")} | Runs: ${runsPerScene} | API: ${totalApiCalls}`);
  console.log(`Example explain-lex: ${countExplainLexInExample(LEON_FEWSHOT_EXPLAIN_BASELINE)}`);
  console.log(`Example show-lex: ${countShowLexInExample(LEON_FEWSHOT_SHOW_TREATMENT)}`);
  console.log(`System len: ${baselineLen} → ${treatmentLen} (Δ${treatmentLen - baselineLen})`);

  if (dryRun) {
    console.log("\n--dry-run: skipping API");
    return;
  }

  if (fresh && existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
    console.log("\nCleared checkpoint (--fresh)");
  }

  let checkpoint: Checkpoint;

  if (analyzeOnly) {
    if (!existsSync(checkpointPath)) {
      console.error("No checkpoint");
      process.exit(1);
    }
    checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint;
  } else {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      console.error("OPENROUTER_API_KEY required");
      process.exit(1);
    }
    const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
    const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;

    const existing = fresh
      ? null
      : (JSON.parse(
          existsSync(checkpointPath) ? readFileSync(checkpointPath, "utf8") : "null"
        ) as Checkpoint | null);

    checkpoint = {
      model,
      temperature: TEMPERATURE,
      runsPerScene,
      pairs: existing?.pairs ?? [],
    };

    const doneKeys = new Set(checkpoint.pairs.map((p) => pairKey(p.sceneId, p.runIndex)));
    let completed = doneKeys.size;

    for (const scene of GROUP_B_ABLATION_SCENES) {
      const beforeCtx = systemForVariant("explain-baseline", scene.id);
      const afterCtx = systemForVariant("show-merged", scene.id);

      for (let runIndex = 0; runIndex < runsPerScene; runIndex++) {
        const key = pairKey(scene.id, runIndex);
        if (doneKeys.has(key)) continue;

        console.log(
          `[${++completed}/${totalPairs}] ${scene.id} run ${runIndex + 1}/${runsPerScene} | API ${completed * 2 - 1}-${completed * 2}/${totalApiCalls}`
        );

        const beforeText = await generateSample(
          callOpenRouterCompletion,
          model,
          beforeCtx.system,
          beforeCtx.history
        );
        const afterText = await generateSample(
          callOpenRouterCompletion,
          model,
          afterCtx.system,
          afterCtx.history
        );

        checkpoint.pairs.push({
          sceneId: scene.id,
          sceneLabel: scene.label,
          runIndex,
          before: {
            sceneId: scene.id,
            runIndex,
            version: "before",
            text: beforeText,
            metrics: analyzeSample(beforeText, beforeCtx.expectedRegister),
          },
          after: {
            sceneId: scene.id,
            runIndex,
            version: "after",
            text: afterText,
            metrics: analyzeSample(afterText, afterCtx.expectedRegister),
          },
        });
        doneKeys.add(key);
        writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
      }
    }
  }

  const reports = buildReports(checkpoint.pairs);
  const verdict = evaluateGroupBAblation(reports);

  const step6 = loadStep6Comparison();
  const primaryReports = reports.filter((r) =>
    GROUP_B_PRIMARY_METRIC_DEFS.some((d) => d.key === r.metricKey)
  );
  const secondaryReports = reports.filter((r) =>
    GROUP_B_SECONDARY_METRIC_DEFS.some((d) => d.key === r.metricKey) ||
    r.metricKey === "groupALexiconHitCount" ||
    r.metricKey === "registerComplianceRate"
  );

  const result = {
    test: "fewshot-group-b-explain-vs-show-ablation",
    hypothesis:
      "show-don't-tell Leon few-shot (merged production candidate) reduces Group B explanatory meta vs explain-heavy few-shot",
    harnessPath: "staging_db_leon",
    dataDir: process.env.DATA_DIR ?? "data",
    leonCharacterId: LEON_STAGING_CHARACTER_ID,
    explainBaselineInDb: false,
    afterArmExample: "show-merged-production",
    afterArmExampleChars: leonGroupBShowMergedForProduction().length,
    model: checkpoint.model,
    temperature: checkpoint.temperature,
    runsPerScene: checkpoint.runsPerScene,
    scenes: GROUP_B_ABLATION_SCENES.map((s) => s.id),
    pairedSamples: checkpoint.pairs.length,
    exampleDialog: {
      explainLex: countExplainLexInExample(LEON_FEWSHOT_EXPLAIN_BASELINE),
      showLex: countShowLexInExample(LEON_FEWSHOT_SHOW_TREATMENT),
    },
    primaryMetrics: primaryReports,
    secondaryMetrics: secondaryReports,
    metrics: reports,
    verdict,
    step6FixtureComparison: step6
      ? {
          step6Harness: "fixture-only synthetic 카일 (~6819 tok)",
          step6PrimaryMetric: "touch share",
          step6TouchShare: (step6.metrics as PairedMetricReport[] | undefined)?.find(
            (m) => m.metricKey === "touchShare"
          ),
          note: "Step 6 p≈0.0003 was isolated minimal harness; compare effect sizes cautiously",
        }
      : null,
    pairs: checkpoint.pairs,
    dbApply: null as Record<string, unknown> | null,
  };

  const md: string[] = [
    "# Step 7.7 Group B — explain vs show few-shot ablation (staging path)",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Harness: DB Leon id=${LEON_STAGING_CHARACTER_ID} + EXAMPLE_DIALOG_SCENE_FILTER=1`,
    `Paired samples: ${checkpoint.pairs.length} | API calls: ${checkpoint.pairs.length * 2}`,
    `After arm: show merged production (${leonGroupBShowMergedForProduction().length} chars) — explain baseline **never** in DB`,
    "",
    "## Primary metrics (Group B meta)",
    "",
    "| metric | before | after | Δ mean | winRate | p | verdict |",
    "|--------|--------|-------|--------|---------|---|---------|",
  ];
  for (const r of primaryReports) {
    const sig = r.significantAt95 ? "*" : "";
    md.push(
      `| ${r.label}${sig} | ${r.before.mean} | ${r.after.mean} | ${r.improvement.mean} | ${(r.winRate * 100).toFixed(0)}% | ${r.pairedTPValue} | ${r.verdict} |`
    );
  }
  md.push(
    "",
    "## Secondary (Group A lexicon + register drift)",
    "",
    "| metric | before | after | Δ mean | winRate | p | verdict |",
    "|--------|--------|-------|--------|---------|---|---------|"
  );
  for (const r of secondaryReports) {
    const sig = r.significantAt95 ? "*" : "";
    md.push(
      `| ${r.label}${sig} | ${r.before.mean} | ${r.after.mean} | ${r.improvement.mean} | ${(r.winRate * 100).toFixed(0)}% | ${r.pairedTPValue} | ${r.verdict} |`
    );
  }

  if (step6) {
    const touch = (step6.metrics as PairedMetricReport[] | undefined)?.find(
      (m) => m.metricKey === "touchShare"
    );
    md.push(
      "",
      "## Step 6 fixture vs this run (methodology comparison)",
      "",
      "| | Step 6 hand→space | Step 7.7 Group B (this run) |",
      "|---|---|---|",
      "| Harness | fixture-only 카일 (~6.8k tok) | staging DB Leon (~9.7k tok) |",
      "| Primary metric | touch share | Group B meta hits |",
      touch
        ? `| Step 6 touch share | ${touch.before.mean} → ${touch.after.mean} (p=${touch.pairedTPValue}, win ${(touch.winRate * 100).toFixed(0)}%) | — |`
        : "| Step 6 touch share | (see fewshot-hand-ablation-validation.json) | — |",
      primaryReports[0]
        ? `| This run Group B meta | — | ${primaryReports[0].before.mean} → ${primaryReports[0].after.mean} (p=${primaryReports[0].pairedTPValue}, win ${(primaryReports[0].winRate * 100).toFixed(0)}%) |`
        : ""
    );
  }

  md.push(
    "",
    `## Verdict: **${verdict.keep ? "HYPOTHESIS SUPPORTED" : "NOT CONFIRMED"}**`,
    "",
    verdict.reason,
    ""
  );

  if (verdict.keep) {
    const dbApply = applyLeonShowMergedExampleDialog();
    result.dbApply = dbApply;
    md.push(
      "",
      "## DB apply (local only)",
      "",
      `- applied: ${dbApply.applied}`,
      `- example_dialog: ${dbApply.charLengthBefore} → ${dbApply.charLengthAfter} chars`,
      ""
    );
    console.log(
      `\nApplied show merged to local DB Leon: ${dbApply.charLengthBefore} → ${dbApply.charLengthAfter} chars (applied=${dbApply.applied})`
    );
  } else {
    md.push("", "## DB apply", "", "Skipped — verdict not supported. Current tagged example_dialog unchanged.", "");
    console.log("\nDB unchanged — hypothesis not confirmed or side-effect regression.");
  }

  writeFileSync(mdPath, md.join("\n"), "utf8");
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  console.log("\n=== Primary Group B Metrics ===");
  for (const r of primaryReports) {
    const sig = r.significantAt95 ? "*" : "";
    console.log(
      `${r.label}${sig}: before=${r.before.mean} after=${r.after.mean} Δ=${r.improvement.mean} winRate=${(r.winRate * 100).toFixed(0)}% p=${r.pairedTPValue} ${r.verdict}`
    );
  }

  console.log("\n=== Secondary (lexicon + register) ===");
  for (const r of secondaryReports) {
    const sig = r.significantAt95 ? "*" : "";
    console.log(
      `${r.label}${sig}: before=${r.before.mean} after=${r.after.mean} Δ=${r.improvement.mean} winRate=${(r.winRate * 100).toFixed(0)}% p=${r.pairedTPValue} ${r.verdict}`
    );
  }

  console.log(`\n=== Verdict: ${verdict.keep ? "HYPOTHESIS SUPPORTED" : "NOT CONFIRMED"} ===`);
  console.log(verdict.reason);
  console.log(`Wrote ${resultPath}`);

  process.exit(verdict.keep ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
