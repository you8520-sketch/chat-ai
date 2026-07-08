/**
 * FIXTURE-ONLY regression harness — Leon register, hardcoded example_dialog variants.
 *
 * ⚠ NOT prod/staging-comparable. This builds prompts from fixtures
 * (buildLeonContextWithExampleVariant), NOT from DB Leon + EXAMPLE_DIALOG_SCENE_FILTER.
 * Step 7.6c showed the two paths produce different system prompts (~6.6k vs ~13.5k chars);
 * for any rollout gate use the staging path (scripts/lib/step76LeonStagingContext.ts).
 * Keep only for isolated fixture regressions of example_dialog variants.
 * (Renamed from step76b-bed-n-expansion.ts.)
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/fixture-regression-leon-register.ts --generate --n=12
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { buildLeonContextWithExampleVariant, LEON_SCENES } from "./lib/exampleDialogContextAuditLib";
import { evaluateRegisterCompliance } from "@/lib/characterRegisterCompliance";
import { evaluateStep73Sample } from "@/lib/registerMetaAudit";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const SCENE_ID = "leon-private-1";
const OUT_DIR = join(process.cwd(), "output");
const OUT_JSON = join(OUT_DIR, "step76b-bed-n-expansion.json");
const OUT_MD = join(OUT_DIR, "step76b-bed-n-expansion.md");

type VariantRun = "mixed_baseline" | "tagged_filtered";

type SampleRow = {
  run: number;
  variant: VariantRun;
  sceneId: string;
  compliance: number;
  pass: boolean;
  registerDrift: boolean;
  text: string;
};

function parseN(): number {
  const arg = process.argv.find((a) => a.startsWith("--n="));
  const n = arg ? Number.parseInt(arg.split("=")[1] ?? "12", 10) : 12;
  return Number.isFinite(n) && n >= 10 ? n : 12;
}

function stats(rows: SampleRow[]) {
  const n = rows.length;
  const passCount = rows.filter((r) => r.pass).length;
  const compliances = rows.map((r) => r.compliance);
  const mean = n ? compliances.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n
    ? compliances.reduce((a, c) => a + (c - mean) ** 2, 0) / n
    : 0;
  return {
    n,
    passRate: n ? Math.round((passCount / n) * 1000) / 10 : 0,
    passCount,
    meanCompliance: Math.round(mean * 10) / 10,
    stdDev: Math.round(Math.sqrt(variance) * 10) / 10,
    min: n ? Math.min(...compliances) : 0,
    max: n ? Math.max(...compliances) : 0,
  };
}

async function generateOne(
  variant: VariantRun,
  run: number,
  attempt = 1
): Promise<string> {
  const scene = LEON_SCENES.find((s) => s.id === SCENE_ID);
  if (!scene) throw new Error(`Missing scene ${SCENE_ID}`);

  const exampleVariant = variant === "mixed_baseline" ? "mixed" : "tagged";
  if (variant === "tagged_filtered") {
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";
  } else {
    delete process.env.EXAMPLE_DIALOG_SCENE_FILTER;
  }

  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildLeonContextWithExampleVariant(scene, exampleVariant));

  try {
    const res = await callOpenRouterCompletion({
      system: built.systemPrompt,
      history: built.history,
      model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      temperature: resolveDeepSeekTemperatureForTarget(3200),
      maxTokens: 4096,
      requestKind: `step76b-bed-n-${variant}-run${run}`,
    });
    return res.text.trim();
  } catch (err) {
    if (attempt >= 3) throw err;
    console.warn(`Retry ${variant} run ${run} (${attempt}/3)`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return generateOne(variant, run, attempt + 1);
  }
}

function measure(variant: VariantRun, run: number, text: string): SampleRow {
  const scene = LEON_SCENES.find((s) => s.id === SCENE_ID)!;
  const comp = evaluateRegisterCompliance(text, scene.expectedRegister);
  const reg = evaluateStep73Sample(scene.id, text, scene.genres);
  return {
    run,
    variant,
    sceneId: SCENE_ID,
    compliance: comp.complianceRate,
    pass: comp.complianceRate >= 70 && reg.registerSwitching !== "FAIL",
    registerDrift: comp.driftKinds.length > 0 || reg.registerSwitching === "FAIL",
    text,
  };
}

async function runVariant(variant: VariantRun, targetN: number, doGenerate: boolean): Promise<SampleRow[]> {
  const cachePath = join(OUT_DIR, `step76b-bed-n-${variant}.json`);
  const rows: SampleRow[] = [];
  const cachedRuns = new Set<number>();

  if (existsSync(cachePath)) {
    try {
      const j = JSON.parse(readFileSync(cachePath, "utf8")) as { samples?: SampleRow[] };
      for (const s of j.samples ?? []) {
        if (!s.text) continue;
        rows.push(s);
        cachedRuns.add(s.run);
      }
    } catch {
      /* fresh */
    }
  }

  if (doGenerate) {
    for (let run = 1; run <= targetN; run++) {
      if (cachedRuns.has(run)) {
        console.log(`[${variant}] skip run ${run} (cached)`);
        continue;
      }
      console.log(`[${variant}] run ${run}/${targetN}…`);
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
  const doGenerate = process.argv.includes("--generate");
  const targetN = parseN();
  mkdirSync(OUT_DIR, { recursive: true });
  delete process.env.REGISTER_PATCH;

  const mixed = await runVariant("mixed_baseline", targetN, doGenerate);
  const tagged = await runVariant("tagged_filtered", targetN, doGenerate);

  const mixedStats = stats(mixed);
  const taggedStats = stats(tagged);

  const md = [
    "# Step 7.6b — Bed sample expansion (Step 1)",
    "",
    `Scene: \`${SCENE_ID}\` (침대) · target n=${targetN} per variant`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Results (bed primary)",
    "",
    "| Variant | n | pass rate | mean compliance | std dev | min | max |",
    "|---------|---|-----------|-----------------|---------|-----|-----|",
    `| mixed | ${mixedStats.n} | ${mixedStats.passRate}% (${mixedStats.passCount}/${mixedStats.n}) | ${mixedStats.meanCompliance}% | ${mixedStats.stdDev} | ${mixedStats.min}% | ${mixedStats.max}% |`,
    `| tagged + filter | ${taggedStats.n} | ${taggedStats.passRate}% (${taggedStats.passCount}/${taggedStats.n}) | ${taggedStats.meanCompliance}% | ${taggedStats.stdDev} | ${taggedStats.min}% | ${taggedStats.max}% |`,
    "",
    doGenerate || mixedStats.n >= 10
      ? taggedStats.passRate > mixedStats.passRate
        ? "**Interpretation:** tagged+filter pass rate exceeds mixed baseline across expanded n."
        : "**Interpretation:** tagged+filter did NOT clearly beat mixed at expanded n — review samples."
      : "**Run with `--generate` to collect n≥10 samples.**",
    "",
  ];

  writeFileSync(OUT_MD, md.join("\n"));
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sceneId: SCENE_ID,
        targetN,
        mixedStats,
        taggedStats,
        mixed,
        tagged,
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
