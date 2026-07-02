/**
 * Step 7 — Negative-prompt cleanup validation
 * Usage:
 *   npm.cmd exec tsx -- scripts/step7-production-validation.ts --compression-only
 *   npm.cmd exec tsx -- scripts/step7-production-validation.ts --generate
 *   npm.cmd exec tsx -- scripts/step7-production-validation.ts --report
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import type { CharacterGenre } from "@/lib/characterGenres";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { buildLengthInstruction } from "@/lib/responseLength";
import { buildNarrativeStyleLayer } from "@/lib/narrativeStyle";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";
import {
  buildProductionContextForScene,
  type ProductionValidationScene,
} from "./lib/production-prompt-fixture";
import { auditWebnovelStyleText } from "./lib/webnovel-style-audit";
import { evaluateStyleQuality, STYLE_QUALITY_CRITERIA } from "./lib/style-quality-evaluation";
import { estimateTokens } from "@/lib/tokenEstimate";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_JSON = join(process.cwd(), "output", "step7-rp-validation.json");
const OUT_MD = join(process.cwd(), "output", "step7-production-validation.md");
const OUT_COMP = join(process.cwd(), "output", "step7-compression.json");
const BEFORE_JSON = join(process.cwd(), "output", "step55-rp-validation.json");

/** Post–Step 5.5 measured (horror OpenRouter fixture) */
const BEFORE_STEP55_TOK = 7145;

const DELETED_RULES_STEP7 = [
  "TURN-HANDOFF-EMPTY",
  "AUTO-CONT-HANDOFF-HINT",
  "NO-INPUT-ECHO-EN",
  "SCENE-CONT-EN",
  "NO-ABSTRACT-SUMMARIES",
  "WEBNOVEL-FORMAT-SCREENPLAY",
  "OUT-LAYOUT-DISCLAIMER",
  "OR-NO-STYLE-IMITATION",
  "OR-TOP-CATCHALL",
  "OR-NO-META-WRITING",
  "GP-ENGLISH-HEADER",
  "ABS-PROHIB-COMMA-CHAIN",
  "EMOTION-LABEL-EXAMPLES",
  "MOVEMENT-SLOMO-ONLY",
  "LENGTH-EXPAND-BULLET",
  "SENSATION-CHANNEL-ROTATE",
  "EMOTION-ANTI-REPEAT-BODY",
  "CROSS-TURN-VARIATION",
  "SPEECH-METADATA-COMPRESS",
  "NO-STAGE-COMPRESS",
  "OUT-LAYOUT-PARAGRAPH-COMPRESS",
] as const;

function estTok(text: string): number {
  return Math.max(1, Math.ceil(text.length * 0.9));
}

type Step7Bucket = "daily" | "romance" | "fantasy" | "action" | "horror" | "mystery";

type Step7Scene = ProductionValidationScene & {
  bucket: Step7Bucket;
};

