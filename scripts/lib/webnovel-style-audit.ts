/**
 * Webnovel style audit — quantified dimensions + 0–10 scores (higher = better).
 * Used by scripts/audit-webnovel-style-production.ts (read-only; no production changes).
 */

import { analyzeHandTouchAudit } from "./hand-touch-audit-metrics";
import { analyzeProseVariation } from "./prose-variation-metrics";

export type WebnovelStyleDimension =
  | "handTouchControl"
  | "dialogueRhythm"
  | "dialogueNarrationRatio"
  | "emotionBeatDiversity"
  | "narrativeFlow"
  | "povOpeningDiversity"
  | "sceneTransitionRhythm";

export const WEBNOVEL_STYLE_DIMENSIONS: {
  id: WebnovelStyleDimension;
  label: string;
  labelKo: string;
}[] = [
  { id: "handTouchControl", label: "hand/touch control", labelKo: "hand/touch 반복 억제" },
  { id: "dialogueRhythm", label: "dialogue rhythm", labelKo: "대화 리듬" },
  { id: "dialogueNarrationRatio", label: "dialogue/narration ratio", labelKo: "대사·지문 비율" },
  { id: "emotionBeatDiversity", label: "emotion beat diversity", labelKo: "감정 beat 다양성" },
  { id: "narrativeFlow", label: "narrative flow", labelKo: "서술 흐름" },
  { id: "povOpeningDiversity", label: "POV opening diversity", labelKo: "POV 시작 다양성" },
  { id: "sceneTransitionRhythm", label: "scene transition rhythm", labelKo: "장면 전환 리듬" },
];

export type WebnovelStyleRawMetrics = {
  handFrequency: number;
  touchShare: number;
  gestureRepeatScore: number;
  beatSameBodyPartRepeat: number;
  dialogueBlockCount: number;
  narrationBlockCount: number;
  dialogueCharShare: number;
  maxConsecutiveNarrationBlocks: number;
  maxConsecutiveDialogueBlocks: number;
  alternationScore: number;
  emotionLabelCount: number;
  emotionChannelCount: number;
  emotionBeatRepeatScore: number;
  maxConsecutiveSameStart: number;
  startTokenUniqueRatio: number;
  similarLengthRunCount: number;
  lengthStdDev: number;
  connectorSpamScore: number;
  povNameStartShare: number;
  povPronounStartShare: number;
  paragraphStartUniqueRatio: number;
  transitionMarkerCount: number;
  transitionMarkerUnique: number;
  abruptShortParagraphRun: number;
};

export type DimensionScore = {
  dimension: WebnovelStyleDimension;
  score: number;
  rationale: string;
  evidenceSnippet: string;
};

export type WebnovelStyleAuditResult = {
  messageId: number;
  chatId: number;
  charCount: number;
  raw: WebnovelStyleRawMetrics;
  dimensionScores: DimensionScore[];
  overallScore: number;
};

const EMOTION_LABELS = [
  "슬프",
  "화가",
  "화를",
  "기쁨",
  "기뻤",
  "불안",
  "긴장",
  "당황",
  "설렘",
  "설레",
  "공포",
  "두려",
  "분노",
  "외로",
  "쓸쓸",
  "후회",
  "미안",
  "짜증",
  "답답",
];

const EMOTION_CHANNELS: { id: string; re: RegExp }[] = [
  { id: "gaze", re: /시선|눈동자|눈을|눈이/g },
  { id: "breath", re: /호흡|숨|숨결/g },
  { id: "hand", re: /손|손끝|손가락/g },
  { id: "voice", re: /목소리|말투|속삭/g },
  { id: "posture", re: /어깨|고개|몸을|몸이/g },
  { id: "temperature", re: /온기|냉기|차가|뜨거/g },
  { id: "space", re: /거리|공기|침묵/g },
];

