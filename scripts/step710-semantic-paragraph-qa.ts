/**
 * Step 7.10 — Semantic paragraphing QA (12 outputs max).
 *
 * Usage:
 *   npx.cmd tsx --conditions=react-server scripts/step710-semantic-paragraph-qa.ts --prompt-only
 *   npx.cmd tsx --conditions=react-server scripts/step710-semantic-paragraph-qa.ts --generate
 *   npx.cmd tsx --conditions=react-server scripts/step710-semantic-paragraph-qa.ts --offline-db
 */
import "./lib/server-only-mock";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "./load-env-local";
import type { CharacterGenre } from "@/lib/characterGenres";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import {
  buildProductionContextForScene,
  type ProductionValidationScene,
} from "./lib/production-prompt-fixture";
import {
  buildWebnovelOutputLayoutRecencyBlock,
  containsParagraphLayoutInstructions,
} from "@/lib/webnovelOutputFormat";
import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { NARRATIVE_DENSITY_BLOCK } from "@/lib/sceneExpansionPolicy";
import {
  classifyNovelParagraph,
  groupNovelParagraphs,
  MAX_NARRATION_CHARS_PER_PARAGRAPH,
} from "@/lib/novelParagraphs";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type Bucket = "emotion" | "daily" | "combat" | "multi";

type Scene = ProductionValidationScene & { bucket: Bucket };

type QaWarn =
  | "giant_narration_para"
  | "subject_churn_heuristic"
  | "inner_outer_space_combo"
  | "single_para_many_beats"
  | "four_plus_one_sentence_streak";

type SampleResult = {
  id: string;
  bucket: Bucket;
  userMessage: string;
  outputChars: number;
  rawBlankLines: number;
  displayParas: number;
  narrationParas: number;
  dialogueParas: number;
  maxNarrationChars: number;
  oneSentenceStreakMax: number;
  warnings: QaWarn[];
  finishReason: string | null;
  preview: string;
};

