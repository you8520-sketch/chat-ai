/**
 * Step 7.8 — Ren (1-register haeyo) representative re-validation, staging path.
 *
 * Pipeline: insert Ren staging character into LOCAL DB → auto-tag example_dialog
 * (tagging-only) → paired n runs: untagged baseline vs auto-tagged + filter ON.
 * Measures register compliance (haeyo) + Group A lexicon hits. No Railway.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step78-ren-staging-revalidation.ts --dry-run
 *   npm.cmd exec tsx -- scripts/step78-ren-staging-revalidation.ts --fresh --runs=5
 *   npm.cmd exec tsx -- scripts/step78-ren-staging-revalidation.ts --analyze-only
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { autoTagExampleDialog } from "./lib/autoTagExampleDialog";
import { evaluateRegisterCompliance } from "@/lib/characterRegisterCompliance";
import { detectRegisterLexiconInNarration } from "@/lib/speechLock/narrationLexicon";
import { analyzeGroupBMetaAudit } from "./lib/group-b-meta-audit-metrics";
import { buildPairedMetricReport, type PairedMetricReport } from "./lib/paired-comparison-stats";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import type { ContextBuildInput } from "@/types";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}
if (!process.env.DATA_DIR) process.env.DATA_DIR = "data";

const TEMPERATURE = 0.85;
const DEFAULT_RUNS = 5;
const REN_NAME = "백하율";

/** Untagged creator-style card — what a real 1-register character looks like pre-migration. */
const REN_SYSTEM_PROMPT = `# 이름
백하율 (27)

# 정체성
성별: 남성. 심야 서점 '하율책방' 주인.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말
- 놀랄 때: 문장이 짧아진다

# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다. 손님의 기척을 책장 넘기는 소리로 구분한다.

# 외형
검은 머리, 회색 눈. 얇은 은테 안경.`;

const REN_WORLD = `# 세계관
현대 도시. 심야에만 여는 서점과 골목이 있는 조용한 동네. 초자연적 존재와 일반인이 공존한다는 소문이 있다.`;

const REN_EXAMPLE_UNTAGGED = `유저: 밤산책 갈래?
백하율: …필요하면요.
유저: …괜찮아?
백하율: …그래요. 걱정 말아요.
유저: 오늘도 바쁘지?
백하율: …조금요. 그쪽은요?
유저: …방금 소리 들었어?
백하율: …들었어요. 잠깐만요.`;

type RenScene = {
  id: string;
  label: string;
  currentUserMessage: string;
  shortTermHistory: { role: "user" | "assistant"; content: string }[];
};

const REN_SCENES: RenScene[] = [
  {
    id: "ren-private-0",
    label: "둘만·솔직",
    currentUserMessage: "렌: …하율 씨, 지금 우리 둘뿐이에요. 솔직히 말해봐요.",
    shortTermHistory: [
      { role: "user", content: "…오늘 밤, 잠깐만 이야기할래요?" },
      { role: "assistant", content: `백하율은 책을 덮고 조용히 고개를 끄덕였다.\n\n"…알겠어요."` },
    ],
  },
  {
    id: "ren-night-0",
    label: "밤·가까이",
    currentUserMessage: "렌: …가까이 와도 돼요?",
    shortTermHistory: [
      { role: "user", content: "…불 끌까요?" },
      { role: "assistant", content: `백하율은 시선을 피하지 않았다.\n\n"…그래요."` },
    ],
  },
];

function parseRunsArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (!arg) return DEFAULT_RUNS;
  const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUNS;
}

type SampleMetrics = {
  registerComplianceRate: number;
  driftKinds: string[];
  groupALexiconHits: number;
  groupBMetaCount: number;
  chars: number;
};

type SampleRecord = {
  sceneId: string;
  runIndex: number;
  arm: "untagged_baseline" | "tagged_filtered";
  text: string;
  metrics: SampleMetrics;
};

