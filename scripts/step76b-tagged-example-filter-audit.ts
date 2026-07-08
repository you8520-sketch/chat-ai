/**
 * Step 7.6b — Tagged example_dialog + assembly filter audit.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step76b-tagged-example-filter-audit.ts
 *   npm.cmd exec tsx -- scripts/step76b-tagged-example-filter-audit.ts --generate
 *   npm.cmd exec tsx -- scripts/step76b-tagged-example-filter-audit.ts --generate --bed-only
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  analyzeExampleContamination,
  buildLeonContextWithExampleVariant,
  extractFilteredCanonExampleBlock,
  LEON_EXAMPLE_MIXED,
  LEON_EXAMPLE_TAGGED,
  LEON_SCENES,
  predictFromExamplesOnly,
  summarizeVariantCompliance,
  type ExampleDialogVariant,
} from "./lib/exampleDialogContextAuditLib";
import { evaluateRegisterCompliance } from "@/lib/characterRegisterCompliance";
import { evaluateStep73Sample } from "@/lib/registerMetaAudit";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import { inferSceneRegisterContext } from "@/lib/exampleDialogSceneFilter";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_DIR = join(process.cwd(), "output");
const OUT_MD = join(OUT_DIR, "step76b-tagged-example-filter-audit.md");
const OUT_JSON = join(OUT_DIR, "step76b-tagged-example-filter-audit.json");

type VariantRun = "mixed_baseline" | "tagged_filtered";

type SampleRow = {
  id: string;
  variant: VariantRun;
  contextTag: string;
  expectedRegister: string;
  compliance: number;
  registerDrift: boolean;
  pass: boolean;
  text?: string;
};

function variantJsonPath(variant: VariantRun) {
  return join(OUT_DIR, `step76b-variant-${variant}.json`);
}

async function generateOne(sceneId: string, variant: VariantRun, attempt = 1): Promise<string> {
  const scene = LEON_SCENES.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Unknown scene ${sceneId}`);

  const exampleVariant: ExampleDialogVariant = variant === "mixed_baseline" ? "mixed" : "tagged";
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
      requestKind: "step76b-tagged-example-filter-audit",
    });
    return res.text.trim();
  } catch (err) {
    if (attempt >= 3) throw err;
    console.warn(`Retry ${variant}/${sceneId} (${attempt}/3)`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return generateOne(sceneId, variant, attempt + 1);
  }
}

function measure(scene: (typeof LEON_SCENES)[0], variant: VariantRun, text: string): SampleRow {
  const comp = evaluateRegisterCompliance(text, scene.expectedRegister);
  const reg = evaluateStep73Sample(scene.id, text, scene.genres);
  const pass = comp.complianceRate >= 70 && !reg.registerSwitching?.includes("FAIL");
  return {
    id: scene.id,
    variant,
    contextTag: scene.contextTag,
    expectedRegister: scene.expectedRegister,
    compliance: comp.complianceRate,
    registerDrift: comp.driftKinds.length > 0 || reg.registerSwitching === "FAIL",
    pass,
    text,
  };
}

async function runVariant(
  variant: VariantRun,
  doGenerate: boolean,
  bedOnly: boolean
): Promise<SampleRow[]> {
  const jsonPath = variantJsonPath(variant);
  const samples: SampleRow[] = [];
  const cached = new Set<string>();
  const scenes = bedOnly
    ? LEON_SCENES.filter((s) => s.contextTag === "침대")
    : LEON_SCENES;

  if (existsSync(jsonPath)) {
    try {
      const j = JSON.parse(readFileSync(jsonPath, "utf8")) as { samples?: SampleRow[] };
      for (const s of j.samples ?? []) {
        if (!s.text) continue;
        const scene = LEON_SCENES.find((x) => x.id === s.id);
        if (!scene) continue;
        samples.push({ ...measure(scene, variant, s.text), text: s.text });
        cached.add(s.id);
      }
    } catch {
      /* fresh */
    }
  }

  if (doGenerate) {
    for (const scene of scenes) {
      if (cached.has(scene.id)) {
        console.log(`[${variant}] skip ${scene.id} (cached)`);
        continue;
      }
      console.log(`[${variant}] ${scene.id}…`);
      try {
        const text = await generateOne(scene.id, variant);
        const row = { ...measure(scene, variant, text), text };
        samples.push(row);
        writeFileSync(
          jsonPath,
          JSON.stringify({ variant, generatedAt: new Date().toISOString(), samples }, null, 2)
        );
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`[${variant}] ${scene.id} failed:`, err);
      }
    }
  }

  return samples;
}

