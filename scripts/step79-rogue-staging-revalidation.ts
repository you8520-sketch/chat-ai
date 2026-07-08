/**
 * Step 7.9 — Rogue (1-register banmal) representative re-validation, staging path.
 *
 * Group 2 of the phased rollout: same pipeline as Step 7.8 (Ren) but for a
 * rough/direct banmal-only character. Reduced n=10 API calls (5 pairs).
 * Gate: banmal compliance must not regress > -5pp, Group A lexicon must not increase.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step79-rogue-staging-revalidation.ts --dry-run
 *   npm.cmd exec tsx -- scripts/step79-rogue-staging-revalidation.ts --fresh
 *   npm.cmd exec tsx -- scripts/step79-rogue-staging-revalidation.ts --analyze-only
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
const ROGUE_NAME = "차서진";

/** Untagged creator-style card — 1-register banmal, rough/direct tone. */
const ROGUE_SYSTEM_PROMPT = `# 이름
차서진 (29)

# 정체성
성별: 남성. 뒷골목 해결사. 의뢰받은 일은 끝까지 마무리한다.

# 말투
- 항상 반말. 짧고 직설적으로 끊어 말한다.
- 존댓말은 절대 쓰지 않는다. 비꼴 때만 과장된 존칭을 흉내낸다.

# 성격
무뚝뚝하고 계산이 빠르다. 필요한 말만 한다. 빚지는 걸 싫어한다.

# 외형
짙은 회색 머리, 왼쪽 눈썹의 흉터. 검은 가죽 장갑.`;

const ROGUE_WORLD = `# 세계관
네온 간판이 뒤덮인 우범지대. 경찰보다 해결사가 빠른 동네. 정보와 빚이 화폐처럼 돈다.`;

const ROGUE_EXAMPLE_UNTAGGED = `유저: 의뢰 하나 하자.
차서진: …선금부터. 얘기는 그다음이야.
유저: 다쳤어?
차서진: 신경 꺼. 일이나 말해.
유저: 고마웠어, 지난번.
차서진: 빚으로 달아놨어. 갚을 생각이나 해.
유저: 오늘 밤 위험할까?
차서진: 위험하니까 내가 가는 거야. 넌 빠져.`;

type RogueScene = {
  id: string;
  label: string;
  runs: number;
  currentUserMessage: string;
  shortTermHistory: { role: "user" | "assistant"; content: string }[];
};

/** 5 pairs total = 10 API calls (reduced validation). */
const ROGUE_SCENES: RogueScene[] = [
  {
    id: "rogue-private-0",
    label: "둘만·본심",
    runs: 3,
    currentUserMessage: "렌: …서진. 지금 우리 둘뿐이야. 솔직히 말해봐.",
    shortTermHistory: [
      { role: "user", content: "…잠깐 얘기 좀 해." },
      { role: "assistant", content: `차서진은 담배를 비벼 끄고 고개를 들었다.\n\n"…말해."` },
    ],
  },
  {
    id: "rogue-job-0",
    label: "의뢰·긴장",
    runs: 2,
    currentUserMessage: "렌: 이번 일, 너 혼자 가는 거 아니지?",
    shortTermHistory: [
      { role: "user", content: "…지도 봤어. 그 창고, 함정 같아." },
      { role: "assistant", content: `차서진은 지도를 접어 주머니에 넣었다.\n\n"알아."` },
    ],
  },
];

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
  pairs: PairRecord[];
};

