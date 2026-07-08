/**
 * Step 3-3 — Style diversity / new-anchor repetition audit.
 * Measures whether Style DNA / Universal Few-shot introduce new repetitive patterns.
 */

export type AnchorCategory =
  | "hand"
  | "breath"
  | "gaze"
  | "air"
  | "silence"
  | "sound"
  | "corridor"
  | "withhold"
  | "shortRhythm"
  | "hook";

export const ANCHOR_LEX: Record<AnchorCategory, { label: string; patterns: RegExp[] }> = {
  hand: { label: "hand/touch", patterns: [/손|손끝|손가락|손목|손바닥|피부|온기/g] },
  breath: { label: "숨/호흡", patterns: [/숨|호흡|숨결|숨소리/g] },
  gaze: { label: "시선/눈", patterns: [/시선|눈동자|눈을|눈이|눈빛/g] },
  air: { label: "공기", patterns: [/공기|바람/g] },
  silence: { label: "침묵", patterns: [/침묵|조용|고요/g] },
  sound: { label: "소리", patterns: [/소리|울렸|메아리|속삭|들렸|끊긴/g] },
  corridor: { label: "복도/형광등", patterns: [/복도|형광등|문틈|가로등/g] },
  withhold: {
    label: "withhold",
    patterns: [/말하지|입술을 닫|대신|숨기|티 내지|괜찮지 않|거짓/g],
  },
  shortRhythm: { label: "한 걸음/짧은 단락", patterns: [/한 걸음|또 한 걸음|목소리가 짧/g] },
  hook: { label: "hook(…/?)", patterns: [/…|\.\.\./g, /\?/g] },
};

export type DiversityAuditMetrics = {
  charCount: number;
  /** hits per 1000 chars */
  anchorDensity: Record<AnchorCategory, number>;
  /** dominant anchor share among non-hook anchors */
  dominantAnchor: AnchorCategory | null;
  dominantShare: number;
  /** sensation channel repetition */
  sensationRepeatScore: number;
  /** rhythm */
  shortSentenceRatio: number;
  singleLineParagraphRatio: number;
  /** hooks per 500 chars */
  hookDensity: number;
  ellipsisDensity: number;
  questionDensity: number;
  /** structure */
  topStartToken: string;
  topStartShare: number;
  startTokenUniqueRatio: number;
  /** withhold */
  withholdDensity: number;
  /** hand specifically */
  handDensity: number;
};

function stripArtifacts(text: string): string {
  const i = text.search(/<<<STATUS/i);
  return (i >= 0 ? text.slice(0, i) : text).replace(/\[태그:[^\]]+\]/g, "").trim();
}

function countPatternHits(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const re of patterns) {
    n += text.match(re)?.length ?? 0;
  }
  return n;
}

function sentenceStarts(text: string): string[] {
  const body = stripArtifacts(text).replace(/"[^"]*"/g, "");
  return body
    .split(/(?<=[.?!…])\s+|\n+/)
    .map((s) => {
      const m = s.trim().match(/^([^\s,.]{1,6})/);
      return m?.[1] ?? "";
    })
    .filter(Boolean);
}

function sensationRepeatScore(text: string): number {
  const cats = ["breath", "gaze", "air", "silence", "sound"] as const;
  let excess = 0;
  for (const cat of cats) {
    const hits = countPatternHits(text, ANCHOR_LEX[cat].patterns);
    if (hits >= 3) excess += hits - 2;
  }
  return excess;
}