const STEP7_SCENES: Step7Scene[] = [
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `daily-${i}`,
    bucket: "daily" as const,
    label: "Daily",
    genres: ["현대/일상"] as CharacterGenre[],
    currentUserMessage: [
      "민수: 오늘도 커피 맛있네. 요즘 바쁘지?",
      "민수: 창가 자리 비었네. 앉아도 될까?",
      "민수: …요즘 날씨 참 좋다. 산책이라도 할까?",
      "민수: 알바 끝나면 같이 밥 먹을래?",
      "민수: 이 케이크, 너희 가게 시그니처 맞지?",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "아메리카노 하나 주세요." },
      { role: "assistant" as const, content: `서연은 메뉴판에서 시선을 들어 올렸다.\n\n"네, 잠시만요."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `romance-${i}`,
    bucket: "romance" as const,
    label: "Romance",
    genres: ["로맨스"] as CharacterGenre[],
    currentUserMessage: [
      "현우: …우산, 같이 쓸래?",
      "현우: 오늘 밤, 잠깐만 같이 걸을래?",
      "현우: …손, 괜찮아?",
      "현우: 너 요즘 왜 그렇게 멀리 있는 것 같아?",
      "현우: 비 그치면… 커피라도 마실래?",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "비가 갑자기 내리네." },
      { role: "assistant" as const, content: `지우는 현관 처마 아래 서서 하늘을 올려다봤다.\n\n"…갑자기 오네."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `fantasy-${i}`,
    bucket: "fantasy" as const,
    label: "Fantasy",
    genres: ["판타지/SF"] as CharacterGenre[],
    currentUserMessage: [
      "…저 문양, 전설에서 본 것 같은데.",
      "…마법진이 갑자기 빛나기 시작했어.",
      "…저 수정, 손대도 될까?",
      "…성벽 너머에서 뭔가 움직였어.",
      "…계약의 문구, 다시 읽어봐야 할 것 같아.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "고대 유적 입구에 도착했다." },
      { role: "assistant" as const, content: `백하율은 낡은 석문 위의 문양을 가리켰다.\n\n"…이건 기록과 다릅니다."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `action-${i}`,
    bucket: "action" as const,
    label: "Action",
    genres: ["코믹/액션"] as CharacterGenre[],
    currentUserMessage: [
      "레온, 적이 검을 들어 올린다. 어떻게 대응할 것인가?",
      "레온, 적이 좌측으로 돌진한다!",
      "레온, 성벽 가장자리까지 밀렸어!",
      "레온, 적 둘이 동시에 달려든다!",
      "레온, 지금이야 — 반격할 타이밍이야!",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "성벽 위에서 적을 발견했다." },
      { role: "assistant" as const, content: `레온은 검 손잡이를 조여 쥐었다.\n\n"…왔군."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `horror-${i}`,
    bucket: "horror" as const,
    label: "Horror",
    genres: ["공포/추리"] as CharacterGenre[],
    currentUserMessage: [
      "…방금 소리, 들었어? 뭔가 따라오는 것 같아.",
      "…저쪽 골목, 불빛이 방금 꺼졌어.",
      "…발소리야. 우리 뒤인 것 같아.",
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
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `mystery-${i}`,
    bucket: "mystery" as const,
    label: "Mystery",
    genres: ["공포/추리"] as CharacterGenre[],
    currentUserMessage: [
      "…현장에 남은 발자국, 두 사람 분량이야.",
      "…피해자가 마지막으로 본 사람, 누구라고 했지?",
      "…이 편지, 필적이 익숙한데.",
      "…CCTV 타임스탬프가 3분 비어 있어.",
      "…알리바이, 다시 확인해야 할 것 같아.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "사건 현장에 도착했다." },
      { role: "assistant" as const, content: `백하율은 테이프로 둘러싸인 구역 가장자리에서 발자국을 내려다봤다.\n\n"…흔적이 두 갈래입니다."` },
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
    aiSmell: number;
    webnovelLikeness: number;
    sentenceRhythm: number;
    immersion: number;
    repetition: number;
    handTouch: number;
    narrationWall: number;
    dialogueRhythm: number;
    humanProxy: number;
    overallScore: number;
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
  return estTok(PROSE_STYLE_SECTION + length + genre + buildWebnovelOutputLayoutRecencyBlock());
}

async function buildCompressionReport() {
  const { buildContext } = await import("@/services/contextBuilder");
  const scene = STEP7_SCENES.find((s) => s.id === "horror-0")!;
  const built = buildContext(buildProductionContextForScene(scene));
  const afterTok = estimateTokens(built.systemPrompt);
  const beforeTok = BEFORE_STEP55_TOK;
  const saved = beforeTok - afterTok;
  const pct = Math.round((saved / beforeTok) * 1000) / 10;

  const payload = {
    generatedAt: new Date().toISOString(),
    beforeTokens: beforeTok,
    beforeLabel: "Step 5.5 post-cleanup",
    afterTokens: afterTok,
    afterLabel: "Step 7 negative-prompt cleanup",
    savedTokens: saved,
    savedPercent: pct,
    cumulativeFrom7806: 7806 - afterTok,
    styleCoreAfterTok: measureStyleCoreTok(),
    deletedRules: [...DELETED_RULES_STEP7],
  };

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(OUT_COMP, JSON.stringify(payload, null, 2));
  console.log(`Compression: ${beforeTok} → ${afterTok} tok (−${pct}%)`);
  return payload;
}

function sampleMetrics(text: string): SampleRecord["metrics"] {
  const audit = auditWebnovelStyleText(text, { messageId: 0, chatId: 0 });
  const quality = evaluateStyleQuality(text);
  const raw = audit.raw;
  const aiSmell =
    Math.round(
      Math.max(
        0,
        10 -
          (raw.connectorSpamScore / 4 +
            raw.emotionLabelCount * 0.8 +
            Math.max(0, raw.maxConsecutiveSameStart - 2) * 0.4)
      ) * 10
    ) / 10;

  return {
    aiSmell,
    webnovelLikeness: quality.scores.webnovelLikeness,
    sentenceRhythm: quality.scores.sentenceRhythm,
    immersion: quality.scores.immersion,
    repetition: quality.scores.repetition,
    handTouch: quality.scores.handTouch,
    narrationWall: raw.maxConsecutiveNarrationBlocks,
    dialogueRhythm: Math.round(raw.dialogueCharShare * 1000) / 1000,
    humanProxy: quality.scores.humanProxyOverall,
    overallScore: audit.overallScore,
  };
}

async function generateSample(
  scene: Step7Scene,
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
        requestKind: "step7-production-validation",
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

  return {
    id: scene.id,
    bucket: scene.bucket,
    genres: scene.genres,
    userMessage: userContent,
    text,
    charCount: text.length,
    metrics: sampleMetrics(text),
  };
}

async function runGeneration() {
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : STEP7_SCENES.length;
  const scenes = STEP7_SCENES.slice(0, limit);

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
      console.log(`  ${sample.charCount} chars · human=${sample.metrics.humanProxy}`);
    } catch (err) {
      console.error(`  FAILED ${scene.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return samples;
}

function avgMetric(samples: SampleRecord[], key: keyof SampleRecord["metrics"]): number {
  if (samples.length === 0) return 0;
  const sum = samples.reduce((a, s) => a + s.metrics[key], 0);
  return Math.round((sum / samples.length) * 100) / 100;
}

function loadBeforeSamples(): SampleRecord[] {
  if (!existsSync(BEFORE_JSON)) return [];
  try {
    const parsed = JSON.parse(readFileSync(BEFORE_JSON, "utf8")) as {
      samples?: Array<{
        id: string;
        bucket: string;
        genres: CharacterGenre[];
        userMessage: string;
        text: string;
        charCount: number;
        metrics: Record<string, number>;
      }>;
    };
    return (parsed.samples ?? []).map((s) => ({
      ...s,
      metrics: {
        aiSmell: sampleMetrics(s.text).aiSmell,
        webnovelLikeness: s.metrics.humanProxy ? sampleMetrics(s.text).webnovelLikeness : 0,
        sentenceRhythm: sampleMetrics(s.text).sentenceRhythm,
        immersion: sampleMetrics(s.text).immersion,
        repetition: sampleMetrics(s.text).repetition,
        handTouch: s.metrics.touchShare ?? sampleMetrics(s.text).handTouch,
        narrationWall: s.metrics.narrationWall ?? sampleMetrics(s.text).narrationWall,
        dialogueRhythm: s.metrics.dialogueRatio ?? sampleMetrics(s.text).dialogueRhythm,
        humanProxy: s.metrics.humanProxy ?? sampleMetrics(s.text).humanProxy,
        overallScore: s.metrics.overallScore ?? sampleMetrics(s.text).overallScore,
      },
    }));
  } catch {
    return [];
  }
}

function compareTable(
  label: string,
  before: SampleRecord[],
  after: SampleRecord[]
): string {
  const keys: (keyof SampleRecord["metrics"])[] = [
    "aiSmell",
    "webnovelLikeness",
    "sentenceRhythm",
    "immersion",
    "repetition",
    "handTouch",
    "narrationWall",
    "dialogueRhythm",
    "humanProxy",
  ];
  const rows = keys.map((k) => {
    const b = avgMetric(before, k);
    const a = avgMetric(after, k);
    const delta = Math.round((a - b) * 100) / 100;
    const lowerBetter = k === "narrationWall";
    const ok = lowerBetter ? delta <= 0.3 : delta >= -0.3;
    return `| ${k} | ${b} | ${a} | ${delta >= 0 ? "+" : ""}${delta} | ${ok ? "OK" : "WATCH"} |`;
  });
  return [
    `### ${label}`,
    "",
    "| metric | before avg | after avg | delta | gate |",
    "|---|---:|---:|---:|---|",
    ...rows,
  ].join("\n");
}

function metricsTable(samples: SampleRecord[]): string {
  const header =
    "| id | bucket | chars | aiSmell | webnovel | rhythm | immersion | repeat | hand | narWall | dlgRhythm | human |";
  const rows = samples.map((s) => {
    const m = s.metrics;
    return `| ${s.id} | ${s.bucket} | ${s.charCount} | ${m.aiSmell} | ${m.webnovelLikeness} | ${m.sentenceRhythm} | ${m.immersion} | ${m.repetition} | ${m.handTouch} | ${m.narrationWall} | ${m.dialogueRhythm} | ${m.humanProxy} |`;
  });
  return [header, "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|", ...rows].join("\n");
}

function verdict(before: SampleRecord[], after: SampleRecord[]): string {
  const humanDelta = avgMetric(after, "humanProxy") - avgMetric(before, "humanProxy");
  const aiDelta = avgMetric(after, "aiSmell") - avgMetric(before, "aiSmell");
  const wallDelta = avgMetric(after, "narrationWall") - avgMetric(before, "narrationWall");
  if (humanDelta >= -0.25 && aiDelta >= -0.4 && wallDelta <= 0.5) {
    return "**Production Ready (A)** — no material regression vs Step 5.5 baseline.";
  }
  if (humanDelta >= -0.5 && aiDelta >= -0.8) {
    return "**Conditional (B)** — minor variance; review WATCH metrics before rollback.";
  }
  return "**Rollback review (C)** — primary metrics dropped; consider reverting Step 7 patch.";
}

async function writeReport() {
  const comp = existsSync(OUT_COMP)
    ? JSON.parse(readFileSync(OUT_COMP, "utf8"))
    : await buildCompressionReport();
  if (!existsSync(OUT_JSON)) throw new Error("Missing output/step7-rp-validation.json — run --generate first");
  const parsed = JSON.parse(readFileSync(OUT_JSON, "utf8")) as { samples: SampleRecord[] };
  const afterSamples = parsed.samples ?? [];
  const beforeSamples = loadBeforeSamples();

  const afterByBucket = (b: Step7Bucket) => afterSamples.filter((s) => s.bucket === b);
  const beforeByBucket = (b: string) => beforeSamples.filter((s) => s.bucket === b);

  const md = [
    "# Step 7 — Negative Prompt Cleanup Validation",
    "",
    "## Prompt compression",
    "",
    `| | tokens |`,
    `|---|---:|`,
    `| Step 5.5 (before) | ${comp.beforeTokens} |`,
    `| Step 7 (after) | ${comp.afterTokens} |`,
    `| Saved this step | ${comp.savedTokens} (${comp.savedPercent}%) |`,
    `| Cumulative from 7806 | ${comp.cumulativeFrom7806} |`,
    "",
    "### Deleted / compressed (Step 7)",
    ...comp.deletedRules.map((r: string) => `- ${r}`),
    "",
    "## Before vs After — aggregate",
    "",
    compareTable("All samples (Step 5.5 baseline vs Step 7)", beforeSamples, afterSamples),
    "",
    compareTable("Horror bucket", beforeByBucket("horror"), afterByBucket("horror")),
    compareTable("Romance bucket", beforeByBucket("romance"), afterByBucket("romance")),
    "",
    "## Verdict",
    "",
    verdict(beforeSamples, afterSamples),
    "",
    "## Step 7 — 30 RP samples",
    "",
    metricsTable(afterSamples),
    "",
    "### Evaluation dimensions",
    ...STYLE_QUALITY_CRITERIA.map((c) => `- ${c.labelKo}`),
  ].join("\n");

  writeFileSync(OUT_MD, md, "utf8");
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        compression: comp,
        beforeSampleCount: beforeSamples.length,
        samples: afterSamples,
        aggregateBefore: beforeSamples.length
          ? Object.fromEntries(
              [
                "aiSmell",
                "webnovelLikeness",
                "humanProxy",
                "narrationWall",
              ].map((k) => [k, avgMetric(beforeSamples, k as keyof SampleRecord["metrics"])])
            )
          : null,
        aggregateAfter: Object.fromEntries(
          ["aiSmell", "webnovelLikeness", "humanProxy", "narrationWall"].map((k) => [
            k,
            avgMetric(afterSamples, k as keyof SampleRecord["metrics"]),
          ])
        ),
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