type PairRecord = {
  sceneId: string;
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

function analyzeSample(text: string): SampleMetrics {
  const comp = evaluateRegisterCompliance(text, "haeyo");
  const lex = detectRegisterLexiconInNarration(text);
  const gb = analyzeGroupBMetaAudit(text);
  return {
    registerComplianceRate: comp.complianceRate,
    driftKinds: comp.driftKinds,
    groupALexiconHits: lex.fail ? lex.hits.length : 0,
    groupBMetaCount: gb.groupBMetaCount,
    chars: text.length,
  };
}

async function ensureRenStagingCharacter(): Promise<{ id: number; taggedExample: string }> {
  const { getDb } = await import("@/lib/db");
  const db = getDb();

  const existing = db
    .prepare(`SELECT id, example_dialog FROM characters WHERE name = ?`)
    .get(REN_NAME) as { id: number; example_dialog: string } | undefined;

  let id: number;
  if (existing) {
    id = existing.id;
  } else {
    const info = db
      .prepare(
        `INSERT INTO characters (name, gender, system_prompt, world, example_dialog) VALUES (?, ?, ?, ?, ?)`
      )
      .run(REN_NAME, "male", REN_SYSTEM_PROMPT, REN_WORLD, REN_EXAMPLE_UNTAGGED);
    id = Number(info.lastInsertRowid);
    console.log(`Inserted Ren staging character id=${id}`);
  }

  const speechSection = REN_SYSTEM_PROMPT.match(/# 말투\n([\s\S]*?)(?=\n#|$)/)?.[1] ?? "";
  const tagged = autoTagExampleDialog(REN_EXAMPLE_UNTAGGED, speechSection);
  if (!tagged.valid) throw new Error(`Auto-tag invalid: ${tagged.validationErrors.join("; ")}`);
  return { id, taggedExample: tagged.tagged };
}

async function buildRenContext(
  characterId: number,
  scene: RenScene,
  exampleDialog: string
): Promise<ContextBuildInput> {
  const { getDb } = await import("@/lib/db");
  const { loadCharacterChunksForPrompt } = await import("@/lib/characterChunks");
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks, setting_chunks_en,
              prompt_translation_hash, speech_profile FROM characters WHERE id = ?`
    )
    .get(characterId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Ren staging id=${characterId} not found`);

  // Pin BOTH arms to Korean canon: passing setting_chunks_en would let the
  // untagged arm use the English translation while the tagged arm (different
  // example_dialog → hash mismatch) falls back to Korean — a canon-language
  // confound, same class as the Step 7.6c fixture/staging mismatch.
  const { chunks } = loadCharacterChunksForPrompt(
    {
      id: row.id as number,
      name: row.name as string,
      gender: row.gender as string,
      system_prompt: row.system_prompt as string,
      world: row.world as string,
      example_dialog: exampleDialog,
      setting_chunks: row.setting_chunks as string | undefined,
      setting_chunks_en: undefined,
      prompt_translation_hash: undefined,
      speech_profile: row.speech_profile as string | undefined,
    },
    "렌",
    "렌"
  );

  return {
    charName: row.name as string,
    personaDisplayName: "렌",
    userNickname: "렌",
    chunks,
    userPersona: formatSelectedPersonaForPrompt("렌", "other", "20대. 직설적."),
    userNote: formatUserNoteForPrompt("하율과 오래 알고 지낸 사이."),
    longTermMemory: "",
    memoryMeta: "",
    shortTermHistory: scene.shortTermHistory,
    currentUserMessage: scene.currentUserMessage,
    nsfw: true,
    gender: "male",
    userPersonaGender: "other",
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3200,
    completedTurns: 8,
    genres: ["현대/일상"],
    provider: "openrouter",
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  };
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
        requestKind: "step78-ren-staging-revalidation",
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

type MetricDef = { key: keyof SampleMetrics; label: string; higherIsBetter: boolean };
const METRIC_DEFS: MetricDef[] = [
  { key: "registerComplianceRate", label: "Register compliance % (haeyo)", higherIsBetter: true },
  { key: "groupALexiconHits", label: "Group A lexicon hits (narration)", higherIsBetter: false },
  { key: "groupBMetaCount", label: "Group B meta hits (reference)", higherIsBetter: false },
];

function buildReports(pairs: PairRecord[]): PairedMetricReport[] {
  return METRIC_DEFS.map((def) => {
    const beforeValues: number[] = [];
    const afterValues: number[] = [];
    const improvements: number[] = [];
    let wins = 0;
    let ties = 0;
    for (const p of pairs) {
      const b = p.before.metrics[def.key] as number;
      const a = p.after.metrics[def.key] as number;
      beforeValues.push(b);
      afterValues.push(a);
      const imp = def.higherIsBetter ? a - b : b - a;
      improvements.push(imp);
      if (a === b) ties++;
      else if (imp > 0) wins++;
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const fresh = process.argv.includes("--fresh");
  const analyzeOnly = process.argv.includes("--analyze-only");
  const runsPerScene = parseRunsArg();

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "step78-ren-staging-checkpoint.json");
  const resultPath = join(outDir, "step78-ren-staging-revalidation.json");
  const mdPath = join(outDir, "step78-ren-staging-revalidation.md");

  const { id: renId, taggedExample } = await ensureRenStagingCharacter();
  const { buildContext } = await import("@/services/contextBuilder");

  console.log("=== Step 7.8 — Ren (1-register haeyo) staging re-validation ===");
  console.log(`Ren staging id=${renId} | DATA_DIR=${process.env.DATA_DIR}`);
  console.log(`Untagged example: ${REN_EXAMPLE_UNTAGGED.length} chars`);
  console.log(`Auto-tagged example: ${taggedExample.length} chars`);
  console.log(taggedExample.split("\n").map((l) => `  | ${l}`).join("\n"));

  async function contextFor(
    arm: "untagged_baseline" | "tagged_filtered",
    scene: RenScene
  ): Promise<{ system: string; history: { role: "user" | "assistant"; content: string }[] }> {
    const example = arm === "tagged_filtered" ? taggedExample : REN_EXAMPLE_UNTAGGED;
    const prevFilter = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = arm === "tagged_filtered" ? "1" : "0";
    try {
      const built = buildContext(await buildRenContext(renId, scene, example));
      return {
        system: built.systemPrompt,
        history: built.history
          .filter(
            (m): m is { role: "user" | "assistant"; content: string } =>
              (m.role === "user" || m.role === "assistant") && Boolean(m.content?.trim())
          )
          .map((m) => ({ role: m.role, content: m.content ?? "" })),
      };
    } finally {
      if (prevFilter === undefined) delete process.env.EXAMPLE_DIALOG_SCENE_FILTER;
      else process.env.EXAMPLE_DIALOG_SCENE_FILTER = prevFilter;
    }
  }

  const s0 = REN_SCENES[0]!;
  const baseLen = (await contextFor("untagged_baseline", s0)).system.length;
  const tagLen = (await contextFor("tagged_filtered", s0)).system.length;
  const totalPairs = REN_SCENES.length * runsPerScene;
  console.log(`Scenes: ${REN_SCENES.map((s) => s.id).join(", ")} | Runs: ${runsPerScene} | API: ${totalPairs * 2}`);
  console.log(`System len: untagged=${baseLen} tagged+filter=${tagLen} (Δ${tagLen - baseLen})`);

  if (dryRun) {
    console.log("\n--dry-run: skipping API");
    return;
  }

  if (fresh && existsSync(checkpointPath)) {
    unlinkSync(checkpointPath);
    console.log("Cleared checkpoint (--fresh)");
  }

  let checkpoint: Checkpoint;
  if (analyzeOnly) {
    if (!existsSync(checkpointPath)) {
      console.error("No checkpoint");
      process.exit(1);
    }
    checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint;
    // Re-score from raw text so scorer fixes apply without new API calls.
    for (const p of checkpoint.pairs) {
      p.before.metrics = analyzeSample(p.before.text);
      p.after.metrics = analyzeSample(p.after.text);
    }
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

    checkpoint = { model, temperature: TEMPERATURE, runsPerScene, pairs: existing?.pairs ?? [] };
    const done = new Set(checkpoint.pairs.map((p) => pairKey(p.sceneId, p.runIndex)));
    let completed = done.size;

    for (const scene of REN_SCENES) {
      const beforeCtx = await contextFor("untagged_baseline", scene);
      const afterCtx = await contextFor("tagged_filtered", scene);

      for (let runIndex = 0; runIndex < runsPerScene; runIndex++) {
        const key = pairKey(scene.id, runIndex);
        if (done.has(key)) continue;
        console.log(`[${++completed}/${totalPairs}] ${scene.id} run ${runIndex + 1}/${runsPerScene}`);

        const beforeText = await generateSample(callOpenRouterCompletion, model, beforeCtx.system, beforeCtx.history);
        const afterText = await generateSample(callOpenRouterCompletion, model, afterCtx.system, afterCtx.history);

        checkpoint.pairs.push({
          sceneId: scene.id,
          runIndex,
          before: { sceneId: scene.id, runIndex, arm: "untagged_baseline", text: beforeText, metrics: analyzeSample(beforeText) },
          after: { sceneId: scene.id, runIndex, arm: "tagged_filtered", text: afterText, metrics: analyzeSample(afterText) },
        });
        done.add(key);
        writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
      }
    }
  }

  const reports = buildReports(checkpoint.pairs);
  const comp = reports.find((r) => r.metricKey === "registerComplianceRate")!;
  const lex = reports.find((r) => r.metricKey === "groupALexiconHits")!;

  // Gate for 1-register: tagged+filter must NOT regress compliance (Δ ≥ −5pp mean) and lexicon must not increase.
  const noComplianceRegression = comp.improvement.mean >= -5;
  const noLexiconRegression = lex.after.mean <= lex.before.mean;
  const reproduced = noComplianceRegression && noLexiconRegression;

  const verdictReason = reproduced
    ? `1-register safe: compliance Δ${comp.improvement.mean}pp (${comp.before.mean}%→${comp.after.mean}%), lexicon ${lex.before.mean}→${lex.after.mean}`
    : `Regression: compliance Δ${comp.improvement.mean}pp or lexicon ${lex.before.mean}→${lex.after.mean}`;

  const result = {
    test: "step78-ren-staging-revalidation",
    registerPattern: "1-register haeyo (Ren)",
    pipeline: "autoTagExampleDialog (tagging-only)",
    harnessPath: "staging_db",
    renCharacterId: renId,
    dataDir: process.env.DATA_DIR,
    model: checkpoint.model,
    runsPerScene: checkpoint.runsPerScene,
    scenes: REN_SCENES.map((s) => s.id),
    pairedSamples: checkpoint.pairs.length,
    untaggedExample: REN_EXAMPLE_UNTAGGED,
    taggedExample,
    metrics: reports,
    verdict: { reproduced, reason: verdictReason },
    pairs: checkpoint.pairs,
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  const md: string[] = [
    "# Step 7.8 — Ren (1-register haeyo) staging re-validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Ren staging id=${renId} | pipeline: auto-tag (tagging-only) | paired n=${checkpoint.pairs.length} | API=${checkpoint.pairs.length * 2}`,
    "",
    "Arms: untagged baseline (filter off) vs auto-tagged + EXAMPLE_DIALOG_SCENE_FILTER=1",
    "",
    "| metric | untagged | tagged+filter | Δ mean | winRate | p | verdict |",
    "|--------|----------|---------------|--------|---------|---|---------|",
  ];
  for (const r of reports) {
    const sig = r.significantAt95 ? "*" : "";
    md.push(
      `| ${r.label}${sig} | ${r.before.mean} | ${r.after.mean} | ${r.improvement.mean} | ${(r.winRate * 100).toFixed(0)}% | ${r.pairedTPValue} | ${r.verdict} |`
    );
  }
  md.push("", `## Verdict: **${reproduced ? "SAFE (no regression)" : "REGRESSION"}**`, "", verdictReason, "");
  writeFileSync(mdPath, md.join("\n"), "utf8");

  console.log("\n=== Metrics (untagged → tagged+filter) ===");
  for (const r of reports) {
    console.log(
      `${r.label}: before=${r.before.mean} after=${r.after.mean} Δ=${r.improvement.mean} winRate=${(r.winRate * 100).toFixed(0)}% p=${r.pairedTPValue}`
    );
  }
  console.log(`\n=== Verdict: ${reproduced ? "SAFE" : "REGRESSION"} ===`);
  console.log(verdictReason);
  console.log(`Wrote ${resultPath}`);
  process.exit(reproduced ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
