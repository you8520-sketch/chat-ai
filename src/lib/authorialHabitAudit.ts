/** Authorial habit audit — repetitive AI narration patterns in RP output. */

export type HabitCategory =
  | "turn_end_wait"
  | "turn_end_silence"
  | "turn_end_gaze"
  | "enumeration_triple"
  | "simile_machi"
  | "simile_like"
  | "ellipsis_glitch"
  | "hand_anchor"
  | "finger_anchor"
  | "explain_conclude"
  | "interpret_leak";

export type HabitPatternDef = {
  id: HabitCategory;
  label: string;
  /** Human-readable description */
  description: string;
  patterns: RegExp[];
};

export const AUTHORIAL_HABIT_PATTERNS: HabitPatternDef[] = [
  {
    id: "turn_end_wait",
    label: "턴 종료 — 기다림",
    description: "기다렸다/기다리며/반응을 기다",
    patterns: [
      /(?:반응|대답|말|선택|다음\s*말)을?\s*기다(?:렸|리|리며|리고)/g,
      /기다(?:렸|리)(?:다|며|고)\s*\.?\s*$/gm,
      /멈춘\s*채\s*[^.\n]{0,24}기다/g,
    ],
  },
  {
    id: "turn_end_silence",
    label: "턴 종료 — 침묵/정적",
    description: "침묵·정적·고요로 마무리",
    patterns: [
      /(?:침묵|정적|고요)(?:이|이\s*[^.\n]{0,20})?(?:내려|흘|가득|이어|남|깔|속)/g,
      /(?:침묵|정적|고요)[^.\n]{0,30}(?:\.|…)\s*$/gm,
      /조용히\s*(?:듣|기다|남|흘)/g,
    ],
  },
  {
    id: "turn_end_gaze",
    label: "턴 종료 — 시선/바라봄",
    description: "바라보았다·지켜보·응시로 끝",
    patterns: [
      /(?:바라보|지켜보|응시|올려다보|내려다보)[^.\n]{0,20}(?:\.|…)\s*$/gm,
      /시선(?:이|을)?\s*[^.\n]{0,24}(?:머물|고정|닿|남)/g,
    ],
  },
  {
    id: "enumeration_triple",
    label: "A도, B도, C도 열거",
    description: "도-열거 3회 이상",
    patterns: [/[^,\n]{1,24}도,\s*[^,\n]{1,24}도,\s*[^,\n]{1,24}도/g],
  },
  {
    id: "simile_machi",
    label: "마치 …처럼/같",
    description: "마치 비유",
    patterns: [/마치\s+[^.\n]{4,80}?(?:처럼|같(?:았|은|이|다|게))/g],
  },
  {
    id: "simile_like",
    label: "…처럼 / …같았",
    description: "일반 비유 (마치 제외)",
    patterns: [
      /(?<!마치\s)[^.\n]{2,40}(?:처럼|같(?:았|은|이|다|게))/g,
    ],
  },
  {
    id: "ellipsis_glitch",
    label: "말줄임표 glitch",
    description: "... . 또는 … . 부자연스러운 조합",
    patterns: [
      /\.\.\.\s*\./g,
      /…\s*\./g,
      /\.\.\.\s*[^\s.…][^.…]{0,3}\./g,
      /"\s*\.\.\.\s*"/g,
    ],
  },
  {
    id: "hand_anchor",
    label: "손 anchor",
    description: "손·손목·손바닥·손등 반복",
    patterns: [/손(?:목|바닥|등|끝|가락|을|이|에|으로|을)?/g],
  },
  {
    id: "finger_anchor",
    label: "손가락 anchor",
    description: "손가락·손끝 집중",
    patterns: [/손(?:가락|끝)/g],
  },
  {
    id: "explain_conclude",
    label: "설명→결론",
    description: "사실/결국/즉/라는 뜻 구조",
    patterns: [
      /(?:사실|결국|즉,|라는\s*뜻|그\s*말은|요컨대)[^.\n]{4,120}\./g,
      /[^.\n]{8,80}(?:였|었)다\.\s*[^.\n]{8,80}(?:였|었)다\./g,
    ],
  },
  {
    id: "interpret_leak",
    label: "해석 leak",
    description: "알아챘/깨달/의미/뜻 해설",
    patterns: [
      /(?:알아챘|깨달|의미(?:했|하|하는)|뜻(?:이|은|을)|그\s*사실(?:이|을))/g,
    ],
  },
];

