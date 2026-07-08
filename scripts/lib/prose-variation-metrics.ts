/** Shared prose variation test harness — scenes, system builder, metric analysis. */

export const PROSE_VARIATION_SCENES = [
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

export type ProseVariationScene = (typeof PROSE_VARIATION_SCENES)[number];

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

export type ProseVariationMetrics = {
  sentenceCount: number;
  maxConsecutiveSameStart: number;
  startTokenUniqueRatio: number;
  dominantSensoryShare: number;
  gestureRepeatScore: number;
  similarLengthRunCount: number;
  lengthStdDev: number;
};

export const VARIATION_METRIC_DEFS = [
  {
    key: "maxConsecutiveSameStart" as const,
    label: "문장 시작 연속 반복",
    higherIsBetter: false,
  },
  {
    key: "startTokenUniqueRatio" as const,
    label: "문장 시작 다양성",
    higherIsBetter: true,
  },
  {
    key: "dominantSensoryShare" as const,
    label: "감각 채널 집중",
    higherIsBetter: false,
  },
  {
    key: "gestureRepeatScore" as const,
    label: "몸짓 반복",
    higherIsBetter: false,
  },
  {
    key: "similarLengthRunCount" as const,
    label: "문장 길이 반복",
    higherIsBetter: false,
  },
  {
    key: "lengthStdDev" as const,
    label: "문장 길이 분산",
    higherIsBetter: true,
  },
];

export type VariationMetricKey = (typeof VARIATION_METRIC_DEFS)[number]["key"];

export function buildProseVariationSystem(guidelinesBlock: string): string {
  return `[CORE RP] [A]=AI 캐릭터 · [B]=유저. 한 턴 RP 본문만 출력.

${guidelinesBlock}

[OUTPUT LAYOUT]
Spoken dialogue in " " ALWAYS starts a new paragraph.

Write one continuous RP response (~600–900 Korean characters). No meta, no JSON.`;
}

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

function sentenceLengthStdDev(lengths: number[]): number {
  if (lengths.length === 0) return 0;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const v = lengths.reduce((s, n) => s + (n - mean) ** 2, 0) / lengths.length;
  return Math.round(Math.sqrt(v));
}

export function analyzeProseVariation(text: string): ProseVariationMetrics {
  const sentences = splitSentences(text);
  const starts = sentences.map(firstToken);
  const lengths = sentences.map((s) => s.length);

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
    startTokenUniqueRatio: starts.length ? new Set(starts).size / starts.length : 1,
    dominantSensoryShare: sensoryTotal > 0 ? (dominantSensory?.[1] ?? 0) / sensoryTotal : 0,
    gestureRepeatScore: topGestures.reduce((s, [, c]) => s + c, 0),
    similarLengthRunCount: countSimilarLengthRuns(lengths),
    lengthStdDev: sentenceLengthStdDev(lengths),
  };
}

export function metricValue(m: ProseVariationMetrics, key: VariationMetricKey): number {
  return m[key];
}

export function isAfterBetter(
  before: number,
  after: number,
  higherIsBetter: boolean
): boolean {
  if (before === after) return false;
  return higherIsBetter ? after > before : after < before;
}

export function improvementDelta(
  before: number,
  after: number,
  higherIsBetter: boolean
): number {
  return higherIsBetter ? after - before : before - after;
}
