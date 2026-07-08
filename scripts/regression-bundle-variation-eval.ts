/**
 * Step 1 Regression Evaluation — bundle before vs after (duplicate rules removed).
 * Same harness as compare-prose-style-variation.ts (model, temp, scenes, metrics).
 *
 * Usage: npx tsx scripts/regression-bundle-variation-eval.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

type Metrics = {
  sentenceCount: number;
  maxConsecutiveSameStart: number;
  topStartTokens: [string, number][];
  startTokenUniqueRatio: number;
  sensoryByChannel: Record<string, number>;
  sensoryTotal: number;
  dominantSensoryChannel: string;
  dominantSensoryShare: number;
  topGestures: [string, number][];
  gestureRepeatScore: number;
  similarLengthRunCount: number;
  avgSentenceLength: number;
  lengthStdDev: number;
};

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

function stdDev(nums: number[]): number {
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
  return Math.round(Math.sqrt(v));
}

function analyze(text: string): Metrics {
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
    dominantSensoryShare: sensoryTotal > 0 ? (dominantSensory?.[1] ?? 0) / sensoryTotal : 0,
    topGestures,
    gestureRepeatScore: topGestures.reduce((s, [, c]) => s + c, 0),
    similarLengthRunCount: countSimilarLengthRuns(lengths),
    avgSentenceLength: lengths.length
      ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
      : 0,
    lengthStdDev: stdDev(lengths),
  };
}

function buildSystem(guidelinesBlock: string): string {
  return `[CORE RP] [A]=AI 캐릭터 · [B]=유저. 한 턴 RP 본문만 출력.

${guidelinesBlock}

[OUTPUT LAYOUT]
Spoken dialogue in " " ALWAYS starts a new paragraph.

Write one continuous RP response (~600–900 Korean characters). No meta, no JSON.`;
}

function delta(after: number, before: number, lowerIsBetter: boolean): string {
  const d = after - before;
  if (d === 0) return "0";
  const improved = lowerIsBetter ? d < 0 : d > 0;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d}${improved ? " ✓" : " ✗"}`;
}

function avgMetrics(all: Metrics[]): Metrics {
  const keys = [
    "sentenceCount",
    "maxConsecutiveSameStart",
    "startTokenUniqueRatio",
    "sensoryTotal",
    "dominantSensoryShare",
    "gestureRepeatScore",
    "similarLengthRunCount",
    "avgSentenceLength",
    "lengthStdDev",
  ] as const;
  const out = {} as Metrics;
  for (const k of keys) {
    const vals = all.map((m) => m[k] as number);
    (out as Record<string, number>)[k] =
      Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
  }
  return out;
}

async function main() {
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("@/lib/chatModels");
  const { buildAdvancedProseNsfwGuidelines } = await import("@/lib/advancedProseNsfwGuidelines");

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY required");
    process.exit(1);
  }

  const beforePath = join(process.cwd(), "output", "prose-bundle-before.txt");
  const bundleBefore = readFileSync(beforePath, "utf8");
  const bundleAfter = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true });

  const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
  const temperature = 0.85;
  const results: Record<string, unknown> = {
    test: "step1-bundle-regression",
    model,
    temperature,
    note: "PROSE STYLE unchanged; compares full bundle before/after duplicate removal",
    bundleBeforeChars: bundleBefore.length,
    bundleAfterChars: bundleAfter.length,
    scenes: [] as unknown[],
  };

  for (const scene of SCENES) {
    const sceneResult: Record<string, unknown> = {
      id: scene.id,
      label: scene.label,
      versions: {} as Record<string, unknown>,
    };

    for (const [version, bundle] of [
      ["bundle_before", bundleBefore],
      ["bundle_after", bundleAfter],
    ] as const) {
      const system = buildSystem(bundle);
      const userContent = `${scene.setup}\n\n${scene.user}`;
      let text = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await callOpenRouterCompletion({
            system,
            history: [{ role: "user", content: userContent }],
            model,
            temperature,
            maxTokens: 4096,
            requestKind: "bundle-regression-eval",
          });
          text = res.text.trim();
          if (text.length >= 200) break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      const metrics = analyze(text);
      (sceneResult.versions as Record<string, unknown>)[version] = { text, metrics };
      console.log(`[done] ${scene.label} / ${version} — ${text.length} chars`);
    }

    (results.scenes as unknown[]).push(sceneResult);
  }

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "bundle-regression-variation-eval.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nWrote ${outPath}`);

  // Summary table
  const scenes = results.scenes as Array<{
    id: string;
    label: string;
    versions: { bundle_before: { metrics: Metrics }; bundle_after: { metrics: Metrics } };
  }>;

  const beforeAll = scenes.map((s) => s.versions.bundle_before.metrics);
  const afterAll = scenes.map((s) => s.versions.bundle_after.metrics);
  const avgBefore = avgMetrics(beforeAll);
  const avgAfter = avgMetrics(afterAll);

  console.log("\n=== Step 1 Bundle Regression (4-scene avg) ===");
  console.log(
    "maxConsecutiveSameStart (↓):",
    avgBefore.maxConsecutiveSameStart,
    "→",
    avgAfter.maxConsecutiveSameStart,
    delta(avgAfter.maxConsecutiveSameStart, avgBefore.maxConsecutiveSameStart, true)
  );
  console.log(
    "startTokenUniqueRatio (↑):",
    avgBefore.startTokenUniqueRatio,
    "→",
    avgAfter.startTokenUniqueRatio,
    delta(avgAfter.startTokenUniqueRatio, avgBefore.startTokenUniqueRatio, false)
  );
  console.log(
    "dominantSensoryShare (↓):",
    avgBefore.dominantSensoryShare,
    "→",
    avgAfter.dominantSensoryShare,
    delta(avgAfter.dominantSensoryShare, avgBefore.dominantSensoryShare, true)
  );
  console.log(
    "gestureRepeatScore (↓):",
    avgBefore.gestureRepeatScore,
    "→",
    avgAfter.gestureRepeatScore,
    delta(avgAfter.gestureRepeatScore, avgBefore.gestureRepeatScore, true)
  );
  console.log(
    "similarLengthRunCount (↓):",
    avgBefore.similarLengthRunCount,
    "→",
    avgAfter.similarLengthRunCount,
    delta(avgAfter.similarLengthRunCount, avgBefore.similarLengthRunCount, true)
  );
  console.log(
    "lengthStdDev (↑):",
    avgBefore.lengthStdDev,
    "→",
    avgAfter.lengthStdDev,
    delta(avgAfter.lengthStdDev, avgBefore.lengthStdDev, false)
  );

  // Per-scene
  console.log("\n=== Per scene ===");
  for (const s of scenes) {
    const b = s.versions.bundle_before.metrics;
    const a = s.versions.bundle_after.metrics;
    const wins = [
      a.maxConsecutiveSameStart <= b.maxConsecutiveSameStart,
      a.startTokenUniqueRatio >= b.startTokenUniqueRatio,
      a.dominantSensoryShare <= b.dominantSensoryShare,
      a.gestureRepeatScore <= b.gestureRepeatScore,
      a.similarLengthRunCount <= b.similarLengthRunCount,
      a.lengthStdDev >= b.lengthStdDev,
    ].filter(Boolean).length;
    console.log(
      `${s.label}: after wins ${wins}/6 metrics | start ${b.maxConsecutiveSameStart}→${a.maxConsecutiveSameStart} | sensoryShare ${(b.dominantSensoryShare * 100).toFixed(0)}%→${(a.dominantSensoryShare * 100).toFixed(0)}% | gesture ${b.gestureRepeatScore}→${a.gestureRepeatScore} | lenRuns ${b.similarLengthRunCount}→${a.similarLengthRunCount}`
    );
  }

  // Reference: prior PROSE-only test (new column)
  const priorPath = join(outDir, "prose-style-variation-compare.json");
  try {
    const prior = JSON.parse(readFileSync(priorPath, "utf8")) as {
      scenes: Array<{ id: string; versions: { new: { metrics: Metrics } } }>;
    };
    const priorNew = prior.scenes.map((s) => s.versions.new.metrics);
    const avgPriorNew = avgMetrics(priorNew);
    console.log("\n=== Reference: prior test (PROSE STYLE only, 'new' column) ===");
    console.log("avg maxConsecutiveSameStart:", avgPriorNew.maxConsecutiveSameStart);
    console.log("avg startTokenUniqueRatio:", avgPriorNew.startTokenUniqueRatio);
    console.log("avg dominantSensoryShare:", avgPriorNew.dominantSensoryShare);
    console.log("avg gestureRepeatScore:", avgPriorNew.gestureRepeatScore);
    console.log("avg similarLengthRunCount:", avgPriorNew.similarLengthRunCount);
    console.log("avg lengthStdDev:", avgPriorNew.lengthStdDev);
    console.log("\n=== bundle_after vs prior PROSE-only 'new' ===");
    console.log(
      "maxConsecutiveSameStart:",
      avgAfter.maxConsecutiveSameStart,
      "vs",
      avgPriorNew.maxConsecutiveSameStart
    );
    console.log(
      "gestureRepeatScore:",
      avgAfter.gestureRepeatScore,
      "vs",
      avgPriorNew.gestureRepeatScore
    );
    console.log(
      "similarLengthRunCount:",
      avgAfter.similarLengthRunCount,
      "vs",
      avgPriorNew.similarLengthRunCount
    );
  } catch {
    console.log("\n(prior prose-style-variation-compare.json not found — skip reference)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