export type HabitHit = {
  pattern: string;
  snippet: string;
};

export type SampleHabitMetrics = {
  id: string;
  source: string;
  charCount: number;
  hitsByCategory: Record<HabitCategory, number>;
  densityPer1k: Record<HabitCategory, number>;
  endingTags: string[];
  topPhrases: { phrase: string; count: number }[];
};

export type CorpusHabitSummary = {
  sampleCount: number;
  totalChars: number;
  /** % of samples with ≥1 hit */
  samplePrevalence: Record<HabitCategory, number>;
  /** mean hits per 1k chars across corpus */
  meanDensityPer1k: Record<HabitCategory, number>;
  /** aggregate hit counts */
  totalHits: Record<HabitCategory, number>;
  topEndingTags: { tag: string; count: number; sampleRate: number }[];
  topRepeatedPhrases: { phrase: string; sampleCount: number; totalCount: number }[];
  worstSamples: { id: string; source: string; score: number; topHabits: string[] }[];
};

function stripArtifacts(text: string): string {
  const i = text.search(/<<<STATUS/i);
  return (i >= 0 ? text.slice(0, i) : text)
    .replace(/\[태그:[^\]]+\]/g, "")
    .replace(/\[System Reminder:[^\]]+\]/gi, "")
    .trim();
}

function countMatches(text: string, patterns: RegExp[]): { count: number; snippets: string[] } {
  let count = 0;
  const snippets: string[] = [];
  for (const re of patterns) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const g = new RegExp(re.source, flags);
    for (const m of text.matchAll(g)) {
      count += 1;
      if (m[0] && snippets.length < 5) snippets.push(m[0].slice(0, 72));
    }
  }
  return { count, snippets };
}

const ENDING_TAG_RES: { tag: string; re: RegExp }[] = [
  { tag: "기다림", re: /(?:기다(?:렸|리)|반응을\s*기다)[^.\n]{0,24}(?:\.|…)\s*$/ },
  { tag: "침묵/정적", re: /(?:침묵|정적|고요)[^.\n]{0,30}(?:\.|…)\s*$/ },
  { tag: "바라봄/시선", re: /(?:바라보|지켜보|응시|올려다보)[^.\n]{0,24}(?:\.|…)\s*$/ },
  { tag: "멈춤", re: /(?:멈췄|멈추|멈칫|멈춰)[^.\n]{0,20}(?:\.|…)\s*$/ },
  { tag: "대사 종료", re: /"[^"\n]{2,120}"\s*$/ },
  { tag: "호흡/숨", re: /(?:숨|호흡)[^.\n]{0,20}(?:\.|…)\s*$/ },
];

const PHRASE_LEX = [
  "손끝",
  "손가락",
  "손목",
  "손바닥",
  "손을",
  "손이",
  "마치",
  "처럼",
  "같았",
  "침묵",
  "정적",
  "고요",
  "바라보",
  "지켜보",
  "기다렸",
  "기다리",
  "알아챘",
  "깨달",
  "그 사실",
  "결국",
  "…",
  "...",
] as const;

export function analyzeAuthorialHabits(
  id: string,
  source: string,
  rawText: string
): SampleHabitMetrics {
  const text = stripArtifacts(rawText);
  const chars = text.length || 1;
  const hitsByCategory = {} as Record<HabitCategory, number>;
  const densityPer1k = {} as Record<HabitCategory, number>;

  for (const def of AUTHORIAL_HABIT_PATTERNS) {
    const { count } = countMatches(text, def.patterns);
    hitsByCategory[def.id] = count;
    densityPer1k[def.id] = Math.round((count / chars) * 1000 * 100) / 100;
  }

  const endingTags: string[] = [];
  const tail = text.slice(-120);
  for (const { tag, re } of ENDING_TAG_RES) {
    if (re.test(tail)) endingTags.push(tag);
  }

  const phraseCounts = new Map<string, number>();
  for (const p of PHRASE_LEX) {
    const n = text.split(p).length - 1;
    if (n > 0) phraseCounts.set(p, n);
  }
  const topPhrases = [...phraseCounts.entries()]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return { id, source, charCount: chars, hitsByCategory, densityPer1k, endingTags, topPhrases };
}

