/**
 * Step 7.11 — Hayujin (id=21, Group 3: emotion-based register switching) staging re-validation.
 *
 * Schema decision (documented in step711 report): Hayujin's 비꼼(mock-polite 해요)
 * ↔ 진심(banmal/비속어) axis is EMOTION-driven, not scene-driven, so no new tag
 * vocabulary is added. All pairs are tagged [사적] (single bucket) with mixed-tone
 * character lines preserved verbatim inside pairs; the scene filter then injects
 * all pairs in every scene (fallback behavior, unit-tested).
 *
 * Metrics: mixed compliance (formal/danakka drift only counts as miss — both
 * banmal AND haeyo are in-register for this character), banmal/haeyo share shift
 * (reference), Group A lexicon (gate), Group B meta (reference).
 * Full n=20 API (10 pairs × 2 arms) per Group 3 policy.
 *
 * Usage:
 *   npm.cmd exec tsx -- scripts/step711-hayujin-staging-revalidation.ts --dry-run
 *   npm.cmd exec tsx -- scripts/step711-hayujin-staging-revalidation.ts --fresh
 *   npm.cmd exec tsx -- scripts/step711-hayujin-staging-revalidation.ts --analyze-only
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { autoTagExampleDialog } from "./lib/autoTagExampleDialog";
import { classifyLineRegister, isNeutralScoringLine } from "@/lib/characterRegisterCompliance";
import { extractDialogueLines } from "@/lib/registerMetaAudit";
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
const HAYUJIN_ID = 21;
const HAYUJIN_NAME = "하유진";

/**
 * Extracted from the card's "유진의 말투예시" prose. Character lines VERBATIM;
 * user cues added. Mixed tones (비꼼 해요 + 진심 반말) kept inline per pair.
 */
const HAYUJIN_EXAMPLE_UNTAGGED = `유저: (하인들 앞에서) 오늘부터 넌 내 소유다. 예를 갖춰라.
하유진: 아, 예. 위대하신 황족 나리께서 친히 살려주셔서 정말 감~사하네요. 그래서, 이번엔 또 어디 팔다리를 자르러 가시나?
유저: (식사를 내려놓으며) 먹어. 식기 전에.
하유진: 독이라도 탔나? 아니면 다 낫게 해서 침대 위로 끌고 가려고? ...역겨우니까 그거 치워.
유저: …요즘 잠은 자? 얼굴이 안 좋아 보여.
하유진: 집에 가고 싶다... 아니, 그냥 다 죽이고 끝낼까.
유저: (목의 구속구를 살피며) 아프진 않아?
하유진: 내 목에 목줄 채우니까 재밌어? 변태 새끼들.`;

type Scene = {
  id: string;
  label: string;
  runs: number;
  currentUserMessage: string;
  shortTermHistory: { role: "user" | "assistant"; content: string }[];
};

/** 10 pairs total = 20 API calls (Group 3 full validation). */
const HAYUJIN_SCENES: Scene[] = [
  {
    id: "hayujin-command-0",
    label: "명령·비꼼 유발",
    runs: 5,
    currentUserMessage: "렌: 내일 연회에 데려갈 거다. 노예답게 조용히 따라와.",
    shortTermHistory: [
      { role: "user", content: "…몸은 좀 어때." },
      { role: "assistant", content: `하유진은 벽에 등을 기댄 채 고개도 들지 않았다.\n\n"살아는 있네요, 보시다시피. 감격스럽게도."` },
    ],
  },
  {
    id: "hayujin-care-0",
    label: "배려·방어 흔들림",
    runs: 5,
    currentUserMessage: "렌: (매운 냄새가 나는 국을 내려놓으며) …고향 음식 비슷하게 만들어 봤어. 입에 맞을지 모르겠지만.",
    shortTermHistory: [
      { role: "user", content: "…어제 밤새 기침 소리 들리던데." },
      { role: "assistant", content: `하유진은 낡은 담요를 어깨까지 끌어올리며 시선을 피했다.\n\n"...신경 꺼. 죽는 것도 내 마음대로 못 하는 처지니까."` },
    ],
  },
];