const SCENES: Scene[] = [
  {
    id: "emotion-0",
    bucket: "emotion",
    label: "감정 대화",
    genres: ["로맨스"] as CharacterGenre[],
    currentUserMessage: "…나, 너한테 솔직해지고 싶었어. 잠깐만 들어줄래?",
    shortTermHistory: [
      { role: "user", content: "오늘 밤, 잠깐만 같이 걸을래?" },
      {
        role: "assistant",
        content: `백하율은 발걸음을 늦추며 렌 쪽을 바라봤다.\n\n"…말씀하세요."`,
      },
    ],
  },
  {
    id: "emotion-1",
    bucket: "emotion",
    label: "감정 대화",
    genres: ["로맨스"] as CharacterGenre[],
    currentUserMessage: "네가 멀어지는 것 같아서… 그게 제일 무서웠어.",
    shortTermHistory: [
      { role: "user", content: "손, 괜찮아?" },
      {
        role: "assistant",
        content: `그는 렌의 손을 내려다보다가, 천천히 손가락을 풀었다.\n\n"괜찮습니다."`,
      },
    ],
  },
  {
    id: "emotion-2",
    bucket: "emotion",
    label: "감정 대화",
    genres: ["로맨스"] as CharacterGenre[],
    currentUserMessage: "울지 마. …아니, 울어도 돼. 내가 옆에 있을게.",
    shortTermHistory: [
      { role: "user", content: "비 그치면 커피라도 마실래?" },
      {
        role: "assistant",
        content: `빗소리가 처마 아래로 스며들었다.\n\n백하율의 시선이 잠시 흔들렸다.`,
      },
    ],
  },
  {
    id: "daily-0",
    bucket: "daily",
    label: "일상 대화",
    genres: ["현대/일상"] as CharacterGenre[],
    currentUserMessage: "오늘도 커피 맛있네. 요즘 바쁘지?",
    shortTermHistory: [
      { role: "user", content: "아메리카노 하나 주세요." },
      {
        role: "assistant",
        content: `서연은 메뉴판에서 시선을 들어 올렸다.\n\n"네, 잠시만요."`,
      },
    ],
  },
  {
    id: "daily-1",
    bucket: "daily",
    label: "일상 대화",
    genres: ["현대/일상"] as CharacterGenre[],
    currentUserMessage: "창가 자리 비었네. 앉아도 될까?",
    shortTermHistory: [
      { role: "user", content: "이 케이크, 너희 가게 시그니처 맞지?" },
      {
        role: "assistant",
        content: `그녀는 접시를 내려놓으며 작게 웃었다.\n\n"맞아요. 오늘 막 구운 거예요."`,
      },
    ],
  },
  {
    id: "daily-2",
    bucket: "daily",
    label: "일상 대화",
    genres: ["현대/일상"] as CharacterGenre[],
    currentUserMessage: "알바 끝나면 같이 밥 먹을래?",
    shortTermHistory: [
      { role: "user", content: "…요즘 날씨 참 좋다." },
      {
        role: "assistant",
        content: `창밖으로 햇빛이 길게 들어왔다.\n\n"그러게요. 산책하기 좋은 날이에요."`,
      },
    ],
  },
  {
    id: "combat-0",
    bucket: "combat",
    label: "전투",
    genres: ["판타지"] as CharacterGenre[],
    currentUserMessage: "*검을 뽑아 앞으로 나서며* 왼쪽을 막아!",
    shortTermHistory: [
      { role: "user", content: "적이 몰려온다!" },
      {
        role: "assistant",
        content: `백하율은 단검을 고쳐 쥐며 전열을 살폈다.\n\n"간격 유지하세요."`,
      },
    ],
  },
  {
    id: "combat-1",
    bucket: "combat",
    label: "전투",
    genres: ["판타지"] as CharacterGenre[],
    currentUserMessage: "*방패로 일격을 받아내며* 지금이야, 뒤를 쳐!",
    shortTermHistory: [
      { role: "user", content: "숨이 가빠. 버틸 수 있어?" },
      {
        role: "assistant",
        content: `모래가 발밑에서 튀었다.\n\n"버팁니다. 신호에 맞추세요."`,
      },
    ],
  },
  {
    id: "combat-2",
    bucket: "combat",
    label: "전투",
    genres: ["판타지"] as CharacterGenre[],
    currentUserMessage: "*부상당한 동료를 끌어안으며* 후퇴한다. 엄호해줘!",
    shortTermHistory: [
      { role: "user", content: "화살이 빗발친다!" },
      {
        role: "assistant",
        content: `그는 몸을 낮추며 렌의 어깨를 밀었다.\n\n"엎드리세요!"`,
      },
    ],
  },
  {
    id: "multi-0",
    bucket: "multi",
    label: "다인 장면",
    genres: ["현대/일상"] as CharacterGenre[],
    currentUserMessage: "민수랑 지수가 동시에 말을 걸었어. 나 어떡해?",
    shortTermHistory: [
      { role: "user", content: "카페에 사람이 많네." },
      {
        role: "assistant",
        content: `백하율은 창가 쪽 테이블을 가리켰다.\n\n"저쪽이 덜 시끄럽습니다."`,
      },
    ],
  },
  {
    id: "multi-1",
    bucket: "multi",
    label: "다인 장면",
    genres: ["판타지"] as CharacterGenre[],
    currentUserMessage: "기사단장이랑 마법사가 서로 다른 작전을 말해. 네 생각은?",
    shortTermHistory: [
      { role: "user", content: "회의가 길어지고 있어." },
      {
        role: "assistant",
        content: `횃불 아래 지도가 펼쳐져 있었다.\n\n"둘 다 맞습니다. 다만 순서가 문제입니다."`,
      },
    ],
  },
  {
    id: "multi-2",
    bucket: "multi",
    label: "다인 장면",
    genres: ["로맨스"] as CharacterGenre[],
    currentUserMessage: "친구들이 우리 사이를 눈치챈 것 같아. 어떻게 나갈까?",
    shortTermHistory: [
      { role: "user", content: "뒤에서 수군거리는 소리가 들려." },
      {
        role: "assistant",
        content: `백하율의 시선이 잠시 복도 끝으로 갔다.\n\n"자연스럽게 나갑시다."`,
      },
    ],
  },
];

