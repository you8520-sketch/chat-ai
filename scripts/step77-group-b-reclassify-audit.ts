/**
 * Step 7.7 Group B reclassification audit — NO API.
 * Re-scores cached mixed vs tagged(+filter) staging run texts with Group B meta metrics
 * to check whether the register filter alone already suppresses Group B meta narration.
 *
 * Usage: npm.cmd exec tsx -- scripts/step77-group-b-reclassify-audit.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeGroupBMetaAudit } from "./lib/group-b-meta-audit-metrics";

const OUT_DIR = join(process.cwd(), "output");

type CachedSample = { run: number; variant: string; text: string };

type SourceFile = {
  file: string;
  scene: string;
  arm: "mixed" | "tagged_filtered";
};

const SOURCES: SourceFile[] = [
  // Step 7.6b staging (leon-private-1)
  { file: "step76b-staging-mixed_baseline.json", scene: "leon-private-1", arm: "mixed" },
  { file: "step76b-staging-staging_tagged_db.json", scene: "leon-private-1", arm: "tagged_filtered" },
  // Step 7.6c staging-path holdout
  { file: "step76c-staging-path-leon-private-0-mixed_baseline.json", scene: "leon-private-0", arm: "mixed" },
  { file: "step76c-staging-path-leon-private-0-staging_tagged_db.json", scene: "leon-private-0", arm: "tagged_filtered" },
  { file: "step76c-staging-path-leon-bed-alt-mixed_baseline.json", scene: "leon-bed-alt", arm: "mixed" },
  { file: "step76c-staging-path-leon-bed-alt-staging_tagged_db.json", scene: "leon-bed-alt", arm: "tagged_filtered" },
];

type Row = {
  scene: string;
  arm: string;
  n: number;
  groupBMetaTotal: number;
  groupBMetaPerRun: number;
  runsWithMeta: number;
  explainContrastTotal: number;
  explainContrastPerRun: number;
  voiceExplainTotal: number;
  sampleHits: string[];
};

function loadSamples(file: string): CachedSample[] {
  const p = join(OUT_DIR, file);
  if (!existsSync(p)) return [];
  const j = JSON.parse(readFileSync(p, "utf8")) as { samples?: CachedSample[] };
  return j.samples ?? [];
}

function extractSampleHits(text: string): string[] {
  const stripped = text.replace(/"[^"]*"/g, " ");
  const re =
    /(?:말투(?:가|는|을)?\s*(?:바뀌|변|달라|공손|부드러|거칠|높|낮|전환|섞|혼)|목소리(?:가|는)?\s*(?:달라|바뀌|낮|높|부드러|거칠|가라)|평소(?:의|처럼)?\s*(?:절제|냉정|건조|공손|격식|딱딱)|처음(?:이|으로|엔)\s*(?:이렇게|그렇게|이런|그런))[^.\n]{0,40}/g;
  return [...stripped.matchAll(re)].map((m) => m[0].trim()).slice(0, 5);
}

const rows: Row[] = [];

for (const src of SOURCES) {
  const samples = loadSamples(src.file);
  if (samples.length === 0) {
    console.warn(`skip (missing/empty): ${src.file}`);
    continue;
  }
  let metaTotal = 0;
  let explainTotal = 0;
  let voiceTotal = 0;
  let runsWithMeta = 0;
  const hits: string[] = [];
  for (const s of samples) {
    const m = analyzeGroupBMetaAudit(s.text);
    metaTotal += m.groupBMetaCount;
    explainTotal += m.explainContrastCount;
    voiceTotal += m.voiceExplainCount;
    if (m.groupBMetaCount > 0) {
      runsWithMeta++;
      hits.push(...extractSampleHits(s.text));
    }
  }
  rows.push({
    scene: src.scene,
    arm: src.arm,
    n: samples.length,
    groupBMetaTotal: metaTotal,
    groupBMetaPerRun: Math.round((metaTotal / samples.length) * 100) / 100,
    runsWithMeta,
    explainContrastTotal: explainTotal,
    explainContrastPerRun: Math.round((explainTotal / samples.length) * 100) / 100,
    voiceExplainTotal: voiceTotal,
    sampleHits: [...new Set(hits)].slice(0, 6),
  });
}

// Latest Group B ablation baseline (register filter ON, explain few-shot arm) for reference
const ablationPath = join(OUT_DIR, "fewshot-group-b-ablation-validation.json");
let ablationRef: Record<string, unknown> | null = null;
if (existsSync(ablationPath)) {
  const j = JSON.parse(readFileSync(ablationPath, "utf8")) as {
    pairs?: { before: { metrics: { groupBMetaCount: number; explainContrastCount: number } } }[];
  };
  const pairs = j.pairs ?? [];
  const metaTotal = pairs.reduce((a, p) => a + p.before.metrics.groupBMetaCount, 0);
  const explainTotal = pairs.reduce((a, p) => a + p.before.metrics.explainContrastCount, 0);
  ablationRef = {
    source: "fewshot-group-b-ablation-validation.json (before arm = explain few-shot, filter ON)",
    n: pairs.length,
    groupBMetaTotal: metaTotal,
    groupBMetaPerRun: pairs.length ? Math.round((metaTotal / pairs.length) * 100) / 100 : 0,
    explainContrastPerRun: pairs.length ? Math.round((explainTotal / pairs.length) * 100) / 100 : 0,
  };
}

const pooled = (arm: string) => {
  const sel = rows.filter((r) => r.arm === arm);
  const n = sel.reduce((a, r) => a + r.n, 0);
  const meta = sel.reduce((a, r) => a + r.groupBMetaTotal, 0);
  const withMeta = sel.reduce((a, r) => a + r.runsWithMeta, 0);
  const explain = sel.reduce((a, r) => a + r.explainContrastTotal, 0);
  return {
    n,
    groupBMetaTotal: meta,
    groupBMetaPerRun: n ? Math.round((meta / n) * 100) / 100 : 0,
    runsWithMeta: withMeta,
    explainContrastPerRun: n ? Math.round((explain / n) * 100) / 100 : 0,
  };
};

const result = {
  test: "step77-group-b-reclassify-audit",
  purpose:
    "Re-score cached mixed vs tagged+filter staging runs with Group B meta metrics — did the register filter already suppress Group B?",
  apiCalls: 0,
  perSceneArm: rows,
  pooled: { mixed: pooled("mixed"), tagged_filtered: pooled("tagged_filtered") },
  groupBAblationBaselineRef: ablationRef,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "step77-group-b-reclassify-audit.json"), JSON.stringify(result, null, 2), "utf8");

const md: string[] = [
  "# Step 7.7 — Group B reclassification audit (cached runs, no API)",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "Question: was Group B meta already low under register filter (tagged arm), i.e. filter itself suppresses Group B?",
  "",
  "| scene | arm | n | Group B meta total | per run | runs w/ meta | explain contrast/run |",
  "|-------|-----|---|--------------------|---------|--------------|----------------------|",
];
for (const r of rows) {
  md.push(
    `| ${r.scene} | ${r.arm} | ${r.n} | ${r.groupBMetaTotal} | ${r.groupBMetaPerRun} | ${r.runsWithMeta} | ${r.explainContrastPerRun} |`
  );
}
const pm = pooled("mixed");
const pt = pooled("tagged_filtered");
md.push(
  "",
  "## Pooled",
  "",
  `- mixed: n=${pm.n}, Group B meta ${pm.groupBMetaTotal} total (${pm.groupBMetaPerRun}/run), ${pm.runsWithMeta} runs with ≥1 hit`,
  `- tagged+filter: n=${pt.n}, Group B meta ${pt.groupBMetaTotal} total (${pt.groupBMetaPerRun}/run), ${pt.runsWithMeta} runs with ≥1 hit`,
  ""
);
if (ablationRef) {
  md.push(
    "## Reference — Group B ablation baseline (filter ON, explain few-shot arm)",
    "",
    `- n=${ablationRef.n}, Group B meta/run = ${ablationRef.groupBMetaPerRun}, explain contrast/run = ${ablationRef.explainContrastPerRun}`,
    ""
  );
}
md.push(
  "## Sample hits (mixed arm)",
  ""
);
for (const r of rows.filter((x) => x.arm === "mixed" && x.sampleHits.length)) {
  md.push(`- **${r.scene}**: ${r.sampleHits.map((h) => `\`${h}\``).join(" · ")}`);
}
writeFileSync(join(OUT_DIR, "step77-group-b-reclassify-audit.md"), md.join("\n"), "utf8");

console.log(JSON.stringify(result.pooled, null, 2));
console.log("\nPer scene/arm:");
for (const r of rows) {
  console.log(
    `${r.scene} ${r.arm}: n=${r.n} meta=${r.groupBMetaTotal} (${r.groupBMetaPerRun}/run) runsWithMeta=${r.runsWithMeta} explain/run=${r.explainContrastPerRun}`
  );
}
if (ablationRef) console.log("\nAblation baseline ref:", JSON.stringify(ablationRef));
console.log("\nWrote output/step77-group-b-reclassify-audit.{json,md}");