export function analyzeStyleDiversity(text: string): DiversityAuditMetrics {
  const body = stripArtifacts(text);
  const chars = body.length || 1;
  const per1k = (n: number) => Math.round((n / chars) * 1000 * 100) / 100;

  const anchorDensity = {} as Record<AnchorCategory, number>;
  for (const [key, def] of Object.entries(ANCHOR_LEX) as [AnchorCategory, (typeof ANCHOR_LEX)[AnchorCategory]][]) {
    anchorDensity[key] = per1k(countPatternHits(body, def.patterns));
  }

  const nonHookAnchors: AnchorCategory[] = [
    "hand",
    "breath",
    "gaze",
    "air",
    "silence",
    "sound",
    "corridor",
    "withhold",
    "shortRhythm",
  ];
  let dominant: AnchorCategory | null = null;
  let domVal = 0;
  let totalAnchor = 0;
  for (const k of nonHookAnchors) {
    totalAnchor += anchorDensity[k];
    if (anchorDensity[k] > domVal) {
      domVal = anchorDensity[k];
      dominant = k;
    }
  }

  const sentences = body
    .split(/(?<=[.?!…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const shortSent = sentences.filter((s) => s.replace(/"[^"]*"/g, "").length <= 18).length;

  const paras = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const singleLine = paras.filter((p) => p.replace(/"[^"]*"/g, "").length <= 22).length;

  const starts = sentenceStarts(body);
  const startCounts = new Map<string, number>();
  for (const s of starts) startCounts.set(s, (startCounts.get(s) ?? 0) + 1);
  let topStart = "";
  let topCount = 0;
  for (const [tok, c] of startCounts) {
    if (c > topCount) {
      topCount = c;
      topStart = tok;
    }
  }

  const hookHits = countPatternHits(body, ANCHOR_LEX.hook.patterns);
  const ellipsis = (body.match(/…|\.\.\./g) ?? []).length;
  const questions = (body.match(/\?/g) ?? []).length;

  return {
    charCount: chars,
    anchorDensity,
    dominantAnchor: dominant,
    dominantShare: totalAnchor > 0 ? Math.round((domVal / totalAnchor) * 1000) / 1000 : 0,
    sensationRepeatScore: sensationRepeatScore(body),
    shortSentenceRatio: Math.round((shortSent / (sentences.length || 1)) * 1000) / 1000,
    singleLineParagraphRatio: Math.round((singleLine / (paras.length || 1)) * 1000) / 1000,
    hookDensity: per1k(hookHits),
    ellipsisDensity: per1k(ellipsis),
    questionDensity: per1k(questions),
    topStartToken: topStart,
    topStartShare: Math.round((topCount / (starts.length || 1)) * 1000) / 1000,
    startTokenUniqueRatio:
      Math.round((new Set(starts).size / (starts.length || 1)) * 1000) / 1000,
    withholdDensity: anchorDensity.withhold,
    handDensity: anchorDensity.hand,
  };
}

export type AggregatedDiversity = {
  sampleCount: number;
  mean: DiversityAuditMetrics;
};

function meanMetric(samples: DiversityAuditMetrics[]): DiversityAuditMetrics {
  const n = samples.length || 1;
  const avg = (fn: (m: DiversityAuditMetrics) => number) =>
    Math.round((samples.reduce((s, m) => s + fn(m), 0) / n) * 100) / 100;

  const anchorDensity = {} as Record<AnchorCategory, number>;
  for (const k of Object.keys(ANCHOR_LEX) as AnchorCategory[]) {
    anchorDensity[k] = avg((m) => m.anchorDensity[k]);
  }

  const domCounts = new Map<string, number>();
  for (const s of samples) {
    if (s.dominantAnchor) domCounts.set(s.dominantAnchor, (domCounts.get(s.dominantAnchor) ?? 0) + 1);
  }
  let dominantAnchor: AnchorCategory | null = null;
  let best = 0;
  for (const [k, c] of domCounts) {
    if (c > best) {
      best = c;
      dominantAnchor = k as AnchorCategory;
    }
  }

  const startCounts = new Map<string, number>();
  for (const s of samples) {
    startCounts.set(s.topStartToken, (startCounts.get(s.topStartToken) ?? 0) + 1);
  }
  let topStartToken = "";
  let topStartN = 0;
  for (const [t, c] of startCounts) {
    if (c > topStartN) {
      topStartN = c;
      topStartToken = t;
    }
  }

  return {
    charCount: Math.round(avg((m) => m.charCount)),
    anchorDensity,
    dominantAnchor,
    dominantShare: avg((m) => m.dominantShare),
    sensationRepeatScore: avg((m) => m.sensationRepeatScore),
    shortSentenceRatio: avg((m) => m.shortSentenceRatio),
    singleLineParagraphRatio: avg((m) => m.singleLineParagraphRatio),
    hookDensity: avg((m) => m.hookDensity),
    ellipsisDensity: avg((m) => m.ellipsisDensity),
    questionDensity: avg((m) => m.questionDensity),
    topStartToken,
    topStartShare: avg((m) => m.topStartShare),
    startTokenUniqueRatio: avg((m) => m.startTokenUniqueRatio),
    withholdDensity: avg((m) => m.withholdDensity),
    handDensity: avg((m) => m.handDensity),
  };
}

export function aggregateDiversity(samples: DiversityAuditMetrics[]): AggregatedDiversity {
  return { sampleCount: samples.length, mean: meanMetric(samples) };
}

export type DiversityComparisonRow = {
  dimension: string;
  before: string;
  after: string;
  newRepetition: string;
  risk: "Low" | "Medium" | "High";
};

function riskFromDelta(before: number, after: number, threshold: number): "Low" | "Medium" | "High" {
  const delta = after - before;
  if (delta <= threshold * 0.5) return "Low";
  if (delta <= threshold) return "Medium";
  return "High";
}

export function buildDiversityComparison(
  before: AggregatedDiversity,
  after: AggregatedDiversity
): DiversityComparisonRow[] {
  const b = before.mean;
  const a = after.mean;
  const rows: DiversityComparisonRow[] = [];

  const sensationBefore =
    b.anchorDensity.breath +
    b.anchorDensity.gaze +
    b.anchorDensity.air +
    b.anchorDensity.silence +
    b.anchorDensity.sound;
  const sensationAfter =
    a.anchorDensity.breath +
    a.anchorDensity.gaze +
    a.anchorDensity.air +
    a.anchorDensity.silence +
    a.anchorDensity.sound;

  rows.push({
    dimension: "감각 anchor (숨·시선·공기·침묵·소리) /1k chars",
    before: `${sensationBefore.toFixed(1)} (repeat score ${b.sensationRepeatScore})`,
    after: `${sensationAfter.toFixed(1)} (repeat score ${a.sensationRepeatScore})`,
    newRepetition:
      sensationAfter > sensationBefore
        ? `+${(sensationAfter - sensationBefore).toFixed(1)}/1k — ${a.dominantAnchor ?? "?"} dominant`
        : "감소 또는 유사",
    risk: riskFromDelta(sensationBefore, sensationAfter, 8),
  });

  rows.push({
    dimension: "리듬 (짧은 문장 비율 / 1줄 단락)",
    before: `${(b.shortSentenceRatio * 100).toFixed(0)}% / ${(b.singleLineParagraphRatio * 100).toFixed(0)}%`,
    after: `${(a.shortSentenceRatio * 100).toFixed(0)}% / ${(a.singleLineParagraphRatio * 100).toFixed(0)}%`,
    newRepetition:
      a.anchorDensity.shortRhythm > b.anchorDensity.shortRhythm + 2
        ? `「한 걸음」류 +${(a.anchorDensity.shortRhythm - b.anchorDensity.shortRhythm).toFixed(1)}/1k`
        : "짧은 호흡 증가 (의도된 DNA)",
    risk: a.singleLineParagraphRatio > 0.45 ? "Medium" : "Low",
  });

  rows.push({
    dimension: "hook (… / ?) /1k",
    before: `${b.hookDensity.toFixed(1)} (… ${b.ellipsisDensity.toFixed(1)}, ? ${b.questionDensity.toFixed(1)})`,
    after: `${a.hookDensity.toFixed(1)} (… ${a.ellipsisDensity.toFixed(1)}, ? ${a.questionDensity.toFixed(1)})`,
    newRepetition:
      a.hookDensity > b.hookDensity + 5
        ? `hook +${(a.hookDensity - b.hookDensity).toFixed(1)}/1k — turn마다 …/? 고착 위험`
        : "pull 리듬 강화",
    risk: riskFromDelta(b.hookDensity, a.hookDensity, 10),
  });

  rows.push({
    dimension: "문장 시작 구조",
    before: `top「${b.topStartToken}」${(b.topStartShare * 100).toFixed(0)}% · unique ${b.startTokenUniqueRatio.toFixed(2)}`,
    after: `top「${a.topStartToken}」${(a.topStartShare * 100).toFixed(0)}% · unique ${a.startTokenUniqueRatio.toFixed(2)}`,
    newRepetition:
      a.startTokenUniqueRatio < b.startTokenUniqueRatio - 0.05
        ? "시작형 다양성 감소"
        : "유사 또는 개선",
    risk: a.topStartShare > 0.35 ? "Medium" : "Low",
  });

  rows.push({
    dimension: "withhold 패턴 /1k",
    before: `${b.withholdDensity.toFixed(1)}`,
    after: `${a.withholdDensity.toFixed(1)}`,
    newRepetition:
      a.withholdDensity > b.withholdDensity + 3
        ? "「말하지 않·대신·입술을 닫」템플릿화 위험"
        : "정보 공개 타이밍 학습 (의도)",
    risk: riskFromDelta(b.withholdDensity, a.withholdDensity, 5),
  });

  rows.push({
    dimension: "hand anchor /1k",
    before: `${b.handDensity.toFixed(1)}`,
    after: `${a.handDensity.toFixed(1)}`,
    newRepetition: `Δ ${(a.handDensity - b.handDensity).toFixed(1)}`,
    risk: a.handDensity > b.handDensity ? "High" : "Low",
  });

  const newAnchorSum =
    a.anchorDensity.sound +
    a.anchorDensity.breath +
    a.anchorDensity.gaze +
    a.anchorDensity.corridor;
  const oldHand = b.handDensity;
  rows.push({
    dimension: "NEW anchor (소리+숨+시선+복도) vs hand 대체",
    before: `hand ${oldHand.toFixed(1)} > new-bundle ${(b.anchorDensity.sound + b.anchorDensity.breath + b.anchorDensity.gaze + b.anchorDensity.corridor).toFixed(1)}`,
    after: `hand ${a.handDensity.toFixed(1)} · new-bundle ${newAnchorSum.toFixed(1)}`,
    newRepetition:
      newAnchorSum > oldHand * 0.8
        ? `hand↓ 대신 sensory corridor anchor ↑ — ${a.dominantAnchor ?? "mixed"}`
        : "hand 대체 anchor 미약",
    risk: newAnchorSum > 15 ? "High" : newAnchorSum > 8 ? "Medium" : "Low",
  });

  return rows;
}
