/**
 * Step 7.10 — Kalian (id=22, 1-register banmal, Group 2) staging re-validation.
 *
 * Kalian is a REAL operational character. His card has no example_dialog;
 * the "[대사 예시]" prose inside system_prompt is extracted into user–char
 * pairs (character lines VERBATIM from the card, user cues added), then the
 * same auto-tag + filter ablation as Step 7.9 (차서진) is run: n=10 API
 * (5 pairs × 2 arms). On SAFE verdict, the auto-tagged example_dialog is
 * written to the local DB (id=22). No Railway.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step710-kalian-staging-revalidation.ts --dry-run
 *   npm.cmd exec tsx -- scripts/step710-kalian-staging-revalidation.ts --fresh
 *   npm.cmd exec tsx -- scripts/step710-kalian-staging-revalidation.ts --analyze-only
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
const KALIAN_ID = 22;
const KALIAN_NAME = "칼리안";

/**
 * Extracted from the card's "[대사 예시]" prose. Character lines are VERBATIM
 * (tone preserved); user lines are situational cues matching the card's
 * 평소 / 침대·약해짐 / 질투 labels.
 */
const KALIAN_EXAMPLE_UNTAGGED = `유저: (고개를 들어 황제의 눈을 똑바로 바라본다) 내가 뭘 잘못했는데.
칼리안: 건방진 것. 감히 황제의 눈을 똑바로 쳐다봐? 주제를 알아라.
유저: …이제 그만 가볼게.
칼리안: 가지 마. 제발... 머리가 깨질 것 같아. 네 냄새가 필요해.
유저: 아까 사히르가 상처를 봐줬어.
칼리안: 그 새끼가 널 만졌나? 그 손 당장 잘라버려야겠군.`;

type Scene = {
  id: string;
  label: string;
  runs: number;
  currentUserMessage: string;
  shortTermHistory: { role: "user" | "assistant"; content: string }[];
};

