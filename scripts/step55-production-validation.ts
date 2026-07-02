/**
 * Step 5.5 — Production cleanup validation (Phases B–D)
 * Usage:
 *   npx tsx scripts/step55-production-validation.ts --compression-only
 *   npx tsx scripts/step55-production-validation.ts --generate
 *   npx tsx scripts/step55-production-validation.ts --report
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { loadEnvLocal } from "./load-env-local";
import type { CharacterGenre } from "@/lib/characterGenres";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildTurnHandoffAndPacingBlock } from "@/lib/turnHandoffAndPacing";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import {
  buildProductionContextForScene,
  type ProductionValidationScene,
} from "./lib/production-prompt-fixture";
import { auditWebnovelStyleText } from "./lib/webnovel-style-audit";
import { evaluateStyleQuality } from "./lib/style-quality-evaluation";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_JSON = join(process.cwd(), "output", "step55-rp-validation.json");
const OUT_MD = join(process.cwd(), "output", "step55-production-validation.md");
const OUT_COMP = join(process.cwd(), "output", "step55-compression.json");

/** Pre–Step 5.5 measured (horror OpenRouter fixture) */
const BEFORE_FULL_SYSTEM_TOK = 7806;

const DELETED_RULES = [
  "TH-FLOOR-EARLY-EXIT",
  "TERM-USER-TAIL",
  "TH-HANDOFF-STEP7",
  "TH-CALM-ENUM",
  "TH-RETURN-USER",
  "OUT-LAYOUT-EXAMPLES",
  "M2M-NO-PARA-MERGE-CLAUSE",
  "PROSE-SOT-HEADER",
  "RHYTHM-TENSION-OPEN",
  "GENRE-EMOTION-PHRASE",
  "LENGTH-GP-POINTER",
] as const;

const OWNER_MAP: Record<string, string> = {
  REGISTER: "PROSE STYLE",
  "GENERATION PROCESS": "PROSE STYLE (generationProcessBeatFlow.ts)",
  RHYTHM: "PROSE STYLE",
  SENSATION: "PROSE STYLE",
  EMOTION: "PROSE STYLE",
  MOVEMENT: "PROSE STYLE",
  WEBNOVEL_BREATH: "PROSE STYLE",
  LENGTH_NUMERIC: "LENGTH CONTROL",
  NO_INPUT_ECHO: "LENGTH CONTROL",
  SCENE_CONTINUATION: "LENGTH CONTROL",
  NARRATIVE_DENSITY: "LENGTH CONTROL",
  MOMENT_TO_MOMENT: "LENGTH CONTROL",
  TURN_HANDOFF_WRAPPER: "turnHandoffAndPacing.ts (empty after dedup)",
  DIALOGUE_NARRATION: "ADVANCED PROSE bundle",
  OUTPUT_LAYOUT: "webnovelOutputFormat.ts (recency)",
  GENRE_TONE: "narrativeStyle.ts",
  SCENE_MODE_LINE: "narrativeStyle.ts",
  TERMINAL_LENGTH: "responseLength.ts (system tail)",
};