type SampleMetrics = {
  mixedComplianceRate: number;
  banmalShare: number;
  haeyoShare: number;
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

/**
 * Mixed-register compliance for emotion-switching characters: banmal AND haeyo
 * are both in-register; only formal/danakka (forbidden per speech_profile) and
 * unclassifiable polite-marker lines count as drift.
 */
function evaluateMixedCompliance(text: string): {
  rate: number;
  banmalShare: number;
  haeyoShare: number;
} {
  const lines = extractDialogueLines(text);
  const scorable = lines.filter((l) => !isNeutralScoringLine(l));
  if (scorable.length === 0) {
    return { rate: lines.length ? 100 : 0, banmalShare: 0, haeyoShare: 0 };
  }
  let match = 0;
  let banmal = 0;
  let haeyo = 0;
  for (const line of scorable) {
    const reg = classifyLineRegister(line);
    if (reg === "banmal") {
      banmal++;
      match++;
    } else if (reg === "haeyo") {
      haeyo++;
      match++;
    } else if (reg === "other") {
      // Unmarked line without polite/formal endings — banmal-consistent.
      match++;
      banmal++;
    }
    // formal / danakka → miss (forbidden patterns for this card)
  }
  const r = (n: number) => Math.round((n / scorable.length) * 1000) / 10;
  return { rate: r(match), banmalShare: r(banmal), haeyoShare: r(haeyo) };
}

function analyzeSample(text: string): SampleMetrics {
  const mixed = evaluateMixedCompliance(text);
  const lex = detectRegisterLexiconInNarration(text);
  const gb = analyzeGroupBMetaAudit(text);
  return {
    mixedComplianceRate: mixed.rate,
    banmalShare: mixed.banmalShare,
    haeyoShare: mixed.haeyoShare,
    groupALexiconHits: lex.fail ? lex.hits.length : 0,
    groupBMetaCount: gb.groupBMetaCount,
    chars: text.length,
  };
}

async function prepareHayujin(): Promise<{ taggedExample: string }> {
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const row = db
    .prepare(`SELECT id, name FROM characters WHERE id = ?`)
    .get(HAYUJIN_ID) as { id: number; name: string } | undefined;
  if (!row) throw new Error(`Hayujin id=${HAYUJIN_ID} not found in ${process.env.DATA_DIR}`);
  if (row.name !== HAYUJIN_NAME) throw new Error(`Safety: id=${HAYUJIN_ID} name="${row.name}" is not ${HAYUJIN_NAME}`);

  // No 공적/사적 register split in the card (emotion-based switching) →
  // register-map path inactive; pairs fall to cue/default → single [사적] bucket.
  const speechSection = "- 비꼬는 극존칭과 반말·비속어를 감정에 따라 섞어 쓴다.";
  const tagged = autoTagExampleDialog(HAYUJIN_EXAMPLE_UNTAGGED, speechSection);
  if (!tagged.valid) throw new Error(`Auto-tag invalid: ${tagged.validationErrors.join("; ")}`);
  return { taggedExample: tagged.tagged };
}

async function buildHayujinContext(scene: Scene, exampleDialog: string): Promise<ContextBuildInput> {
  const { getDb } = await import("@/lib/db");
  const { loadCharacterChunksForPrompt } = await import("@/lib/characterChunks");
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks, setting_chunks_en,
              prompt_translation_hash, speech_profile FROM characters WHERE id = ?`
    )
    .get(HAYUJIN_ID) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Hayujin id=${HAYUJIN_ID} not found`);

  // Pin BOTH arms to Korean canon (same confound guard as Step 7.8/7.9/7.10).
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
    userPersona: formatSelectedPersonaForPrompt("렌", "other", "벨로아의 황족. 처형식에서 하유진을 노예로 거둔 장본인."),
    userNote: formatUserNoteForPrompt("원작의 기억을 떠올린 뒤 하유진의 운명을 바꾸려 한다."),
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
        requestKind: "step711-hayujin-staging-revalidation",
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
  { key: "mixedComplianceRate", label: "Mixed compliance % (banmal+haeyo ok)", higherIsBetter: true },
  { key: "banmalShare", label: "Banmal share % (reference)", higherIsBetter: true },
  { key: "haeyoShare", label: "Haeyo/sarcasm share % (reference)", higherIsBetter: false },
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
    .get(HAYUJIN_ID, HAYUJIN_NAME) as { example_dialog: string } | undefined;
  if (!row) throw new Error("Hayujin row disappeared");
  if ((row.example_dialog ?? "").trim() === taggedExample.trim()) return false;
  db.prepare(`UPDATE characters SET example_dialog = ? WHERE id = ? AND name = ?`).run(
    taggedExample,
    HAYUJIN_ID,
    HAYUJIN_NAME
  );
  return true;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const fresh = process.argv.includes("--fresh");
  const analyzeOnly = process.argv.includes("--analyze-only");

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "step711-hayujin-staging-checkpoint.json");
  const resultPath = join(outDir, "step711-hayujin-staging-revalidation.json");
  const mdPath = join(outDir, "step711-hayujin-staging-revalidation.md");

  const { taggedExample } = await prepareHayujin();
  const { buildContext } = await import("@/services/contextBuilder");

  console.log("=== Step 7.11 — Hayujin (Group 3, emotion-based switching) staging re-validation ===");
  console.log(`Hayujin id=${HAYUJIN_ID} | DATA_DIR=${process.env.DATA_DIR}`);
  console.log(`Untagged example: ${HAYUJIN_EXAMPLE_UNTAGGED.length} chars`);
  console.log(`Auto-tagged example: ${taggedExample.length} chars`);
  console.log(taggedExample.split("\n").map((l) => `  | ${l}`).join("\n"));

  async function contextFor(
    arm: "untagged_baseline" | "tagged_filtered",
    scene: Scene
  ): Promise<{ system: string; history: { role: "user" | "assistant"; content: string }[] }> {
    const example = arm === "tagged_filtered" ? taggedExample : HAYUJIN_EXAMPLE_UNTAGGED;
    const prevFilter = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = arm === "tagged_filtered" ? "1" : "0";
    try {
      const built = buildContext(await buildHayujinContext(scene, example));
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

  const s0 = HAYUJIN_SCENES[0]!;
  const baseCtx = await contextFor("untagged_baseline", s0);
  const tagCtx = await contextFor("tagged_filtered", s0);
  const totalPairs = HAYUJIN_SCENES.reduce((s, sc) => s + sc.runs, 0);
  console.log(
    `Scenes: ${HAYUJIN_SCENES.map((s) => `${s.id}x${s.runs}`).join(", ")} | Pairs: ${totalPairs} | API: ${totalPairs * 2}`
  );
  console.log(`System len: untagged=${baseCtx.system.length} tagged+filter=${tagCtx.system.length} (Δ${tagCtx.system.length - baseCtx.system.length})`);
  // Sanity: filtered arm must retain BOTH tone families (mixed pairs intact).
  const filteredHasSarcasm = tagCtx.system.includes("감~사하네요");
  const filteredHasBanmal = tagCtx.system.includes("변태 새끼들");
  console.log(`Filtered arm example check: sarcasm=${filteredHasSarcasm} banmal=${filteredHasBanmal}`);
  if (!filteredHasSarcasm || !filteredHasBanmal) {
    throw new Error("Filtered arm lost a tone family — mixed-pair preservation broken");
  }

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

    for (const scene of HAYUJIN_SCENES) {
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
  const comp = reports.find((r) => r.metricKey === "mixedComplianceRate")!;
  const lex = reports.find((r) => r.metricKey === "groupALexiconHits")!;

  const noComplianceRegression = comp.improvement.mean >= -5;
  const noLexiconRegression = lex.after.mean <= lex.before.mean;
  const reproduced = noComplianceRegression && noLexiconRegression;

  let dbApplied = false;
  if (reproduced) {
    dbApplied = await applyTaggedToDb(taggedExample);
  }

  const verdictReason = reproduced
    ? `Group 3 (emotion-switch) safe: mixed compliance Δ${comp.improvement.mean}pp (${comp.before.mean}%→${comp.after.mean}%), lexicon ${lex.before.mean}→${lex.after.mean}. DB example_dialog ${dbApplied ? "APPLIED (local)" : "already up to date"}.`
    : `Regression: mixed compliance Δ${comp.improvement.mean}pp or lexicon ${lex.before.mean}→${lex.after.mean}. DB NOT touched.`;

  const result = {
    test: "step711-hayujin-staging-revalidation",
    registerPattern: "Group 3: emotion-based mixed register (비꼼 해요 ↔ 진심 반말)",
    schemaDecision:
      "No new tag vocabulary — emotion axis is not scene-inferable; single [사적] bucket with mixed-tone pairs preserved verbatim",
    pipeline: "card 말투예시 extraction + autoTagExampleDialog (tagging-only)",
    harnessPath: "staging_db",
    characterId: HAYUJIN_ID,
    dataDir: process.env.DATA_DIR,
    model: checkpoint.model,
    scenes: HAYUJIN_SCENES.map((s) => ({ id: s.id, runs: s.runs })),
    pairedSamples: checkpoint.pairs.length,
    untaggedExample: HAYUJIN_EXAMPLE_UNTAGGED,
    taggedExample,
    metrics: reports,
    verdict: { reproduced, dbApplied, reason: verdictReason },
    pairs: checkpoint.pairs,
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  const md: string[] = [
    "# Step 7.11 — Hayujin (Group 3, emotion-based switching) staging re-validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Hayujin id=${HAYUJIN_ID} | card 말투예시 → example_dialog + auto-tag | paired n=${checkpoint.pairs.length} | API=${checkpoint.pairs.length * 2}`,
    "",
    "## Schema decision",
    "",
    "비꼼(해요) ↔ 진심(반말) 전환은 감정 기반이라 씬 추론(`inferSceneRegisterContext`)으로 예측 불가 →",
    "새 태그([비꼼]/[진심]) 도입 없이 **단일 [사적] bucket + 혼합 톤 페어 보존**으로 처리.",
    "혼합 페어가 필터를 통과해도 두 톤이 모두 살아있음을 unit test + 하니스 사전 체크로 보장.",
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
