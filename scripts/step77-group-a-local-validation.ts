/**
 * Step 7.7 Group A — local narration lexicon validation (Leon, staging path).
 *
 * Compares lexicon OFF vs ON with EXAMPLE_DIALOG_SCENE_FILTER=1 held constant.
 * Applies maybeRewriteNarrationLexicon post-gen on the ON arm (same as chat route).
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step77-group-a-local-validation.ts --generate --n=8
 *   npm.cmd exec tsx -- scripts/step77-group-a-local-validation.ts --report
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { LEON_SCENES } from "./lib/exampleDialogContextAuditLib";
import { buildStagingContextFromDb } from "./lib/step76LeonStagingContext";
import { buildContext } from "@/services/contextBuilder";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import { maybeRewriteNarrationLexicon } from "@/lib/speechLock/narrationLexiconRewrite";
import { detectRegisterLexiconInNarration } from "@/lib/speechLock/narrationLexicon";
import type { RegisterValidationScene } from "./lib/leon-ren-register-fixtures";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.DATA_DIR) process.env.DATA_DIR = "data";

process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";

const SCENE_IDS = ["leon-private-0", "leon-private-1"] as const;
const OUT_DIR = join(process.cwd(), "output");
const OUT_JSON = join(OUT_DIR, "step77-group-a-local-validation.json");
const OUT_MD = join(OUT_DIR, "step77-group-a-local-validation.md");
const CACHE_PREFIX = "step77-group-a";

/** Step 7.7 / 7.6c meta lexicon counters (narration, quotes stripped). */
const GROUP_A_LITERAL_RE =
  /(?:해요체|다나까(?:체)?|하십시오체|합니다체|하오체|반말|존댓말|반존대|경어|높임말|군대식(?:\s*다나까)?(?:체)?|구어체)/gi;

const GROUP_B_META_RE =
  /(?:말투(?:가|는|을)?\s*(?:바뀌|변|달라|공손|부드러|거칠|높|낮|전환|섞|혼)|목소리(?:가|는)?\s*(?:달라|바뀌|낮|높|부드러|거칠)|평소(?:의|처럼)?\s*(?:절제|냉정|건조|공손|격식)|처음(?:이|으로|엔)\s*(?:이렇게|그렇게|이런|그런)|register|honorific|speech register)/gi;

type Arm = "lexicon_off" | "lexicon_on";

type SampleRow = {
  run: number;
  sceneId: string;
  arm: Arm;
  groupA: number;
  groupB: number;
  detectorHits: string[];
  rewritten: boolean;
  chars: number;
  snippets: string[];
  text: string;
};

function parseN(): number {
  const arg = process.argv.find((a) => a.startsWith("--n="));
  const n = arg ? Number.parseInt(arg.split("=")[1] ?? "8", 10) : 8;
  return Number.isFinite(n) && n >= 8 ? n : 8;
}

function stripDialogue(text: string): string {
  return text.replace(/"[^"]*"/g, " ").replace(/\s+/g, " ").trim();
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  return [...stripDialogue(text).matchAll(g)].length;
}

function collectSnippets(text: string): string[] {
  const narr = stripDialogue(text);
  const out: string[] = [];
  for (const re of [GROUP_A_LITERAL_RE, GROUP_B_META_RE]) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const g = new RegExp(re.source, flags);
    for (const m of narr.matchAll(g)) {
      if (m.index != null) out.push(narr.slice(Math.max(0, m.index - 24), m.index + 48));
    }
  }
  return [...new Set(out)].slice(0, 4);
}

function measure(sceneId: string, run: number, arm: Arm, text: string, rewritten: boolean): SampleRow {
  const { hits } = detectRegisterLexiconInNarration(text);
  return {
    run,
    sceneId,
    arm,
    groupA: countMatches(text, GROUP_A_LITERAL_RE),
    groupB: countMatches(text, GROUP_B_META_RE),
    detectorHits: hits,
    rewritten,
    chars: text.length,
    snippets: collectSnippets(text),
    text,
  };
}

function cachePath(sceneId: string, arm: Arm): string {
  return join(OUT_DIR, `${CACHE_PREFIX}-${sceneId}-${arm}.json`);
}

async function generateOne(scene: RegisterValidationScene, arm: Arm, run: number, attempt = 1): Promise<SampleRow> {
  if (arm === "lexicon_on") {
    process.env.SPEECH_LOCK_NARRATION_LEXICON = "1";
  } else {
    delete process.env.SPEECH_LOCK_NARRATION_LEXICON;
  }

  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const input = buildStagingContextFromDb(scene);
  const built = buildContext(input);
  const history = built.history
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      (m.role === "user" || m.role === "assistant") && Boolean(m.content?.trim())
    )
    .map((m) => ({ role: m.role, content: m.content ?? "" }));

  try {
    const res = await callOpenRouterCompletion({
      system: built.systemPrompt,
      history: built.history,
      model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      temperature: resolveDeepSeekTemperatureForTarget(3200),
      maxTokens: 4096,
      requestKind: `step77-group-a-${scene.id}-${arm}-run${run}`,
    });
    let text = res.text.trim();
    let rewritten = false;

    if (arm === "lexicon_on") {
      const rw = await maybeRewriteNarrationLexicon({
        text,
        charName: "레온",
        system: built.systemPrompt,
        history,
        model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        targetResponseChars: 3200,
        requestKind: `step77-group-a-${scene.id}-run${run}`,
      });
      text = rw.text;
      rewritten = rw.rewritten;
    }

    return measure(scene.id, run, arm, text, rewritten);
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return generateOne(scene, arm, run, attempt + 1);
  }
}