function estTok(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

type Step55Scene = ProductionValidationScene & {
  bucket: "daily" | "romance" | "horror" | "action" | "mixed";
};

const STEP55_SCENES: Step55Scene[] = [
  ...([0, 1, 2, 3, 4, 5] as const).map((i) => ({
    id: `daily-${i}`,
    bucket: "daily" as const,
    label: "현대/일상",
    genres: ["현대/일상"] as CharacterGenre[],
    currentUserMessage: [
      "민수: 오늘도 커피 맛있네. 요즘 바쁘지?",
      "민수: 창가 자리 비었네. 앉아도 될까?",
      "민수: …요즘 날씨 참 좋다. 산책이라도 할까?",
      "민수: 알바 끝나면 같이 밥 먹을래?",
      "민수: 이 케이크, 너희 가게 시그니처 맞지?",
      "민수: 오늘 손님 많았어? 표정이 좀 지쳐 보여.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "아메리카노 하나 주세요." },
      {
        role: "assistant" as const,
        content: `서연은 메뉴판에서 시선을 들어 올렸다.\n\n"네, 잠시만요."`,
      },
    ],
  })),
  ...([0, 1, 2, 3, 4, 5] as const).map((i) => ({
    id: `romance-${i}`,
    bucket: "romance" as const,
    label: "로맨스",
    genres: ["로맨스"] as CharacterGenre[],
    currentUserMessage: [
      "현우: …우산, 같이 쓸래?",
      "현우: 오늘 밤, 잠깐만 같이 걸을래?",
      "현우: …손, 괜찮아?",
      "현우: 너 요즘 왜 그렇게 멀리 있는 것 같아?",
      "현우: 비 그치면… 커피라도 마실래?",
      "현우: …그때 말, 아직도 생각나.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "비가 갑자기 내리네." },
      { role: "assistant" as const, content: `지우는 현관 처마 아래 서서 하늘을 올려다봤다.\n\n"…갑자기 오네."` },
    ],
  })),
  ...([0, 1, 2, 3, 4, 5] as const).map((i) => ({
    id: `horror-${i}`,
    bucket: "horror" as const,
    label: "공포/추리",
    genres: ["공포/추리"] as CharacterGenre[],
    currentUserMessage: [
      "…방금 소리, 들었어? 뭔가 따라오는 것 같아.",
      "…저쪽 골목, 불빛이 방금 꺼졌어.",
      "…발소리야. 우리 뒤인 것 같아.",
      "…문고리, 누가 돌리는 소리 들려?",
      "…창문 밖에 누가 서 있는 것 같아.",
      "…핸드폰 신호가 끊겼어. 여기서 나가자.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "오늘도 밤산책 갈래? 거리가 좀 이상한 것 같아." },
      {
        role: "assistant" as const,
        content: `백하율은 창밖의 어두운 거리를 잠시 바라본 뒤, 조용히 고개를 끄덕였다.\n\n"…이상하다고 느끼셨군요."`,
      },
    ],
  })),
  ...([0, 1, 2, 3, 4, 5] as const).map((i) => ({
    id: `action-${i}`,
    bucket: "action" as const,
    label: "코믹/액션",
    genres: ["코믹/액션"] as CharacterGenre[],
    currentUserMessage: [
      "레온, 적이 검을 들어 올린다. 어떻게 대응할 것인가?",
      "레온, 적이 좌측으로 돌진한다!",
      "레온, 성벽 가장자리까지 밀렸어!",
      "레온, 적 둘이 동시에 달려든다!",
      "레온, 지금이야 — 반격할 타이밍이야!",
      "레온, 적의 검날이 목 앞까지 왔어!",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "성벽 위에서 적을 발견했다." },
      { role: "assistant" as const, content: `레온은 검 손잡이를 조여 쥐었다.\n\n"…왔군."` },
    ],
  })),
  ...([0, 1, 2, 3, 4, 5] as const).map((i) => ({
    id: `mixed-${i}`,
    bucket: "mixed" as const,
    label: "Mixed",
    genres: [
      ["로맨스", "공포/추리"],
      ["현대/일상", "코믹/액션"],
      ["판타지/SF", "공포/추리"],
      ["로맨스", "현대/일상"],
      ["무협/시대극", "코믹/액션"],
      ["BL", "공포/추리"],
    ][i]! as CharacterGenre[],
    currentUserMessage: [
      "…밤길인데, 너 손이 왜 그렇게 차?",
      "민수: …뭐야, 카페에 갑자기 왜 이렇게 조용해?",
      "…저 문양, 전설에서 본 것 같은데.",
      "현우: …오늘은 그만 돌아가. 분위기가 이상해.",
      "레온, 적장이 웃으며 한 걸음 다가온다.",
      "…뒤에서 숨소리가 들렸어. 너도 들었지?",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "오늘 밤, 뭔가 이상한 기분이 들어." },
      {
        role: "assistant" as const,
        content: `백하율은 잠시 주변을 훑어본 뒤, 렌 쪽으로 시선을 돌렸다.\n\n"…무슨 일입니까?"`,
      },
    ],
  })),
];

type SampleRecord = {
  id: string;
  bucket: string;
  genres: CharacterGenre[];
  userMessage: string;
  text: string;
  charCount: number;
  metrics: {
    handFrequency: number;
    touchShare: number;
    startDiversity: number;
    povRepetition: number;
    lengthStdDev: number;
    dialogueRatio: number;
    narrationWall: number;
    hookFrequency: number;
    overallScore: number;
    humanProxy: number;
  };
};

function measureStyleCoreTok(): number {
  const length = buildLengthInstruction(3200, {
    statusWindowEveryTurn: false,
    htmlFlashOwned: true,
    proseStylePolicyOwnsSceneExpansion: true,
    statusWidgetActive: false,
  });
  const genre = buildNarrativeStyleLayer({ genres: ["공포/추리"] });
  return estTok(
    PROSE_STYLE_SECTION +
      length +
      buildTurnHandoffAndPacingBlock() +
      genre +
      buildWebnovelOutputLayoutRecencyBlock()
  );
}