function bedPrimaryReport(samples: SampleRow[]): {
  contextTag: string;
  n: number;
  passRate: number;
  avgCompliance: number;
  rows: SampleRow[];
}[] {
  const byTag = new Map<string, SampleRow[]>();
  for (const s of samples) {
    const list = byTag.get(s.contextTag) ?? [];
    list.push(s);
    byTag.set(s.contextTag, list);
  }
  return [...byTag.entries()].map(([contextTag, rows]) => ({
    contextTag,
    n: rows.length,
    passRate: rows.length ? Math.round((rows.filter((r) => r.pass).length / rows.length) * 1000) / 10 : 0,
    avgCompliance: rows.length
      ? Math.round((rows.reduce((a, r) => a + r.compliance, 0) / rows.length) * 10) / 10
      : 0,
    rows,
  }));
}

function buildCostComparison(): string {
  return `## Implementation cost comparison (Step 7.6b)

| Option | Scope | Est. effort | Latency / cost | Register fix fit |
|--------|-------|-------------|----------------|------------------|
| **A. Tagged example + assembly filter** | \`exampleDialogSceneFilter.ts\` + \`contextBuilder\` hook (env \`EXAMPLE_DIALOG_SCENE_FILTER=1\`) + creator tagged rewrite | **~0.5–1 day** (core done) | **Zero extra API** per turn | **Direct** — removes cross-register contamination at prompt source; bed scene gets only [침대]/[사적] haeyo lines |
| **B. speechLock validator wire-up** | \`route.ts\` post-gen + optional regen via \`buildSpeechRewriteUserMessage\` | **~1–2 days** (wire + regen loop + isolation-mode guard) | **+1 API call** when \`shouldRewrite\` (~fail cases) | **Partial / indirect** — existing validator checks formality/class/ending anchors, **not** 공적↔사적↔침대 register switch |

### Option A detail
- **Done in this step:** filter module, unit tests, contextBuilder wiring (off by default).
- **Remaining for prod:** Leon DB \`example_dialog\` tagged rewrite; enable env flag or promote to default after bed validation.
- **Regex reuse:** \`SPEECH_CONTEXT_TAG_RE\` aligned with \`speechMetadataPolicy\` 공적|사적|침대 labels.

### Option B detail — why it does not solve bed alone
- \`SpeechProfile\` is **single** formality + ending anchors from **all** examples merged (\`deriveSpeechProfile\`).
- \`validateSpeechLock\` has no \`register_by_context\` or haeyo/danakka scene check (\`characterRegisterCompliance\` is separate).
- Leon bed failure = model outputs **danakka/formal** when **haeyo** expected — not covered by \`requiresFormalSpeech\` or ending anchor drift alone.
- To make speechLock work for register: extend profile with context registers, infer scene at post-gen, add \`register_context_drift\` violation + regen — **~2–3 extra days** on top of wire-up.

### Recommendation for ordering
1. **Ship A first** (lower cost, zero latency, targets root cause #2).
2. **Defer B** unless you want a generic hybrid-honorific/slang safety net; register-specific B needs profile extension anyway.`;
}