export function summarizeAuthorialHabits(samples: SampleHabitMetrics[]): CorpusHabitSummary {
  const sampleCount = samples.length;
  const totalChars = samples.reduce((s, x) => s + x.charCount, 0) || 1;

  const totalHits = {} as Record<HabitCategory, number>;
  const samplePrevalence = {} as Record<HabitCategory, number>;
  const meanDensityPer1k = {} as Record<HabitCategory, number>;

  for (const def of AUTHORIAL_HABIT_PATTERNS) {
    const id = def.id;
    let hits = 0;
    let withHit = 0;
    let densitySum = 0;
    for (const s of samples) {
      hits += s.hitsByCategory[id] ?? 0;
      if ((s.hitsByCategory[id] ?? 0) > 0) withHit += 1;
      densitySum += s.densityPer1k[id] ?? 0;
    }
    totalHits[id] = hits;
    samplePrevalence[id] = Math.round((withHit / Math.max(1, sampleCount)) * 1000) / 10;
    meanDensityPer1k[id] = Math.round((densitySum / Math.max(1, sampleCount)) * 100) / 100;
  }

  const endingTagCounts = new Map<string, number>();
  for (const s of samples) {
    for (const t of s.endingTags) endingTagCounts.set(t, (endingTagCounts.get(t) ?? 0) + 1);
  }
  const topEndingTags = [...endingTagCounts.entries()]
    .map(([tag, count]) => ({
      tag,
      count,
      sampleRate: Math.round((count / Math.max(1, sampleCount)) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  const phraseSample = new Map<string, { sampleCount: number; totalCount: number }>();
  for (const s of samples) {
    for (const { phrase, count } of s.topPhrases) {
      const cur = phraseSample.get(phrase) ?? { sampleCount: 0, totalCount: 0 };
      cur.sampleCount += 1;
      cur.totalCount += count;
      phraseSample.set(phrase, cur);
    }
  }
  const topRepeatedPhrases = [...phraseSample.entries()]
    .map(([phrase, v]) => ({ phrase, ...v }))
    .sort((a, b) => b.totalCount - a.totalCount || b.sampleCount - a.sampleCount)
    .slice(0, 15);

  const worstSamples = samples
    .map((s) => {
      const weighted =
        (s.densityPer1k.hand_anchor ?? 0) * 1.2 +
        (s.densityPer1k.simile_machi ?? 0) * 1.1 +
        (s.densityPer1k.turn_end_gaze ?? 0) +
        (s.densityPer1k.turn_end_wait ?? 0) +
        (s.densityPer1k.turn_end_silence ?? 0) +
        (s.densityPer1k.explain_conclude ?? 0) * 0.8;
      const topHabits = AUTHORIAL_HABIT_PATTERNS.filter((d) => (s.hitsByCategory[d.id] ?? 0) > 0)
        .sort((a, b) => (s.hitsByCategory[b.id] ?? 0) - (s.hitsByCategory[a.id] ?? 0))
        .slice(0, 4)
        .map((d) => `${d.label}(${s.hitsByCategory[d.id]})`);
      return { id: s.id, source: s.source, score: Math.round(weighted * 100) / 100, topHabits };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    sampleCount,
    totalChars,
    samplePrevalence,
    meanDensityPer1k,
    totalHits,
    topEndingTags,
    topRepeatedPhrases,
    worstSamples,
  };
}

export function habitCategoryLabel(id: HabitCategory): string {
  return AUTHORIAL_HABIT_PATTERNS.find((d) => d.id === id)?.label ?? id;
}