async function buildCompressionReport() {
  const { buildContext } = await import("@/services/contextBuilder");
  const scene = STEP55_SCENES.find((s) => s.id === "horror-0")!;
  const afterFull = buildContext(buildProductionContextForScene(scene)).systemPrompt;
  const afterTok = estTok(afterFull);
  const beforeTok = BEFORE_FULL_SYSTEM_TOK;
  const saved = beforeTok - afterTok;
  const pct = Math.round((saved / beforeTok) * 1000) / 10;

  const remainingDup = [
    "MINIMUM_FLOOR: LENGTH + TERMINAL tail (intentional recency)",
    "SCENE CONTINUATION vs NARRATIVE DENSITY (calm arc — keep)",
    "WEBNOVEL BREATH vs GP step 5 pause (partial)",
    "genre_tone emotion in 로맨스 판타지/현대 판타지 vs EMOTION (not in delete queue)",
  ];

  const payload = {
    generatedAt: new Date().toISOString(),
    beforeTokens: beforeTok,
    afterTokens: afterTok,
    savedTokens: saved,
    savedPercent: pct,
    styleCoreAfterTok: measureStyleCoreTok(),
    ownerMap: OWNER_MAP,
    deletedRules: [...DELETED_RULES],
    remainingDuplicates: remainingDup,
  };

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(OUT_COMP, JSON.stringify(payload, null, 2));
  console.log(`Compression: ${beforeTok} → ${afterTok} tok (−${pct}%)`);
  return payload;
}

async function generateSample(
  scene: Step55Scene,
  callOpenRouterCompletion: typeof import("@/lib/openRouterCompletion").callOpenRouterCompletion
): Promise<SampleRecord> {
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildProductionContextForScene(scene));
  const history = built.history.slice(0, -1);
  const last = built.history[built.history.length - 1];
  const userContent = last?.role === "user" ? last.content : scene.currentUserMessage;
  const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
  const temperature = resolveDeepSeekTemperatureForTarget(3200);

  let text = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await callOpenRouterCompletion({
        system: built.systemPrompt,
        history: [...history, { role: "user", content: userContent }],
        model,
        temperature,
        maxTokens: 4096,
        requestKind: "step55-production-validation",
      });
      text = res.text.trim();
      if (text.length >= 800) break;
    } catch (err) {
      if (attempt === 4) throw err;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (text.length < 300) {
    throw new Error(`${scene.id}: completion too short (${text.length}) after retries`);
  }

  const audit = auditWebnovelStyleText(text, { messageId: 0, chatId: 0 });
  const quality = evaluateStyleQuality(text);
  const raw = audit.raw;

  return {
    id: scene.id,
    bucket: scene.bucket,
    genres: scene.genres,
    userMessage: userContent,
    text,
    charCount: audit.charCount,
    metrics: {
      handFrequency: raw.handFrequency,
      touchShare: Math.round(raw.touchShare * 1000) / 1000,
      startDiversity: Math.round(raw.startTokenUniqueRatio * 1000) / 1000,
      povRepetition: Math.round((raw.povNameStartShare + raw.povPronounStartShare) * 1000) / 1000,
      lengthStdDev: raw.lengthStdDev,
      dialogueRatio: Math.round(raw.dialogueCharShare * 1000) / 1000,
      narrationWall: raw.maxConsecutiveNarrationBlocks,
      hookFrequency: quality.sideMetrics.hookEllipsisCount,
      overallScore: audit.overallScore,
      humanProxy: quality.scores.humanProxyOverall,
    },
  };
}