async function main() {
  const doGenerate = process.argv.includes("--generate");
  const bedOnly = process.argv.includes("--bed-only");
  mkdirSync(OUT_DIR, { recursive: true });

  delete process.env.REGISTER_PATCH;

  const mixedContam = analyzeExampleContamination("leon_fixture", LEON_EXAMPLE_MIXED, "mixed");
  const taggedContam = analyzeExampleContamination("leon_tagged", LEON_EXAMPLE_TAGGED, "tagged");

  const bedScene = LEON_SCENES.find((s) => s.id === "leon-private-1")!;
  const bedFilteredExample = extractFilteredCanonExampleBlock(bedScene, "tagged");
  const bedSceneCtx = inferSceneRegisterContext({
    userMessage: bedScene.currentUserMessage,
    recentHistory: bedScene.shortTermHistory.map((m) => m.content).join("\n"),
  });

  let mixedSamples: SampleRow[] = [];
  let taggedSamples: SampleRow[] = [];

  const mixedJson = variantJsonPath("mixed_baseline");
  const step76aAudit = join(OUT_DIR, "step76a-example-dialog-context-audit.json");
  if (existsSync(step76aAudit) && mixedSamples.length === 0) {
    try {
      const j = JSON.parse(readFileSync(step76aAudit, "utf8")) as {
        variantSummaries?: { variant: string; samples?: { id: string; compliance: number; registerDrift?: boolean; contextTag?: string }[] }[];
      };
      const mixedSummary = j.variantSummaries?.find((v) => v.variant === "mixed");
      for (const s of mixedSummary?.samples ?? []) {
        const scene = LEON_SCENES.find((x) => x.id === s.id);
        if (!scene) continue;
        mixedSamples.push({
          id: s.id,
          variant: "mixed_baseline",
          contextTag: scene.contextTag,
          expectedRegister: scene.expectedRegister,
          compliance: s.compliance,
          registerDrift: s.registerDrift ?? false,
          pass: s.compliance >= 70,
        });
      }
      if (mixedSamples.length) {
        writeFileSync(mixedJson, JSON.stringify({ variant: "mixed_baseline", fromStep76a: true, samples: mixedSamples }, null, 2));
      }
    } catch {
      /* ignore */
    }
  }

  if (doGenerate || existsSync(mixedJson)) {
    mixedSamples = await runVariant("mixed_baseline", doGenerate, bedOnly);
  }
  taggedSamples = await runVariant("tagged_filtered", doGenerate, bedOnly);

  const mixedBed = bedPrimaryReport(mixedSamples).find((b) => b.contextTag === "침대");
  const taggedBed = bedPrimaryReport(taggedSamples).find((b) => b.contextTag === "침대");

  const mixedSummary = summarizeVariantCompliance(
    "mixed",
    mixedSamples.map((s) => ({ id: s.id, compliance: s.compliance, registerDrift: s.registerDrift }))
  );
  const taggedSummary = summarizeVariantCompliance(
    "tagged",
    taggedSamples.map((s) => ({ id: s.id, compliance: s.compliance, registerDrift: s.registerDrift }))
  );

  const bedPredMixed = predictFromExamplesOnly(bedScene, "mixed");
  const bedPredTagged = predictFromExamplesOnly(bedScene, "tagged");

  const md: string[] = [
    "# Step 7.6b — Tagged Example + Assembly Filter Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Root cause (locked)",
    "",
    "No structural register trigger (#2). Position (#1) and model (#3) excluded.",
    "",
    "## 1. Leon example_dialog tags (rewrite-only)",
    "",
    "```",
    LEON_EXAMPLE_TAGGED,
    "```",
    "",
    "| Variant | mixed registers | context tags | mixedRegisterUntagged |",
    "|---------|-----------------|--------------|------------------------|",
    `| mixed | ${mixedContam.isMixed} | ${mixedContam.contextTaggedCount} | ${mixedContam.mixedRegisterUntagged} |`,
    `| tagged | ${taggedContam.isMixed} | ${taggedContam.contextTaggedCount} | ${taggedContam.mixedRegisterUntagged} |`,
    "",
    "## 2. Assembly filter (bed scene leon-private-1)",
    "",
    `- Inferred scene context: **${bedSceneCtx}**`,
    `- Filtered example block injected:`,
    "",
    "```",
    bedFilteredExample,
    "```",
    "",
    `- Example-only prediction (mixed): ${bedPredMixed.nearestExampleRegister} → pass=${bedPredMixed.predictsCorrect}`,
    `- Example-only prediction (tagged+filter): ${bedPredTagged.nearestExampleRegister} → pass=${bedPredTagged.predictsCorrect}`,
    "",
    "## 3. Generation results — **bed primary metric**",
    "",
    "| Variant | bed n | bed pass% | bed avg compliance |",
    "|---------|-------|-----------|-------------------|",
    `| mixed (Step 7.6a baseline) | ${mixedBed?.n ?? 0} | ${mixedBed?.passRate ?? "—"}% | ${mixedBed?.avgCompliance ?? "—"}% |`,
    `| tagged + filter | ${taggedBed?.n ?? 0} | ${taggedBed?.passRate ?? "—"}% | ${taggedBed?.avgCompliance ?? "—"}% |`,
    "",
    "### By context (secondary — not success criterion)",
    "",
    "| Variant | context | n | avg compliance |",
    "|---------|---------|---|----------------|",
  ];

  for (const v of [
    { label: "mixed", summary: mixedSummary },
    { label: "tagged+filter", summary: taggedSummary },
  ]) {
    for (const row of v.summary.byContext) {
      md.push(`| ${v.label} | ${row.contextTag} | ${row.n} | ${row.avg}% |`);
    }
  }

  md.push("", buildCostComparison());

  const bedImproved =
    taggedBed &&
    mixedBed &&
    taggedBed.passRate > (mixedBed.passRate ?? 0) &&
    taggedBed.avgCompliance > (mixedBed.avgCompliance ?? 0);

  md.push(
    "",
    "## Success criterion",
    "",
    `- Bed register accuracy must improve meaningfully from **0%** (n=${taggedBed?.n ?? 0} per cell).`,
    `- Result: ${bedImproved ? "**PASS (bed improved vs mixed baseline)**" : doGenerate ? "**PENDING / INCONCLUSIVE — check samples**" : "**Run with --generate to measure**"}`,
    ""
  );

  writeFileSync(OUT_MD, md.join("\n"));
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        bedSceneCtx,
        bedFilteredExample,
        mixedSamples,
        taggedSamples,
        mixedBed,
        taggedBed,
        costComparisonNote: "see markdown",
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