/** 5 pairs total = 10 API calls (Group 2 reduced validation, same as 차서진). */
const KALIAN_SCENES: Scene[] = [
  {
    id: "kalian-day-0",
    label: "낮·대치",
    runs: 3,
    currentUserMessage: "렌: 난 네 노예가 아니야. 오늘은 무릎 꿇지 않겠어.",
    shortTermHistory: [
      { role: "user", content: "…또 알현실로 부른 이유가 뭐야." },
      { role: "assistant", content: `칼리안은 옥좌에 비스듬히 기대 금색 눈을 가늘게 떴다.\n\n"네가 내 것이라는 걸 저놈들에게 보여주기 위해서다."` },
    ],
  },
  {
    id: "kalian-night-0",
    label: "밤·불면",
    runs: 2,
    currentUserMessage: "렌: …오늘도 못 잤어? 이리 와.",
    shortTermHistory: [
      { role: "user", content: "…불 끌까?" },
      { role: "assistant", content: `칼리안은 침대 모서리에 앉아 관자놀이를 짚고 있었다.\n\n"…꺼라."` },
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

async function prepareKalian(): Promise<{ taggedExample: string; speechSection: string }> {
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const row = db
    .prepare(`SELECT id, name, system_prompt, example_dialog FROM characters WHERE id = ?`)
    .get(KALIAN_ID) as { id: number; name: string; system_prompt: string; example_dialog: string } | undefined;
  if (!row) throw new Error(`Kalian id=${KALIAN_ID} not found in ${process.env.DATA_DIR}`);
  if (row.name !== KALIAN_NAME) throw new Error(`Safety: id=${KALIAN_ID} name="${row.name}" is not ${KALIAN_NAME}`);

  // 1-register banmal card: no 공적/사적 register split declared, so the
  // register-map path stays inactive and pairs fall to cue/default handling.
  const speechSection = "- 항상 반말. 하대와 명령조. 존댓말을 쓰지 않는다.";
  const tagged = autoTagExampleDialog(KALIAN_EXAMPLE_UNTAGGED, speechSection);
  if (!tagged.valid) throw new Error(`Auto-tag invalid: ${tagged.validationErrors.join("; ")}`);
  return { taggedExample: tagged.tagged, speechSection };
}

async function buildKalianContext(scene: Scene, exampleDialog: string): Promise<ContextBuildInput> {
  const { getDb } = await import("@/lib/db");
  const { loadCharacterChunksForPrompt } = await import("@/lib/characterChunks");
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks, setting_chunks_en,
              prompt_translation_hash, speech_profile FROM characters WHERE id = ?`
    )
    .get(KALIAN_ID) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Kalian id=${KALIAN_ID} not found`);

  // Pin BOTH arms to Korean canon (same confound guard as Step 7.8/7.9).
  const { chunks } = loadCharacterChunksForPrompt(
    {
      id: row.id as number,
      name: row.name as string,
      gender: row.gender as string,
      system_prompt: row.system_prompt as string,
      world: (row.world as string) ?? "",
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
    userPersona: formatSelectedPersonaForPrompt("렌", "other", "멸망한 왕국의 마지막 왕족."),
    userNote: formatUserNoteForPrompt("칼리안의 전리품으로 황궁에 끌려온 처지."),
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
    genres: ["판타지/로맨스"],
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
        requestKind: "step710-kalian-staging-revalidation",
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

async function applyTaggedToDb(taggedExample: string): Promise<boolean> {
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const row = db
    .prepare(`SELECT example_dialog FROM characters WHERE id = ? AND name = ?`)
    .get(KALIAN_ID, KALIAN_NAME) as { example_dialog: string } | undefined;
  if (!row) throw new Error("Kalian row disappeared");
  if ((row.example_dialog ?? "").trim() === taggedExample.trim()) return false;
  db.prepare(`UPDATE characters SET example_dialog = ? WHERE id = ? AND name = ?`).run(
    taggedExample,
    KALIAN_ID,
    KALIAN_NAME
  );
  return true;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const fresh = process.argv.includes("--fresh");
  const analyzeOnly = process.argv.includes("--analyze-only");

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "step710-kalian-staging-checkpoint.json");
  const resultPath = join(outDir, "step710-kalian-staging-revalidation.json");
  const mdPath = join(outDir, "step710-kalian-staging-revalidation.md");

  const { taggedExample } = await prepareKalian();
  const { buildContext } = await import("@/services/contextBuilder");

  console.log("=== Step 7.10 — Kalian (1-register banmal, Group 2) staging re-validation ===");
  console.log(`Kalian id=${KALIAN_ID} | DATA_DIR=${process.env.DATA_DIR}`);
  console.log(`Untagged example: ${KALIAN_EXAMPLE_UNTAGGED.length} chars`);
  console.log(`Auto-tagged example: ${taggedExample.length} chars`);
  console.log(taggedExample.split("\n").map((l) => `  | ${l}`).join("\n"));

  async function contextFor(
    arm: "untagged_baseline" | "tagged_filtered",
    scene: Scene
  ): Promise<{ system: string; history: { role: "user" | "assistant"; content: string }[] }> {
    const example = arm === "tagged_filtered" ? taggedExample : KALIAN_EXAMPLE_UNTAGGED;
    const prevFilter = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = arm === "tagged_filtered" ? "1" : "0";
    try {
      const built = buildContext(await buildKalianContext(scene, example));
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

  const s0 = KALIAN_SCENES[0]!;
  const baseLen = (await contextFor("untagged_baseline", s0)).system.length;
  const tagLen = (await contextFor("tagged_filtered", s0)).system.length;
  const totalPairs = KALIAN_SCENES.reduce((s, sc) => s + sc.runs, 0);
  console.log(
    `Scenes: ${KALIAN_SCENES.map((s) => `${s.id}x${s.runs}`).join(", ")} | Pairs: ${totalPairs} | API: ${totalPairs * 2}`
  );
  console.log(`System len: untagged=${baseLen} tagged+filter=${tagLen} (Δ${tagLen - baseLen})`);

  if (dryRun) {
    console.log("\n--dry-run: skipping API (no DB write)");
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

    for (const scene of KALIAN_SCENES) {
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

  let dbApplied = false;
  if (reproduced) {
    dbApplied = await applyTaggedToDb(taggedExample);
  }

  const verdictReason = reproduced
    ? `1-register banmal safe: compliance Δ${comp.improvement.mean}pp (${comp.before.mean}%→${comp.after.mean}%), lexicon ${lex.before.mean}→${lex.after.mean}. DB example_dialog ${dbApplied ? "APPLIED (local)" : "already up to date"}.`
    : `Regression: compliance Δ${comp.improvement.mean}pp or lexicon ${lex.before.mean}→${lex.after.mean}. DB NOT touched.`;

  const result = {
    test: "step710-kalian-staging-revalidation",
    registerPattern: "1-register banmal (Kalian, Group 2)",
    pipeline: "card [대사 예시] extraction + autoTagExampleDialog (tagging-only)",
    harnessPath: "staging_db",
    characterId: KALIAN_ID,
    dataDir: process.env.DATA_DIR,
    model: checkpoint.model,
    scenes: KALIAN_SCENES.map((s) => ({ id: s.id, runs: s.runs })),
    pairedSamples: checkpoint.pairs.length,
    untaggedExample: KALIAN_EXAMPLE_UNTAGGED,
    taggedExample,
    metrics: reports,
    verdict: { reproduced, dbApplied, reason: verdictReason },
    pairs: checkpoint.pairs,
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  const md: string[] = [
    "# Step 7.10 — Kalian (1-register banmal, Group 2) staging re-validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Kalian id=${KALIAN_ID} | card [대사 예시] → example_dialog extraction + auto-tag | paired n=${checkpoint.pairs.length} | API=${checkpoint.pairs.length * 2}`,
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