async function runGeneration() {
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : STEP55_SCENES.length;
  const scenes = STEP55_SCENES.slice(0, limit);

  let existing: { samples?: SampleRecord[] } = {};
  if (existsSync(OUT_JSON)) {
    try {
      existing = JSON.parse(readFileSync(OUT_JSON, "utf8"));
    } catch {
      existing = {};
    }
  }
  const done = new Set((existing.samples ?? []).map((s) => s.id));
  const samples: SampleRecord[] = [...(existing.samples ?? [])];

  for (const scene of scenes) {
    if (done.has(scene.id)) {
      console.log(`skip ${scene.id} (cached)`);
      continue;
    }
    console.log(`generate ${scene.id}…`);
    try {
      const sample = await generateSample(scene, callOpenRouterCompletion);
      samples.push(sample);
      writeFileSync(
        OUT_JSON,
        JSON.stringify({ generatedAt: new Date().toISOString(), samples }, null, 2)
      );
      console.log(`  ${sample.charCount} chars · overall ${sample.metrics.overallScore}`);
    } catch (err) {
      console.error(`  FAILED ${scene.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return samples;
}

function rankSamples(samples: SampleRecord[]) {
  const scored = [...samples].sort(
    (a, b) =>
      b.metrics.humanProxy - a.metrics.humanProxy ||
      b.metrics.overallScore - a.metrics.overallScore
  );
  const best = scored.slice(0, 5);
  const worst = [...samples]
    .sort(
      (a, b) =>
        a.metrics.humanProxy - b.metrics.humanProxy ||
        a.metrics.overallScore - b.metrics.overallScore
    )
    .slice(0, 5);
  return { best, worst, scored };
}

function metricsTable(samples: SampleRecord[]): string {
  const header =
    "| id | bucket | chars | hand | touch | startDiv | povRep | lenVar | dlgRatio | narWall | hook | human |";
  const rows = samples.map((s) => {
    const m = s.metrics;
    return `| ${s.id} | ${s.bucket} | ${s.charCount} | ${m.handFrequency} | ${m.touchShare} | ${m.startDiversity} | ${m.povRepetition} | ${m.lengthStdDev} | ${m.dialogueRatio} | ${m.narrationWall} | ${m.hookFrequency} | ${m.humanProxy} |`;
  });
  return [header, "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|", ...rows].join("\n");
}

function fullTextBlock(samples: SampleRecord[], title: string): string {
  return samples
    .map(
      (s) =>
        `### ${title}: ${s.id} (${s.bucket}, ${s.charCount}자, human=${s.metrics.humanProxy})\n\n**User:** ${s.userMessage}\n\n${s.text}\n`
    )
    .join("\n---\n\n");
}

async function writeReport() {
  const comp = existsSync(OUT_COMP)
    ? JSON.parse(readFileSync(OUT_COMP, "utf8"))
    : await buildCompressionReport();
  if (!existsSync(OUT_JSON)) throw new Error("Missing output/step55-rp-validation.json — run --generate first");
  const parsed = JSON.parse(readFileSync(OUT_JSON, "utf8")) as { samples: SampleRecord[] };
  const samples = parsed.samples ?? [];
  if (samples.length < STEP55_SCENES.length) {
    console.warn(`Warning: ${samples.length}/${STEP55_SCENES.length} samples — report uses available set`);
  }
  const { best, worst } = rankSamples(samples);

  const md = [
    "# Step 5.5 — Production Validation",
    "",
    "## Phase B — Prompt Compression",
    "",
    `| | tokens |`,
    `|---|---:|`,
    `| Before | ${comp.beforeTokens} |`,
    `| After | ${comp.afterTokens} |`,
    `| Saved | ${comp.savedTokens} (${comp.savedPercent}%) |`,
    "",
    "### Deleted rules",
    ...comp.deletedRules.map((r: string) => `- ${r}`),
    "",
    "### Owner map (unchanged)",
    ...Object.entries(comp.ownerMap as Record<string, string>).map(([k, v]) => `- ${k} → ${v}`),
    "",
    "### Remaining duplicates",
    ...(comp.remainingDuplicates as string[]).map((d: string) => `- ${d}`),
    "",
    "## Phase C/D — 30 RP samples metrics",
    "",
    metricsTable(samples),
    "",
    "## Best 5 (full text)",
    "",
    fullTextBlock(best, "BEST"),
    "",
    "## Worst 5 (full text)",
    "",
    fullTextBlock(worst, "WORST"),
  ].join("\n");

  writeFileSync(OUT_MD, md, "utf8");
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        compression: comp,
        samples,
        bestIds: best.map((s) => s.id),
        worstIds: worst.map((s) => s.id),
      },
      null,
      2
    )
  );
  console.log(`Wrote ${OUT_MD}`);
}

async function main() {
  const compressionOnly = process.argv.includes("--compression-only");
  const generate = process.argv.includes("--generate");
  const report = process.argv.includes("--report");

  await buildCompressionReport();

  if (compressionOnly) return;

  if (generate) {
    await runGeneration();
  }
  if (report || (process.argv.length === 2 && !compressionOnly)) {
    await writeReport();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