function armStats(rows: SampleRow[]) {
  const n = rows.length;
  const groupA = rows.reduce((s, r) => s + r.groupA, 0);
  const groupB = rows.reduce((s, r) => s + r.groupB, 0);
  const runsWithA = rows.filter((r) => r.groupA > 0).length;
  const runsWithB = rows.filter((r) => r.groupB > 0).length;
  const rewritten = rows.filter((r) => r.rewritten).length;
  const meanChars = n ? Math.round(rows.reduce((s, r) => s + r.chars, 0) / n) : 0;
  return { n, groupA, groupB, runsWithA, runsWithB, rewritten, meanChars };
}

async function runArm(scene: RegisterValidationScene, arm: Arm, n: number, doGenerate: boolean): Promise<SampleRow[]> {
  const path = cachePath(scene.id, arm);
  if (!doGenerate && existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as SampleRow[];
  }
  const rows: SampleRow[] = [];
  for (let run = 1; run <= n; run++) {
    console.log(`[${scene.id}] ${arm} run ${run}/${n}…`);
    rows.push(await generateOne(scene, arm, run));
    writeFileSync(path, JSON.stringify(rows, null, 2));
  }
  return rows;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const doGenerate = process.argv.includes("--generate");
  const reportOnly = process.argv.includes("--report");
  const n = parseN();

  const payload: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    dataDir: process.env.DATA_DIR,
    filter: process.env.EXAMPLE_DIALOG_SCENE_FILTER,
    scenes: [...SCENE_IDS],
    nPerArm: n,
    perScene: {} as Record<string, unknown>,
  };

  for (const sceneId of SCENE_IDS) {
    const scene = LEON_SCENES.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`Missing scene ${sceneId}`);

    const off = await runArm(scene, "lexicon_off", n, doGenerate);
    const on = await runArm(scene, "lexicon_on", n, doGenerate);
    const offStats = armStats(off);
    const onStats = armStats(on);

    (payload.perScene as Record<string, unknown>)[sceneId] = {
      off: offStats,
      on: onStats,
      deltaGroupA: onStats.groupA - offStats.groupA,
      deltaGroupB: onStats.groupB - offStats.groupB,
      offRows: off,
      onRows: on,
    };

    console.log(
      `${sceneId}: A off=${offStats.groupA} on=${onStats.groupA} (Δ${onStats.groupA - offStats.groupA}) | ` +
        `B off=${offStats.groupB} on=${onStats.groupB} (Δ${onStats.groupB - offStats.groupB}) | rewrites=${onStats.rewritten}/${n}`
    );
  }

  const allOff = SCENE_IDS.flatMap((id) => ((payload.perScene as Record<string, { offRows: SampleRow[] }>)[id]?.offRows ?? []));
  const allOn = SCENE_IDS.flatMap((id) => ((payload.perScene as Record<string, { onRows: SampleRow[] }>)[id]?.onRows ?? []));
  const pooledOff = armStats(allOff);
  const pooledOn = armStats(allOn);
  payload.pooled = {
    off: pooledOff,
    on: pooledOn,
    deltaGroupA: pooledOn.groupA - pooledOff.groupA,
    deltaGroupB: pooledOn.groupB - pooledOff.groupB,
    improved: pooledOn.groupA + pooledOn.groupB < pooledOff.groupA + pooledOff.groupB,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));

  const md: string[] = [
    "# Step 7.7 Group A — local narration lexicon validation",
    "",
    `Generated: ${payload.generatedAt}`,
    `DATA_DIR: ${process.env.DATA_DIR} | filter=${process.env.EXAMPLE_DIALOG_SCENE_FILTER} | n=${n}/arm/scene`,
    "",
    "## Pooled (lexicon OFF vs ON, filter ON both arms)",
    "",
    "| arm | runs | Group A hits | Group B hits | runs w/ A | runs w/ B | rewrites | mean chars |",
    "|-----|------|--------------|--------------|-----------|-----------|----------|------------|",
    `| OFF | ${pooledOff.n} | ${pooledOff.groupA} | ${pooledOff.groupB} | ${pooledOff.runsWithA} | ${pooledOff.runsWithB} | — | ${pooledOff.meanChars} |`,
    `| ON | ${pooledOn.n} | ${pooledOn.groupA} | ${pooledOn.groupB} | ${pooledOn.runsWithA} | ${pooledOn.runsWithB} | ${pooledOn.rewritten} | ${pooledOn.meanChars} |`,
    "",
    `Δ Group A: **${pooledOn.groupA - pooledOff.groupA}** | Δ Group B: **${pooledOn.groupB - pooledOff.groupB}**`,
    "",
  ];

  for (const sceneId of SCENE_IDS) {
    const block = (payload.perScene as Record<string, { off: typeof pooledOff; on: typeof pooledOn; deltaGroupA: number; deltaGroupB: number; onRows: SampleRow[] }>)[sceneId];
    md.push(`## ${sceneId}`, "", `ΔA=${block.deltaGroupA}, ΔB=${block.deltaGroupB}`, "");
    const hitRuns = block.onRows.filter((r) => r.rewritten || r.groupA > 0 || r.groupB > 0);
    if (hitRuns.length) {
      md.push("| run | arm | rewritten | A | B | snippet |", "|-----|-----|-----------|---|---|---------|");
      for (const r of hitRuns.slice(0, 8)) {
        md.push(`| ${r.run} | ON | ${r.rewritten} | ${r.groupA} | ${r.groupB} | ${(r.snippets[0] ?? "—").slice(0, 60)} |`);
      }
      md.push("");
    }
  }

  writeFileSync(OUT_MD, md.join("\n"));
  console.log(`Wrote ${OUT_JSON} and ${OUT_MD}`);

  if (!reportOnly && !doGenerate) {
    console.log("Use --generate to run API calls, or --report to rebuild markdown from cache.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