const TRANSITION_MARKERS = [
  "한편",
  "잠시",
  "그때",
  "이윽고",
  "곧",
  "문득",
  "동시에",
  "반면",
  "한쪽",
  "멀리",
  "가까이",
  "이어",
  "잠깐",
  "오랜",
  "다시",
  "그 순간",
  "그 사이",
];

function stripArtifacts(text: string): string {
  const i = text.search(/<<<STATUS/i);
  const body = i >= 0 ? text.slice(0, i) : text;
  return body.replace(/\[태그:[^\]]+\]/g, "").trim();
}

function splitParagraphs(text: string): string[] {
  return stripArtifacts(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p: string): boolean {
  const t = p.trim();
  if (/^["「『]/.test(t)) return true;
  const quotes = t.match(/"[^"]+"/g) ?? [];
  const quoteChars = quotes.join("").length;
  return quoteChars > 0 && quoteChars / t.length >= 0.45;
}

function dialogueCharShare(text: string): number {
  const body = stripArtifacts(text);
  const quotes = body.match(/"[^"]+"/g) ?? [];
  const qChars = quotes.join("").length;
  return body.length > 0 ? qChars / body.length : 0;
}

function maxConsecutiveRun(blocks: boolean[]): number {
  let best = 0;
  let run = 0;
  for (const b of blocks) {
    if (b) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  return best;
}

function alternationScore(isDialogue: boolean[]): number {
  if (isDialogue.length < 2) return 1;
  let switches = 0;
  for (let i = 1; i < isDialogue.length; i++) {
    if (isDialogue[i] !== isDialogue[i - 1]) switches++;
  }
  return switches / (isDialogue.length - 1);
}

function emotionMetrics(text: string): {
  labelCount: number;
  channelCount: number;
  beatRepeat: number;
} {
  const beats = splitParagraphs(text).filter((p) => !isDialogueParagraph(p));
  let labelCount = 0;
  for (const lab of EMOTION_LABELS) {
    labelCount += text.match(new RegExp(lab, "g"))?.length ?? 0;
  }
  const channels = new Set<string>();
  for (const ch of EMOTION_CHANNELS) {
    if (ch.re.test(text)) channels.add(ch.id);
  }
  let beatRepeat = 0;
  for (const beat of beats) {
    for (const lab of EMOTION_LABELS) {
      const hits = beat.match(new RegExp(lab, "g"))?.length ?? 0;
      if (hits >= 2) beatRepeat += hits - 1;
    }
  }
  return { labelCount, channelCount: channels.size, beatRepeat };
}

function paragraphOpenings(paragraphs: string[]): string[] {
  return paragraphs.map((p) => {
    const prose = p.replace(/"[^"]*"/g, "").trim();
    const m = prose.match(/^[\s]*([^\s,.]{1,8})/);
    return m?.[1] ?? prose.slice(0, 4);
  });
}

function povStartShares(paragraphs: string[]): { name: number; pronoun: number; unique: number } {
  const openings = paragraphOpenings(paragraphs);
  if (openings.length === 0) return { name: 0, pronoun: 0, unique: 1 };
  const nameStarts = openings.filter((o) => /[가-힣]{2,4}(은|는|이|가|의)$/.test(o)).length;
  const pronounStarts = openings.filter((o) => /^(그|그녀|그는|그녀는|그가|그녀가)/.test(o)).length;
  return {
    name: nameStarts / openings.length,
    pronoun: pronounStarts / openings.length,
    unique: new Set(openings).size / openings.length,
  };
}

function connectorSpam(text: string): number {
  const words = ["그리고", "하지만", "그러나", "그래서", "그러고", "그런데", "이어", "이윽고"];
  return words.reduce((n, w) => n + (text.match(new RegExp(w, "g"))?.length ?? 0), 0);
}

function transitionMetrics(text: string): { count: number; unique: number } {
  const found = new Set<string>();
  let count = 0;
  for (const m of TRANSITION_MARKERS) {
    const c = text.match(new RegExp(m, "g"))?.length ?? 0;
    if (c > 0) {
      found.add(m);
      count += c;
    }
  }
  return { count, unique: found.size };
}

function abruptShortParagraphRun(paragraphs: string[]): number {
  let runs = 0;
  let run = 0;
  for (const p of paragraphs) {
    const len = p.replace(/"[^"]*"/g, "").length;
    if (len > 0 && len < 35) {
      run++;
      if (run >= 4) runs++;
    } else run = 0;
  }
  return runs;
}

function clampScore(n: number): number {
  return Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
}

function snippetAround(text: string, pattern: RegExp, radius = 80): string {
  const body = stripArtifacts(text).replace(/\s+/g, " ");
  const m = body.match(pattern);
  if (!m || m.index == null) return body.slice(0, 160);
  const start = Math.max(0, m.index - radius);
  const end = Math.min(body.length, m.index + (m[0]?.length ?? 0) + radius);
  return (start > 0 ? "…" : "") + body.slice(start, end).trim() + (end < body.length ? "…" : "");
}

export function computeRawMetrics(text: string): WebnovelStyleRawMetrics {
  const paragraphs = splitParagraphs(text);
  const isDlg = paragraphs.map(isDialogueParagraph);
  const handTouch = analyzeHandTouchAudit(text);
  const prose = analyzeProseVariation(text);
  const emo = emotionMetrics(text);
  const pov = povStartShares(paragraphs);
  const trans = transitionMetrics(text);

  return {
    handFrequency: handTouch.handFrequency,
    touchShare: handTouch.touchShare,
    gestureRepeatScore: handTouch.gestureRepeatScore,
    beatSameBodyPartRepeat: handTouch.beatSameBodyPartRepeat,
    dialogueBlockCount: isDlg.filter(Boolean).length,
    narrationBlockCount: isDlg.filter((d) => !d).length,
    dialogueCharShare: dialogueCharShare(text),
    maxConsecutiveNarrationBlocks: maxConsecutiveRun(isDlg.map((d) => !d)),
    maxConsecutiveDialogueBlocks: maxConsecutiveRun(isDlg),
    alternationScore: alternationScore(isDlg),
    emotionLabelCount: emo.labelCount,
    emotionChannelCount: emo.channelCount,
    emotionBeatRepeatScore: emo.beatRepeat,
    maxConsecutiveSameStart: prose.maxConsecutiveSameStart,
    startTokenUniqueRatio: prose.startTokenUniqueRatio,
    similarLengthRunCount: prose.similarLengthRunCount,
    lengthStdDev: prose.lengthStdDev,
    connectorSpamScore: connectorSpam(text),
    povNameStartShare: pov.name,
    povPronounStartShare: pov.pronoun,
    paragraphStartUniqueRatio: pov.unique,
    transitionMarkerCount: trans.count,
    transitionMarkerUnique: trans.unique,
    abruptShortParagraphRun: abruptShortParagraphRun(paragraphs),
  };
}

function scoreHandTouchControl(raw: WebnovelStyleRawMetrics, text: string): DimensionScore {
  let s = 10;
  s -= Math.min(4, raw.handFrequency / 8);
  s -= Math.min(2.5, raw.touchShare * 5);
  s -= Math.min(2, raw.gestureRepeatScore / 15);
  s -= Math.min(1.5, raw.beatSameBodyPartRepeat / 4);
  const evidence =
    raw.handFrequency >= 20
      ? snippetAround(text, /손[^.\n]{0,40}/)
      : raw.touchShare > 0.55
        ? snippetAround(text, /(손끝|피부|온기|촉)/)
        : "hand/touch density within typical band";
  return {
    dimension: "handTouchControl",
    score: clampScore(s),
    rationale: `hand=${raw.handFrequency}, touchShare=${raw.touchShare.toFixed(2)}, gesture=${raw.gestureRepeatScore}, beatRepeat=${raw.beatSameBodyPartRepeat}`,
    evidenceSnippet: evidence,
  };
}

function scoreDialogueRhythm(raw: WebnovelStyleRawMetrics, text: string): DimensionScore {
  let s = 6 + raw.alternationScore * 3;
  s -= Math.min(3, Math.max(0, raw.maxConsecutiveNarrationBlocks - 4) * 0.6);
  s -= Math.min(2, Math.max(0, raw.maxConsecutiveDialogueBlocks - 3) * 0.5);
  if (raw.dialogueBlockCount === 0) s -= 3;
  const evidence =
    raw.maxConsecutiveNarrationBlocks >= 5
      ? `연속 지문 ${raw.maxConsecutiveNarrationBlocks}블록 — ${snippetAround(text, /[^"]{40,120}\./)}`
      : raw.alternationScore >= 0.45
        ? `alternation=${raw.alternationScore.toFixed(2)}, dlgBlocks=${raw.dialogueBlockCount}`
        : snippetAround(text, /"[^"]{4,40}"/);
  return {
    dimension: "dialogueRhythm",
    score: clampScore(s),
    rationale: `alternation=${raw.alternationScore.toFixed(2)}, maxNar=${raw.maxConsecutiveNarrationBlocks}, maxDlg=${raw.maxConsecutiveDialogueBlocks}`,
    evidenceSnippet: evidence,
  };
}

function scoreDialogueNarrationRatio(raw: WebnovelStyleRawMetrics, text: string): DimensionScore {
  const share = raw.dialogueCharShare;
  const ideal = 0.22;
  const dist = Math.abs(share - ideal);
  let s = 10 - dist * 18;
  if (share < 0.08) s -= 2;
  if (share > 0.45) s -= 1.5;
  const evidence =
    share < 0.1
      ? `대사 비율 ${(share * 100).toFixed(0)}% — ${snippetAround(text, /[^"]{60,140}\./)}`
      : share > 0.4
        ? snippetAround(text, /"[^"]+"/)
        : `dialogueCharShare=${(share * 100).toFixed(1)}%`;
  return {
    dimension: "dialogueNarrationRatio",
    score: clampScore(s),
    rationale: `dialogueCharShare=${(share * 100).toFixed(1)}% (blocks ${raw.dialogueBlockCount}/${raw.narrationBlockCount})`,
    evidenceSnippet: evidence,
  };
}

function scoreEmotionBeatDiversity(raw: WebnovelStyleRawMetrics, text: string): DimensionScore {
  let s = 5 + raw.emotionChannelCount * 0.7;
  s -= Math.min(3, raw.emotionLabelCount * 0.35);
  s -= Math.min(2, raw.emotionBeatRepeatScore * 0.8);
  if (raw.emotionChannelCount >= 5) s += 1;
  const evidence =
    raw.emotionLabelCount >= 4
      ? snippetAround(text, /(슬프|화가|불안|긴장|설레|공포|당황)/)
      : raw.emotionChannelCount <= 2
        ? `channels=${raw.emotionChannelCount} only — ${snippetAround(text, /(시선|호흡|손)/)}`
        : `labels=${raw.emotionLabelCount}, channels=${raw.emotionChannelCount}`;
  return {
    dimension: "emotionBeatDiversity",
    score: clampScore(s),
    rationale: `emotionLabels=${raw.emotionLabelCount}, channels=${raw.emotionChannelCount}, beatRepeat=${raw.emotionBeatRepeatScore}`,
    evidenceSnippet: evidence,
  };
}

function scoreNarrativeFlow(raw: WebnovelStyleRawMetrics, text: string): DimensionScore {
  let s = 7;
  s -= Math.min(3, Math.max(0, raw.maxConsecutiveSameStart - 2) * 0.8);
  s -= Math.min(2, raw.similarLengthRunCount * 0.35);
  s += Math.min(2, raw.lengthStdDev / 25);
  s -= Math.min(2, raw.connectorSpamScore / 6);
  const evidence =
    raw.maxConsecutiveSameStart >= 4
      ? snippetAround(text, /^[^\n]{0,30}/)
      : raw.similarLengthRunCount >= 3
        ? `similarLengthRuns=${raw.similarLengthRunCount}`
        : `startUnique=${raw.startTokenUniqueRatio.toFixed(2)}, lenStdDev=${raw.lengthStdDev}`;
  return {
    dimension: "narrativeFlow",
    score: clampScore(s),
    rationale: `sameStart=${raw.maxConsecutiveSameStart}, lenRuns=${raw.similarLengthRunCount}, lenStdDev=${raw.lengthStdDev}, connectors=${raw.connectorSpamScore}`,
    evidenceSnippet: evidence,
  };
}

function scorePovOpeningDiversity(raw: WebnovelStyleRawMetrics, text: string): DimensionScore {
  let s = 6 + raw.paragraphStartUniqueRatio * 3;
  s -= Math.min(3, raw.povNameStartShare * 4);
  s -= Math.min(2, raw.povPronounStartShare * 3);
  s += Math.min(1.5, raw.startTokenUniqueRatio * 1.5);
  const evidence =
    raw.povNameStartShare > 0.45
      ? snippetAround(text, /[가-힣]{2,4}(은|는|이) [^.\n]{20,80}/)
      : raw.povPronounStartShare > 0.35
        ? snippetAround(text, /^(그|그녀)/)
        : `paraStartUnique=${raw.paragraphStartUniqueRatio.toFixed(2)}`;
  return {
    dimension: "povOpeningDiversity",
    score: clampScore(s),
    rationale: `nameStart=${(raw.povNameStartShare * 100).toFixed(0)}%, pronounStart=${(raw.povPronounStartShare * 100).toFixed(0)}%, paraUnique=${raw.paragraphStartUniqueRatio.toFixed(2)}`,
    evidenceSnippet: evidence,
  };
}

function scoreSceneTransitionRhythm(raw: WebnovelStyleRawMetrics, text: string): DimensionScore {
  let s = 6;
  s += Math.min(2, raw.transitionMarkerUnique * 0.45);
  s -= Math.min(2, Math.max(0, raw.transitionMarkerCount - 6) * 0.25);
  s -= Math.min(2.5, raw.abruptShortParagraphRun * 0.6);
  const charK = stripArtifacts(text).length / 1000;
  if (charK > 2.5 && raw.transitionMarkerUnique < 2) s -= 1.5;
  const evidence =
    raw.abruptShortParagraphRun >= 2
      ? `단문 단락 연속 ${raw.abruptShortParagraphRun}회`
      : raw.transitionMarkerUnique >= 3
        ? `transition markers=${raw.transitionMarkerUnique} (${raw.transitionMarkerCount})`
        : snippetAround(text, /(한편|잠시|그때|문득)/);
  return {
    dimension: "sceneTransitionRhythm",
    score: clampScore(s),
    rationale: `transUnique=${raw.transitionMarkerUnique}, transCount=${raw.transitionMarkerCount}, shortParaRuns=${raw.abruptShortParagraphRun}`,
    evidenceSnippet: evidence,
  };
}

export function auditWebnovelStyleText(
  text: string,
  meta: { messageId: number; chatId: number }
): WebnovelStyleAuditResult {
  const raw = computeRawMetrics(text);
  const dimensionScores: DimensionScore[] = [
    scoreHandTouchControl(raw, text),
    scoreDialogueRhythm(raw, text),
    scoreDialogueNarrationRatio(raw, text),
    scoreEmotionBeatDiversity(raw, text),
    scoreNarrativeFlow(raw, text),
    scorePovOpeningDiversity(raw, text),
    scoreSceneTransitionRhythm(raw, text),
  ];
  const overallScore =
    Math.round((dimensionScores.reduce((s, d) => s + d.score, 0) / dimensionScores.length) * 10) / 10;
  return {
    messageId: meta.messageId,
    chatId: meta.chatId,
    charCount: stripArtifacts(text).length,
    raw,
    dimensionScores,
    overallScore,
  };
}

export type CorpusSummary = {
  sampleCount: number;
  dimensionMeans: Record<WebnovelStyleDimension, number>;
  dimensionWorstSamples: Record<
    WebnovelStyleDimension,
    { messageId: number; score: number; evidenceSnippet: string; rationale: string }
  >;
  bottlenecks: {
    dimension: WebnovelStyleDimension;
    labelKo: string;
    meanScore: number;
    gapFromBest: number;
    impactScore: number;
    whyBottleneck: string;
  }[];
};

export function summarizeCorpus(results: WebnovelStyleAuditResult[]): CorpusSummary {
  const dimensionMeans = {} as Record<WebnovelStyleDimension, number>;
  const dimensionWorstSamples = {} as CorpusSummary["dimensionWorstSamples"];

  for (const dim of WEBNOVEL_STYLE_DIMENSIONS) {
    const scores = results.map(
      (r) => r.dimensionScores.find((d) => d.dimension === dim.id)!
    );
    const mean = scores.reduce((s, d) => s + d.score, 0) / (scores.length || 1);
    dimensionMeans[dim.id] = Math.round(mean * 10) / 10;
    const worst = scores.reduce((a, b) => (a.score <= b.score ? a : b));
    dimensionWorstSamples[dim.id] = {
      messageId: results.find((r) =>
        r.dimensionScores.some((d) => d.dimension === dim.id && d.score === worst.score)
      )!.messageId,
      score: worst.score,
      evidenceSnippet: worst.evidenceSnippet,
      rationale: worst.rationale,
    };
  }

  const sorted = [...WEBNOVEL_STYLE_DIMENSIONS].map((dim) => ({
    dim,
    mean: dimensionMeans[dim.id],
  }));
  sorted.sort((a, b) => a.mean - b.mean);
  const bestMean = sorted[sorted.length - 1]!.mean;

  const perceivedWeight: Partial<Record<WebnovelStyleDimension, number>> = {
    narrativeFlow: 1.15,
    dialogueRhythm: 1.12,
    emotionBeatDiversity: 1.1,
    povOpeningDiversity: 1.08,
    dialogueNarrationRatio: 1.05,
    sceneTransitionRhythm: 1.0,
    handTouchControl: 0.95,
  };

  const bottlenecks = sorted.slice(0, 3).map(({ dim, mean }) => {
    const gap = bestMean - mean;
    const weight = perceivedWeight[dim.id] ?? 1;
    const impactScore = Math.round((10 - mean) * weight * 10) / 10;
    const whyMap: Record<WebnovelStyleDimension, string> = {
      handTouchControl: "손·촉각 anchor 과밀 시 문체가 단조롭고 Step 1 hand/touch 이슈와 직결",
      dialogueRhythm: "지문·대사 교차 리듬이 깨지면 웹소설 티키타카 체감이 급락",
      dialogueNarrationRatio: "대사 비율 이탈 시 읽기 밀도·몰입 균형이 무너짐",
      emotionBeatDiversity: "감정 라벨·채널 반복 시 show-don't-tell 품질 저하",
      narrativeFlow: "문장 시작·길이 패턴 반복은 전체 prose 품질 체감에 가장 크게 영향",
      povOpeningDiversity: "그/그녀·이름 시작 반복은 단조로운 카메라 시점으로 읽힘",
      sceneTransitionRhythm: "장면 전환·호흡 부재 시 장편 turn이 flat하게 느껴짐",
    };
    return {
      dimension: dim.id,
      labelKo: dim.labelKo,
      meanScore: mean,
      gapFromBest: Math.round(gap * 10) / 10,
      impactScore,
      whyBottleneck: whyMap[dim.id],
    };
  });

  bottlenecks.sort((a, b) => b.impactScore - a.impactScore);

  return {
    sampleCount: results.length,
    dimensionMeans,
    dimensionWorstSamples,
    bottlenecks: bottlenecks.slice(0, 3),
  };
}
