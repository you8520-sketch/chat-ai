/**
 * Step 7.6c — Independence validation + false-positive gate + meta lexicon audit.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step76c-independence-gate.ts --false-positive
 *   npm.cmd exec tsx -- scripts/step76c-independence-gate.ts --meta-lexicon
 *   npm.cmd exec tsx -- scripts/step76c-independence-gate.ts --generate --n=12
 *   npm.cmd exec tsx -- scripts/step76c-independence-gate.ts --report   # from cache only
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  buildLeonContextWithExampleVariant,
  LEON_SCENES,
} from "./lib/exampleDialogContextAuditLib";
import { buildStagingContextFromDb, LEON_STAGING_CHARACTER_ID } from "./lib/step76LeonStagingContext";
import type { RegisterValidationScene } from "./lib/leon-ren-register-fixtures";
import {
  classifyLineRegister,
  evaluateRegisterCompliance,
} from "@/lib/characterRegisterCompliance";
import { evaluateStep73Sample } from "@/lib/registerMetaAudit";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = "data";
}

const OUT_DIR = join(process.cwd(), "output");
const OUT_MD = join(OUT_DIR, "step76c-independence-gate.md");
const OUT_JSON = join(OUT_DIR, "step76c-independence-gate.json");
const OUT_MD_FIXTURE = join(OUT_DIR, "step76c-independence-gate-fixture-only.md");
const MIXED_CACHE = join(OUT_DIR, "step76b-staging-mixed_baseline.json");
const STAGING_CACHE = join(OUT_DIR, "step76b-staging-staging_tagged_db.json");

/** Staging-aligned holdout cache prefix (DB Leon tagged + filter). */
const CACHE_PREFIX = "step76c-staging-path";

const PASS_THRESHOLD = 70;

/** Independent bed/private scenes — NOT leon-private-1 (original 12-run set). */
const INDEPENDENT_SCENES: RegisterValidationScene[] = [
  LEON_SCENES.find((s) => s.id === "leon-private-0")!,
  {
    id: "leon-bed-alt",
    character: "leon",
    label: "침대·이불",
    genres: ["판타지/SF", "로맨스 판타지"],
    expectedRegister: "haeyo",
    contextTag: "침대",
    currentUserMessage: "렌: …이불, 같이 덮을래?",
    shortTermHistory: [
      { role: "user", content: "…방 불 좀 어둡게 할까?" },
      { role: "assistant", content: `레온은 잠시 망설이다 고개를 끄덕였다.\n\n"…그래요."` },
    ],
  },
];

type VariantRun = "mixed_baseline" | "staging_tagged_db";

type SampleRow = {
  run: number;
  sceneId: string;
  variant: VariantRun;
  compliance: number;
  pass: boolean;
  registerDrift: boolean;
  driftKinds: string[];
  text: string;
};

function parseN(): number {
  const arg = process.argv.find((a) => a.startsWith("--n="));
  const n = arg ? Number.parseInt(arg.split("=")[1] ?? "12", 10) : 12;
  return Number.isFinite(n) && n >= 10 ? n : 12;
}

function measure(scene: RegisterValidationScene, variant: VariantRun, run: number, text: string): SampleRow {
  const comp = evaluateRegisterCompliance(text, scene.expectedRegister);
  const reg = evaluateStep73Sample(scene.id, text, scene.genres);
  return {
    run,
    sceneId: scene.id,
    variant,
    compliance: comp.complianceRate,
    pass: comp.complianceRate >= PASS_THRESHOLD && reg.registerSwitching !== "FAIL",
    registerDrift: comp.driftKinds.length > 0 || reg.registerSwitching === "FAIL",
    driftKinds: comp.driftKinds,
    text,
  };
}

async function generateOne(scene: RegisterValidationScene, variant: VariantRun, run: number, attempt = 1): Promise<string> {
  if (variant === "staging_tagged_db") {
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";
  } else {
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = "0";
  }

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
      requestKind: `step76c-${scene.id}-${variant}-run${run}`,
    });
    return res.text.trim();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return generateOne(scene, variant, run, attempt + 1);
  }
}

function cachePath(sceneId: string, variant: VariantRun): string {
  return join(OUT_DIR, `${CACHE_PREFIX}-${sceneId}-${variant}.json`);
}