function analyzeSample(text: string): SampleMetrics {
  const comp = evaluateRegisterCompliance(text, "banmal");
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

async function ensureRogueStagingCharacter(): Promise<{ id: number; taggedExample: string }> {
  const { getDb } = await import("@/lib/db");
  const db = getDb();

  const existing = db
    .prepare(`SELECT id, example_dialog FROM characters WHERE name = ?`)
    .get(ROGUE_NAME) as { id: number; example_dialog: string } | undefined;

  let id: number;
  if (existing) {
    id = existing.id;
  } else {
    const info = db
      .prepare(
        `INSERT INTO characters (name, gender, system_prompt, world, example_dialog) VALUES (?, ?, ?, ?, ?)`
      )
      .run(ROGUE_NAME, "male", ROGUE_SYSTEM_PROMPT, ROGUE_WORLD, ROGUE_EXAMPLE_UNTAGGED);
    id = Number(info.lastInsertRowid);
    console.log(`Inserted Rogue staging character id=${id}`);
  }

  const speechSection = ROGUE_SYSTEM_PROMPT.match(/# 말투\n([\s\S]*?)(?=\n#|$)/)?.[1] ?? "";
  const tagged = autoTagExampleDialog(ROGUE_EXAMPLE_UNTAGGED, speechSection);
  if (!tagged.valid) throw new Error(`Auto-tag invalid: ${tagged.validationErrors.join("; ")}`);
  return { id, taggedExample: tagged.tagged };
}

async function buildRogueContext(
  characterId: number,
  scene: RogueScene,
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
  if (!row) throw new Error(`Rogue staging id=${characterId} not found`);

  // Pin BOTH arms to Korean canon (same confound guard as Step 7.8).
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
    userNote: formatUserNoteForPrompt("서진과 몇 번 일을 같이 한 사이."),
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
    genres: ["느와르/도시"],
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
        requestKind: "step79-rogue-staging-revalidation",
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
  { key: "registerComplianceRate", label: "Register compliance % (banmal)", higherIsBetter: true },
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

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "step79-rogue-staging-checkpoint.json");
  const resultPath = join(outDir, "step79-rogue-staging-revalidation.json");
  const mdPath = join(outDir, "step79-rogue-staging-revalidation.md");

  const { id: rogueId, taggedExample } = await ensureRogueStagingCharacter();
  const { buildContext } = await import("@/services/contextBuilder");

  console.log("=== Step 7.9 — Rogue (1-register banmal) staging re-validation ===");
  console.log(`Rogue staging id=${rogueId} | DATA_DIR=${process.env.DATA_DIR}`);
  console.log(`Untagged example: ${ROGUE_EXAMPLE_UNTAGGED.length} chars`);
  console.log(`Auto-tagged example: ${taggedExample.length} chars`);
  console.log(taggedExample.split("\n").map((l) => `  | ${l}`).join("\n"));

  async function contextFor(
    arm: "untagged_baseline" | "tagged_filtered",
    scene: RogueScene
  ): Promise<{ system: string; history: { role: "user" | "assistant"; content: string }[] }> {
    const example = arm === "tagged_filtered" ? taggedExample : ROGUE_EXAMPLE_UNTAGGED;
    const prevFilter = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = arm === "tagged_filtered" ? "1" : "0";
    try {
      const built = buildContext(await buildRogueContext(rogueId, scene, example));
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

  const s0 = ROGUE_SCENES[0]!;
  const baseLen = (await contextFor("untagged_baseline", s0)).system.length;
  const tagLen = (await contextFor("tagged_filtered", s0)).system.length;
  const totalPairs = ROGUE_SCENES.reduce((s, sc) => s + sc.runs, 0);
  console.log(
    `Scenes: ${ROGUE_SCENES.map((s) => `${s.id}x${s.runs}`).join(", ")} | Pairs: ${totalPairs} | API: ${totalPairs * 2}`
  );
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

    checkpoint = { model, temperature: TEMPERATURE, pairs: existing?.pairs ?? [] };
    const done = new Set(checkpoint.pairs.map((p) => pairKey(p.sceneId, p.runIndex)));
    let completed = done.size;

    for (const scene of ROGUE_SCENES) {
      const beforeCtx = await contextFor("untagged_baseline", scene);
      const afterCtx = await contextFor("tagged_filtered", scene);

      for (let runIndex = 0; runIndex < scene.runs; runIndex++) {
        const key = pairKey(scene.id, runIndex);
        if (done.has(key)) continue;
        console.log(`[${++completed}/${totalPairs}] ${scene.id} run ${runIndex + 1}/${scene.runs}`);

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

  const noComplianceRegression = comp.improvement.mean >= -5;
  const noLexiconRegression = lex.after.mean <= lex.before.mean;
  const reproduced = noComplianceRegression && noLexiconRegression;

  const verdictReason = reproduced
    ? `1-register banmal safe: compliance Δ${comp.improvement.mean}pp (${comp.before.mean}%→${comp.after.mean}%), lexicon ${lex.before.mean}→${lex.after.mean}`
    : `Regression: compliance Δ${comp.improvement.mean}pp or lexicon ${lex.before.mean}→${lex.after.mean}`;

  const result = {
    test: "step79-rogue-staging-revalidation",
    registerPattern: "1-register banmal (Rogue)",
    pipeline: "autoTagExampleDialog (tagging-only)",
    harnessPath: "staging_db",
    rogueCharacterId: rogueId,
    dataDir: process.env.DATA_DIR,
    model: checkpoint.model,
    scenes: ROGUE_SCENES.map((s) => ({ id: s.id, runs: s.runs })),
    pairedSamples: checkpoint.pairs.length,
    untaggedExample: ROGUE_EXAMPLE_UNTAGGED,
    taggedExample,
    metrics: reports,
    verdict: { reproduced, reason: verdictReason },
    pairs: checkpoint.pairs,
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  const md: string[] = [
    "# Step 7.9 — Rogue (1-register banmal) staging re-validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Rogue staging id=${rogueId} | pipeline: auto-tag (tagging-only) | paired n=${checkpoint.pairs.length} | API=${checkpoint.pairs.length * 2}`,
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