function sentenceCount(p: string): number {
  const parts = p
    .replace(/["\u201C\u201D]/g, "")
    .split(/(?<=[.!?…。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Math.max(1, parts.length);
}

function qaWarnings(text: string): {
  warnings: QaWarn[];
  displayParas: number;
  narrationParas: number;
  dialogueParas: number;
  maxNarrationChars: number;
  oneSentenceStreakMax: number;
  rawBlankLines: number;
} {
  const rawBlankLines = (text.match(/\n\n/g) ?? []).length;
  const paras = groupNovelParagraphs(text);
  let narrationParas = 0;
  let dialogueParas = 0;
  let maxNarrationChars = 0;
  let oneSentenceStreak = 0;
  let oneSentenceStreakMax = 0;
  const warnings: QaWarn[] = [];

  for (const p of paras) {
    const kind = classifyNovelParagraph(p);
    if (kind === "dialogue") {
      dialogueParas += 1;
      oneSentenceStreak = 0;
      continue;
    }
    narrationParas += 1;
    maxNarrationChars = Math.max(maxNarrationChars, p.length);
    const sc = sentenceCount(p);
    if (sc === 1 && p.length < 80) {
      oneSentenceStreak += 1;
      oneSentenceStreakMax = Math.max(oneSentenceStreakMax, oneSentenceStreak);
    } else {
      oneSentenceStreak = 0;
    }
    // QA-only char threshold (not a generation rule)
    if (p.length >= MAX_NARRATION_CHARS_PER_PARAGRAPH) {
      warnings.push("giant_narration_para");
    }
    // Heuristic: many distinct name-like tokens + 전환 markers in one para
    const focusShifts =
      (p.match(/(?:그러나|하지만|한편|그때|그 순간|동시에)/g) ?? []).length +
      (p.match(/(?:그는|그녀는|그들은|렌은|백하율은)/g) ?? []).length;
    if (focusShifts >= 5 && p.length >= 400) {
      warnings.push("subject_churn_heuristic");
    }
    if (
      /(생각|마음|심장이)/.test(p) &&
      /(주변|동료|사람들|병사)/.test(p) &&
      /(이동|걸었|돌아|복도|광장)/.test(p) &&
      p.length >= 300
    ) {
      warnings.push("inner_outer_space_combo");
    }
  }

  if (paras.length === 1 && text.length >= 1200) {
    warnings.push("single_para_many_beats");
  }
  if (oneSentenceStreakMax >= 4) {
    warnings.push("four_plus_one_sentence_streak");
  }

  return {
    warnings: [...new Set(warnings)],
    displayParas: paras.length,
    narrationParas,
    dialogueParas,
    maxNarrationChars,
    oneSentenceStreakMax,
    rawBlankLines,
  };
}

function promptAudit(): Record<string, unknown> {
  const layout = buildWebnovelOutputLayoutRecencyBlock();
  return {
    layoutHasSemantic: /\[SEMANTIC PARAGRAPHING\]/.test(layout),
    layoutHasContinuousBan: /Continuous narration stays in one paragraph/.test(layout),
    layoutChars: layout.length,
    layoutHash: createHash("sha256").update(layout).digest("hex").slice(0, 12),
    densityDisambiguatesParagraph: /OUTPUT LAYOUT/.test(NARRATIVE_DENSITY_BLOCK),
    rhythmPointsToLayout: /OUTPUT LAYOUT/.test(PROSE_STYLE_SECTION),
    breathAllowsNewPara: /새 문단/.test(PROSE_STYLE_SECTION),
    proseBundleHasFullLayoutBlock: containsParagraphLayoutInstructions(PROSE_STYLE_SECTION),
  };
}

async function generateOne(scene: Scene): Promise<SampleResult> {
  const { buildContext } = await import("@/services/contextBuilder");
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { resolveDeepSeekTemperatureForTarget } = await import("@/lib/openRouterClient");

  const built = buildContext(buildProductionContextForScene(scene));
  const history = built.history.slice(0, -1);
  const last = built.history[built.history.length - 1];
  const userContent = last?.role === "user" ? last.content : scene.currentUserMessage;
  const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
  const temperature = resolveDeepSeekTemperatureForTarget(3200);

  let raw = "";
  let finishReason: string | null = null;
  const res = await callOpenRouterCompletion({
    system: built.systemPrompt,
    history: [...history, { role: "user", content: userContent }],
    model,
    temperature,
    maxTokens: 4096,
    requestKind: "step710-semantic-paragraph-qa",
  });
  raw = (res.text ?? "").trim();
  finishReason = (res as { finishReason?: string }).finishReason ?? null;

  // Confirm assembled prompt carries semantic paragraphing
  if (!built.systemPrompt.includes("[SEMANTIC PARAGRAPHING]")) {
    throw new Error(`${scene.id}: assembled system missing [SEMANTIC PARAGRAPHING]`);
  }

  const metrics = qaWarnings(raw);
  return {
    id: scene.id,
    bucket: scene.bucket,
    userMessage: scene.currentUserMessage,
    outputChars: raw.length,
    finishReason,
    preview: raw.slice(0, 180).replace(/\n/g, "\\n"),
    ...metrics,
  };
}

async function offlineDbSample(): Promise<SampleResult[]> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database("data/app.db", { readonly: true });
  const rows = db
    .prepare(
      `SELECT id, content FROM messages
       WHERE role='assistant' AND length(content) > 1500
       ORDER BY id DESC LIMIT 12`
    )
    .all() as { id: number; content: string }[];

  return rows.map((r, i) => {
    const metrics = qaWarnings(r.content);
    const bucket = (["emotion", "daily", "combat", "multi"] as Bucket[])[i % 4]!;
    return {
      id: `db-${r.id}`,
      bucket,
      userMessage: "(stored)",
      outputChars: r.content.length,
      finishReason: "stored",
      preview: r.content.slice(0, 180).replace(/\n/g, "\\n"),
      ...metrics,
    };
  });
}

function printTable(rows: SampleResult[]) {
  console.log(
    "| id | chars | raw\\n\\n | display paras | max narr | 1-sent streak | warnings |"
  );
  console.log("|---|---:|---:|---:|---:|---:|---|");
  for (const r of rows) {
    console.log(
      `| ${r.id} | ${r.outputChars} | ${r.rawBlankLines} | ${r.displayParas} | ${r.maxNarrationChars} | ${r.oneSentenceStreakMax} | ${r.warnings.join(",") || "—"} |`
    );
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });

  const audit = promptAudit();
  console.log("[prompt-audit]", JSON.stringify(audit, null, 2));

  if (args.has("--prompt-only")) {
    writeFileSync(
      join(outDir, "step710-prompt-audit.json"),
      JSON.stringify({ audit, layout: buildWebnovelOutputLayoutRecencyBlock() }, null, 2),
      "utf8"
    );
    return;
  }

  let rows: SampleResult[] = [];
  if (args.has("--offline-db")) {
    rows = await offlineDbSample();
  } else if (args.has("--generate")) {
    if (!process.env.OPENROUTER_API_KEY) {
      console.error("OPENROUTER_API_KEY missing — use --offline-db or set key");
      process.exit(1);
    }
    for (const scene of SCENES) {
      console.log(`\n=== generating ${scene.id} ===`);
      const row = await generateOne(scene);
      rows.push(row);
      console.log(
        `${scene.id}: chars=${row.outputChars} paras=${row.displayParas} warn=${row.warnings.join(",") || "none"}`
      );
    }
  } else {
    console.log("Pass --prompt-only | --offline-db | --generate");
    process.exit(0);
  }

  printTable(rows);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(outDir, `step710-semantic-paragraph-qa-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ audit, rows }, null, 2), "utf8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