async function runVariant(
  scene: RegisterValidationScene,
  variant: VariantRun,
  targetN: number,
  doGenerate: boolean
): Promise<SampleRow[]> {
  const path = cachePath(scene.id, variant);
  const rows: SampleRow[] = [];
  const cached = new Set<number>();

  if (existsSync(path)) {
    try {
      const j = JSON.parse(readFileSync(path, "utf8")) as { samples?: SampleRow[] };
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
      console.log(`[${scene.id} ${variant}] run ${run}/${targetN}…`);
      const text = await generateOne(scene, variant, run);
      rows.push(measure(scene, variant, run, text));
      rows.sort((a, b) => a.run - b.run);
      writeFileSync(path, JSON.stringify({ sceneId: scene.id, variant, samples: rows }, null, 2));
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return rows.sort((a, b) => a.run - b.run);
}

function passStats(rows: SampleRow[]) {
  const n = rows.length;
  const passCount = rows.filter((r) => r.pass).length;
  const driftCount = rows.filter((r) => r.registerDrift).length;
  return {
    n,
    passCount,
    passRate: n ? Math.round((passCount / n) * 1000) / 10 : 0,
    driftCount,
    meanCompliance: n
      ? Math.round((rows.reduce((a, r) => a + r.compliance, 0) / n) * 10) / 10
      : 0,
  };
}

function runFalsePositiveCheck() {
  const j = JSON.parse(readFileSync(MIXED_CACHE, "utf8")) as {
    samples: { run: number; pass: boolean; compliance: number; failurePatterns?: string[]; text: string }[];
  };

  const driftRuns = j.samples.filter(
    (s) =>
      s.failurePatterns?.some((p) =>
        ["banmal", "wrong_register", "drift_banmal", "drift_danakka", "drift_formal", "danakka_drift", "formal_drift"].includes(p)
      )
  );

  const results = driftRuns.map((s) => {
    const comp = evaluateRegisterCompliance(s.text, "haeyo");
    const reg = evaluateStep73Sample("leon-private-1", s.text, ["판타지/SF", "로맨스 판타지"]);
    const pass = comp.complianceRate >= PASS_THRESHOLD && reg.registerSwitching !== "FAIL";
    const lines = [...s.text.matchAll(/"([^"\n]{1,200})"/g)].map((m) => m[1]!.trim()).slice(0, 6);
    const lineRegs = lines.map((l) => ({ line: l.slice(0, 48), reg: classifyLineRegister(l) }));
    return {
      run: s.run,
      cachedPass: s.pass,
      cachedCompliance: s.compliance,
      rescoredPass: pass,
      rescoredCompliance: comp.complianceRate,
      driftKinds: comp.driftKinds,
      registerSwitching: reg.registerSwitching,
      stillFails: !pass || comp.driftKinds.length > 0,
      lineRegs,
      oldPatterns: s.failurePatterns ?? [],
    };
  });

  const falsePasses = results.filter((r) => r.cachedPass === false && r.rescoredPass && r.driftKinds.length === 0);
  const allDriftStillFail = results.every((r) => r.stillFails);

  return { driftRunCount: driftRuns.length, results, falsePasses, allDriftStillFail, gatePass: falsePasses.length === 0 && allDriftStillFail };
}

/** Group A literal + Group B structural meta patterns in narration (quotes stripped). */
const GROUP_A_LITERAL_RE =
  /(?:해요체|다나까(?:체)?|하십시오체|합니다체|하오체|반말|존댓말|반존대|경어|높임말|군대식(?:\s*다나까)?(?:체)?|구어체)/gi;

const GROUP_B_META_RE =
  /(?:말투(?:가|는|을)?\s*(?:바뀌|변|달라|공손|부드러|거칠|높|낮|전환|섞|혼)|목소리(?:가|는)?\s*(?:달라|바뀌|낮|높|부드러|거칠)|평소(?:의|처럼)?\s*(?:절제|냉정|건조|공손|격식)|처음(?:이|으로|엔)\s*(?:이렇게|그렇게|이런|그런)|register|honorific|speech register)/gi;

function stripDialogueForNarration(text: string): string {
  return text.replace(/"[^"]*"/g, " ").replace(/\s+/g, " ").trim();
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  return [...stripDialogueForNarration(text).matchAll(g)].length;
}

function runMetaLexiconAudit() {
  const mixed = JSON.parse(readFileSync(MIXED_CACHE, "utf8")) as { samples: { run: number; text: string }[] };
  const staging = JSON.parse(readFileSync(STAGING_CACHE, "utf8")) as { samples: { run: number; text: string }[] };

  function auditSet(label: string, samples: { run: number; text: string }[]) {
    let groupA = 0;
    let groupB = 0;
    const hits: { run: number; a: number; b: number; snippets: string[] }[] = [];
    for (const s of samples) {
      const narr = stripDialogueForNarration(s.text);
      const a = countMatches(s.text, GROUP_A_LITERAL_RE);
      const b = countMatches(s.text, GROUP_B_META_RE);
      groupA += a;
      groupB += b;
      const snippets: string[] = [];
      for (const m of narr.matchAll(GROUP_A_LITERAL_RE)) {
        if (m.index != null) snippets.push(narr.slice(Math.max(0, m.index - 20), m.index + 40));
      }
      for (const m of narr.matchAll(GROUP_B_META_RE)) {
        if (m.index != null) snippets.push(narr.slice(Math.max(0, m.index - 20), m.index + 40));
      }
      hits.push({ run: s.run, a, b, snippets: snippets.slice(0, 3) });
    }
    return { label, n: samples.length, groupA, groupB, perRun: hits };
  }

  const mixedAudit = auditSet("mixed_baseline", mixed.samples);
  const stagingAudit = auditSet("staging_tagged", staging.samples);

  return { mixedAudit, stagingAudit };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const doGenerate = process.argv.includes("--generate");
  const reportOnly = process.argv.includes("--report");
  const falsePositiveOnly = process.argv.includes("--false-positive");
  const metaOnly = process.argv.includes("--meta-lexicon");
  const targetN = parseN();

  const payload: Record<string, unknown> = { generatedAt: new Date().toISOString() };

  if (falsePositiveOnly || reportOnly || !metaOnly) {
    if (existsSync(MIXED_CACHE)) {
      payload.falsePositive = runFalsePositiveCheck();
      console.log(
        `False-positive gate: ${(payload.falsePositive as { gatePass: boolean }).gatePass ? "PASS" : "FAIL"} ` +
          `(${(payload.falsePositive as { falsePasses: unknown[] }).falsePasses.length} false passes)`
      );
    }
  }

  if (metaOnly || reportOnly || !falsePositiveOnly) {
    if (existsSync(MIXED_CACHE) && existsSync(STAGING_CACHE)) {
      payload.metaLexicon = runMetaLexiconAudit();
      const m = (payload.metaLexicon as ReturnType<typeof runMetaLexiconAudit>).mixedAudit;
      const s = (payload.metaLexicon as ReturnType<typeof runMetaLexiconAudit>).stagingAudit;
      console.log(`Meta lexicon A: mixed=${m.groupA} staging=${s.groupA} | B: mixed=${m.groupB} staging=${s.groupB}`);
    }
  }

  if (metaOnly && !reportOnly && !doGenerate) return;
  if (falsePositiveOnly && !reportOnly && !doGenerate) {
    writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
    return;
  }

  const sceneResults: Record<string, { mixed: SampleRow[]; tagged: SampleRow[] }> = {};

  if (doGenerate || reportOnly) {
    for (const scene of INDEPENDENT_SCENES) {
      const mixed = await runVariant(scene, "mixed_baseline", targetN, doGenerate);
      const tagged = await runVariant(scene, "staging_tagged_db", targetN, doGenerate);
      sceneResults[scene.id] = { mixed, tagged };
    }
    const perSceneStats = Object.fromEntries(
      Object.entries(sceneResults).map(([id, { mixed, tagged }]) => {
        const m = passStats(mixed);
        const t = passStats(tagged);
        const ceilingNote =
          id === "leon-bed-alt" && m.passRate >= 70
            ? "possible_ceiling_effect (mixed baseline already high — tagged lift may be hard to observe)"
            : null;
        return [id, { mixed: m, tagged: t, deltaPp: t.passRate - m.passRate, ceilingNote }];
      })
    );
    payload.harnessPath = "staging_aligned";
    payload.leonStagingCharacterId = LEON_STAGING_CHARACTER_ID;
    payload.dataDir = process.env.DATA_DIR ?? "(default)";
    payload.independent = Object.fromEntries(
      Object.entries(sceneResults).map(([id, { mixed, tagged }]) => [
        id,
        { mixed: passStats(mixed), tagged: passStats(tagged), mixedRows: mixed, taggedRows: tagged },
      ])
    );

    const allMixed = Object.values(sceneResults).flatMap((r) => r.mixed);
    const allTagged = Object.values(sceneResults).flatMap((r) => r.tagged);
    const mixedStats = passStats(allMixed);
    const taggedStats = passStats(allTagged);
    payload.independentSummary = {
      harnessPath: "staging_aligned",
      leonStagingCharacterId: LEON_STAGING_CHARACTER_ID,
      dataDir: process.env.DATA_DIR ?? "(default)",
      scenes: INDEPENDENT_SCENES.map((s) => s.id),
      perScene: perSceneStats,
      mixed: mixedStats,
      tagged: taggedStats,
      patternReproduced:
        mixedStats.passRate < taggedStats.passRate && taggedStats.passRate - mixedStats.passRate >= 15,
      supersedesFixtureOnlyReport: true,
    };
    console.log(
      `Independent: mixed ${mixedStats.passRate}% (${mixedStats.passCount}/${mixedStats.n}) | tagged ${taggedStats.passRate}% (${taggedStats.passCount}/${taggedStats.n})`
    );
  }

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));

  const md: string[] = [
    "# Step 7.6c — Independence gate + false-positive + meta lexicon",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];

  if (payload.falsePositive) {
    const fp = payload.falsePositive as ReturnType<typeof runFalsePositiveCheck>;
    md.push(
      "## 1. False-positive check (mixed drift runs → new scorer)",
      "",
      `Gate: **${fp.gatePass ? "PASS" : "FAIL"}** — drift runs still fail: ${fp.allDriftStillFail}, false passes: ${fp.falsePasses.length}`,
      "",
      "| run | old | new compliance | new pass | drift | still fails |",
      "|-----|-----|----------------|----------|-------|-------------|"
    );
    for (const r of fp.results) {
      md.push(
        `| ${r.run} | ${r.cachedCompliance}% | ${r.rescoredCompliance}% | ${r.rescoredPass} | ${r.driftKinds.join("+") || "none"} | ${r.stillFails} |`
      );
    }
    md.push("");
  }

  if (payload.metaLexicon) {
    const { mixedAudit, stagingAudit } = payload.metaLexicon as ReturnType<typeof runMetaLexiconAudit>;
    md.push(
      "## Meta lexicon (leon-private-1 cached 12 runs, narration only)",
      "",
      "| variant | Group A literal | Group B meta pattern |",
      "|---------|-----------------|----------------------|",
      `| mixed | ${mixedAudit.groupA} | ${mixedAudit.groupB} |`,
      `| staging tagged | ${stagingAudit.groupA} | ${stagingAudit.groupB} |`,
      ""
    );
  }

  if (payload.independentSummary) {
    const sum = payload.independentSummary as {
      harnessPath?: string;
      leonStagingCharacterId?: number;
      dataDir?: string;
      mixed: ReturnType<typeof passStats>;
      tagged: ReturnType<typeof passStats>;
      patternReproduced: boolean;
      scenes: string[];
      perScene?: Record<
        string,
        {
          mixed: ReturnType<typeof passStats>;
          tagged: ReturnType<typeof passStats>;
          deltaPp: number;
          ceilingNote: string | null;
        }
      >;
    };
    md.push(
      "## 2. Independent validation (staging-aligned harness, n=" + targetN + ")",
      "",
      `Harness: **${sum.harnessPath ?? "unknown"}** — mixed=fixture mixed (same as step76b); tagged=DB Leon id=${sum.leonStagingCharacterId ?? "?"} + EXAMPLE_DIALOG_SCENE_FILTER=1`,
      `DATA_DIR: ${sum.dataDir ?? "(default)"}`,
      "",
      `Scenes: ${sum.scenes.join(", ")}`,
      "",
      "### Pooled",
      "",
      "| variant | pass rate | drift runs | mean compliance |",
      "|---------|-----------|------------|-----------------|",
      `| mixed (fixture) | ${sum.mixed.passRate}% (${sum.mixed.passCount}/${sum.mixed.n}) | ${sum.mixed.driftCount} | ${sum.mixed.meanCompliance}% |`,
      `| staging_tagged_db | ${sum.tagged.passRate}% (${sum.tagged.passCount}/${sum.tagged.n}) | ${sum.tagged.driftCount} | ${sum.tagged.meanCompliance}% |`,
      "",
      `Pattern reproduced (mixed ≪ tagged, Δ≥15pp): **${sum.patternReproduced ? "YES — prod gate may proceed" : "NO — prod remains blocked"}**`,
      ""
    );
    if (sum.perScene) {
      md.push(
        "### Per scene",
        "",
        "| scene | mixed | staging_tagged_db | Δ (tagged−mixed) | note |",
        "|-------|-------|-------------------|------------------|------|"
      );
      for (const [id, row] of Object.entries(sum.perScene)) {
        md.push(
          `| ${id} | ${row.mixed.passRate}% | ${row.tagged.passRate}% | ${row.deltaPp >= 0 ? "+" : ""}${row.deltaPp}pp | ${row.ceilingNote ?? "—"} |`
        );
      }
      md.push("");
    }
    md.push(
      "Prior fixture-only tagged run (37.5% tagged vs 58.3% mixed) is **superseded** by this report if paths differed.",
      ""
    );
  }

  writeFileSync(OUT_MD, md.join("\n"));
  console.log(`Wrote ${OUT_MD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
