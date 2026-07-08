/**
 * Old vs new PROSE STYLE — 4 scenes × 1 turn, repetition metrics only.
 * Usage: npx tsx scripts/compare-prose-style-variation.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const OLD_PROSE_STYLE = `[PROSE STYLE]
서술: 해체(-다/-했다/-이었다)만; 번역투·과도한 쉼표 나열·명사 단편 행 금지; 말줄임 ... 허용(...... 금지, 턴당 ~3).
일상·대화: 미세 행동·소품·환경을 구체적으로 — 분위기·긴장감은 행동·감각으로.
긴장·고조: 반응·호흡·시선·거리·침묵을 촘촘히 — 감정 라벨 대신 신체·환경 반응.`;

const SCENES = [
  {
    id: "daily",
    label: "일상 대화",
    setup: `[A]=카페 알바생 '서연'. [B]=단골 손님 '민수'. 조용한 오후, 테이블 3번.`,
    user: "민수: 오늘도 커피 맛있네. 요즘 바쁘지?",
  },
  {
    id: "romance",
    label: "로맨스",
    setup: `[A]=첫사랑 '지우'. [B]='현우'. 비 오는 저녁, 좁은 현관 앞.`,
    user: "현우: …우산, 같이 쓸래?",
  },
  {
    id: "combat",
    label: "전투",
    setup: `[A]=기사 '레온'. 적=어둠의 기사 1명. 폐허가 된 성벽 위.`,
    user: "레온, 적이 검을 들어 올린다. 어떻게 대응할 것인가?",
  },
  {
    id: "horror",
    label: "긴장/공포",
    setup: `[A]=탐정 '수아'. [B]=조수 '한결'. 불 꺼진 복도, 3층 끝 방 앞.`,
    user: "한결: …방 안에서 소리 났어. 들었어?",
  },
] as const;

const SENSORY_LEX: Record<string, string[]> = {
  sight: ["시선", "눈", "눈동자", "시야", "어둠", "불빛", "그림자"],
  sound: ["소리", "귓", "울림", "속삭", "메아리", "침묵"],
  touch: ["손", "손끝", "피부", "온기", "냉기", "촉"],
  breath: ["호흡", "숨", "숨결"],
  smell: ["냄새", "향"],
  space: ["거리", "공간", "간격", "위치"],
};

const GESTURE_LEX = [
  "시선",
  "눈을",
  "눈이",
  "고개",
  "손",
  "손끝",
  "어깨",
  "입술",
  "호흡",
  "숨",
  "몸",
  "몸을",
  "손가락",
  "미소",
  "눈썹",
];

function stripArtifacts(text: string): string {
  return text
    .replace(/<<<[\s\S]*$/m, "")
    .replace(/\[태그:[^\]]+\]/g, "")
    .trim();
}

function splitSentences(text: string): string[] {
  const prose = stripArtifacts(text);
  const parts: string[] = [];
  for (const block of prose.split(/\n+/)) {
    const line = block.trim();
    if (!line) continue;
    if (/^["「『].*["」』]$/.test(line)) continue;
    const withoutQuotes = line.replace(/"[^"]*"/g, " ").replace(/「[^」]*」/g, " ");
    for (const seg of withoutQuotes.split(/(?<=[.?!…])\s+/)) {
      const s = seg.trim();
      if (s.length >= 4 && /[다요죠][.?!…]?$/.test(s)) parts.push(s);
    }
  }
  return parts;
}

function firstToken(s: string): string {
  const t = s.replace(/^[^\p{L}\p{N}]+/u, "");
  const m = t.match(/^[\p{L}]+/u);
  return m?.[0] ?? t.slice(0, 2);
}

function maxConsecutiveEqual<T>(arr: T[]): number {
  if (arr.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === arr[i - 1]) {
      run++;
      best = Math.max(best, run);
    } else run = 1;
  }
  return best;
}

function countSimilarLengthRuns(lengths: number[], tolerance = 0.25): number {
  let runs = 0;
  let run = 1;
  for (let i = 1; i < lengths.length; i++) {
    const a = lengths[i - 1];
    const b = lengths[i];
    const similar = a > 0 && Math.abs(a - b) / a <= tolerance;
    if (similar) {
      run++;
      if (run >= 3) runs++;
    } else run = 1;
  }
  return runs;
}

function analyze(text: string) {
  const sentences = splitSentences(text);
  const starts = sentences.map(firstToken);
  const lengths = sentences.map((s) => s.length);

  const startCounts = new Map<string, number>();
  for (const s of starts) startCounts.set(s, (startCounts.get(s) ?? 0) + 1);
  const topStarts = [...startCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const sensory: Record<string, number> = {};
  for (const [ch, words] of Object.entries(SENSORY_LEX)) {
    sensory[ch] = words.reduce((n, w) => n + (text.match(new RegExp(w, "g"))?.length ?? 0), 0);
  }
  const sensoryTotal = Object.values(sensory).reduce((a, b) => a + b, 0);
  const dominantSensory = Object.entries(sensory).sort((a, b) => b[1] - a[1])[0];

  const gestureCounts = new Map<string, number>();
  for (const g of GESTURE_LEX) {
    const c = text.match(new RegExp(g, "g"))?.length ?? 0;
    if (c > 0) gestureCounts.set(g, c);
  }
  const topGestures = [...gestureCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    sentenceCount: sentences.length,
    maxConsecutiveSameStart: maxConsecutiveEqual(starts),
    topStartTokens: topStarts,
    startTokenUniqueRatio: starts.length ? new Set(starts).size / starts.length : 1,
    sensoryByChannel: sensory,
    sensoryTotal,
    dominantSensoryChannel: dominantSensory?.[0] ?? "none",
    dominantSensoryShare:
      sensoryTotal > 0 ? (dominantSensory?.[1] ?? 0) / sensoryTotal : 0,
    topGestures,
    gestureRepeatScore: topGestures.reduce((s, [, c]) => s + c, 0),
    similarLengthRunCount: countSimilarLengthRuns(lengths),
    avgSentenceLength: lengths.length
      ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
      : 0,
    lengthStdDev: stdDev(lengths),
  };
}

function stdDev(nums: number[]): number {
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
  return Math.round(Math.sqrt(v));
}

function buildSystem(proseStyle: string): string {
  return `[CORE RP] [A]=AI 캐릭터 · [B]=유저. 한 턴 RP 본문만 출력.

${proseStyle}

[OUTPUT LAYOUT]
Spoken dialogue in " " ALWAYS starts a new paragraph.

Write one continuous RP response (~600–900 Korean characters). No meta, no JSON.`;
}

async function main() {
  const { PROSE_STYLE_SECTION } = await import("@/lib/advancedProseNsfwGuidelines");
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("@/lib/chatModels");

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY required");
    process.exit(1);
  }

  const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
  const results: Record<string, unknown> = { model, scenes: [] as unknown[] };

  for (const scene of SCENES) {
    const sceneResult: Record<string, unknown> = {
      id: scene.id,
      label: scene.label,
      versions: {} as Record<string, unknown>,
    };

    for (const [version, prose] of [
      ["old", OLD_PROSE_STYLE],
      ["new", PROSE_STYLE_SECTION],
    ] as const) {
      const system = buildSystem(prose);
      const userContent = `${scene.setup}\n\n${scene.user}`;
      let text = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await callOpenRouterCompletion({
            system,
            history: [{ role: "user", content: userContent }],
            model,
            temperature: 0.85,
            maxTokens: 4096,
            requestKind: "prose-style-compare",
          });
          text = res.text.trim();
          if (text.length >= 200) break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      const metrics = analyze(text);
      (sceneResult.versions as Record<string, unknown>)[version] = {
        text,
        metrics,
      };
      console.log(`[done] ${scene.label} / ${version} — ${text.length} chars`);
    }

    (results.scenes as unknown[]).push(sceneResult);
  }

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "prose-style-variation-compare.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
