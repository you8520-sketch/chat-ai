/**
 * Style DNA extraction — observable patterns, not abstract rules.
 */

import { analyzeDialogueRhythm } from "./dialogue-rhythm-metrics";
import { analyzeProseVariation } from "./prose-variation-metrics";
import { analyzeHandTouchAudit } from "./hand-touch-audit-metrics";

export type SentenceLengthBand = "short" | "mid" | "long";

export type StyleDnaMetrics = {
  sampleId: string;
  charCount: number;
  /** sentence length */
  sentenceCount: number;
  lengthStdDev: number;
  shortRatio: number;
  midRatio: number;
  longRatio: number;
  lengthRunMax: number;
  /** info reveal */
  withholdMarkers: number;
  factsPer500Chars: number;
  unansweredQuestions: number;
  /** emotion */
  emotionLabelCount: number;
  channelCount: number;
  channelTransitions: number;
  /** tension */
  singleLineParagraphRatio: number;
  maxConsecutiveNarration: number;
  /** whitespace */
  emptyBeatLines: number;
  ellipsisCount: number;
  /** dialogue rhythm */
  dialogueCharShare: number;
  alternationScore: number;
  meanQuoteChars: number;
  quoteCount: number;
  /** hook */
  hookEndingCount: number;
  /** hand (contrast metric) */
  handFrequency: number;
};

export type AggregatedStyleDna = {
  sampleCount: number;
  sentenceLength: {
    stdDevMean: number;
    shortRatioMean: number;
    midRatioMean: number;
    longRatioMean: number;
    targetMix: string;
  };
  infoReveal: {
    withholdPerTurnMean: number;
    factsPer500Mean: number;
    unansweredQMean: number;
    pattern: string;
  };
  emotionTransition: {
    channelCountMean: number;
    transitionsMean: number;
    labelCountMean: number;
    pattern: string;
  };
  tension: {
    singleLineParaRatioMean: number;
    maxNarMean: number;
    pattern: string;
  };
  whitespace: {
    emptyBeatMean: number;
    ellipsisMean: number;
    pattern: string;
  };
  dialogueRhythm: {
    charShareMean: number;
    alternationMean: number;
    meanQuoteCharsMean: number;
    quotesPerTurnMean: number;
    pattern: string;
  };
  hookRhythm: {
    hooksPerTurnMean: number;
    pattern: string;
  };
  handFrequencyMean: number;
};

const EMOTION_LABELS = ["슬프", "화가", "불안", "긴장", "설레", "공포", "당황", "기쁨"];
const CHANNELS: { id: string; re: RegExp }[] = [
  { id: "sound", re: /소리|울|침묵|메아리|속삭/g },
  { id: "sight", re: /시선|빛|그림자|어둠|불/g },
  { id: "space", re: /거리|공기|복도|문|창/g },
  { id: "breath", re: /호흡|숨|숨결/g },
  { id: "hand", re: /손|손끝|손가락/g },
  { id: "posture", re: /고개|어깨|몸/g },
];

const WITHHOLD_RE =
  /말하지|말을 중간|대신|숨기|티 내지|거짓말|…{2,}|——|——/g;
const FACT_RE =
  /(였다|했다|였다\.|보였|들렸|남았|갔다|닫혔|떨어졌|스쳤|울렸|번졌)/g;

function stripArtifacts(text: string): string {
  return text.replace(/\[태그:[^\]]+\]/g, "").trim();
}

function splitSentences(text: string): string[] {
  const body = stripArtifacts(text).replace(/"[^"]*"/g, "「」");
  return body
    .split(/(?<=[.?!…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function band(len: number): SentenceLengthBand {
  if (len <= 18) return "short";
  if (len <= 45) return "mid";
  return "long";
}

function maxLengthRun(sentences: string[]): number {
  let best = 1;
  let run = 1;
  for (let i = 1; i < sentences.length; i++) {
    if (band(sentences[i]!.length) === band(sentences[i - 1]!.length)) {
      run++;
      best = Math.max(best, run);
    } else run = 1;
  }
  return best;
}

function channelSequence(text: string): string[] {
  const seq: string[] = [];
  for (const para of text.split(/\n+/)) {
    for (const ch of CHANNELS) {
      if (ch.re.test(para)) {
        seq.push(ch.id);
        break;
      }
    }
  }
  return seq;
}

function countTransitions(seq: string[]): number {
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] !== seq[i - 1]) n++;
  }
  return n;
}

function countFacts(text: string): number {
  return text.match(FACT_RE)?.length ?? 0;
}

function hookEndings(text: string): number {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  let n = 0;
  for (const p of paras) {
    if (/[?？…]["」]?$/.test(p)) n++;
    if (/^"[^"]*[?？…]"$/.test(p)) n++;
    if (/결정해|들어와|사실은|누구야|왜 그래/.test(p)) n++;
  }
  return n;
}

export function extractStyleDnaMetrics(sampleId: string, text: string): StyleDnaMetrics {
  const body = stripArtifacts(text);
  const sentences = splitSentences(body);
  const lengths = sentences.map((s) => s.replace(/「」/g, "").length);
  const prose = analyzeProseVariation(body);
  const rhythm = analyzeDialogueRhythm(body);
  const hand = analyzeHandTouchAudit(body);
  const quotes = body.match(/"[^"]+"/g) ?? [];

  const short = lengths.filter((l) => band(l) === "short").length;
  const mid = lengths.filter((l) => band(l) === "mid").length;
  const long = lengths.filter((l) => band(l) === "long").length;
  const total = lengths.length || 1;

  const paras = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const singleLine = paras.filter((p) => {
    const proseLen = p.replace(/"[^"]*"/g, "").length;
    return proseLen > 0 && proseLen < 22;
  }).length;

  const chSeq = channelSequence(body);
  let emotionLabels = 0;
  for (const lab of EMOTION_LABELS) {
    emotionLabels += body.match(new RegExp(lab, "g"))?.length ?? 0;
  }

  const unanswered = (body.match(/\?/g) ?? []).length;

  return {
    sampleId,
    charCount: body.length,
    sentenceCount: sentences.length,
    lengthStdDev: prose.lengthStdDev,
    shortRatio: Math.round((short / total) * 1000) / 1000,
    midRatio: Math.round((mid / total) * 1000) / 1000,
    longRatio: Math.round((long / total) * 1000) / 1000,
    lengthRunMax: maxLengthRun(sentences),
    withholdMarkers: body.match(WITHHOLD_RE)?.length ?? 0,
    factsPer500Chars: Math.round((countFacts(body) / (body.length / 500)) * 100) / 100,
    unansweredQuestions: unanswered,
    emotionLabelCount: emotionLabels,
    channelCount: new Set(chSeq).size,
    channelTransitions: countTransitions(chSeq),
    singleLineParagraphRatio: Math.round((singleLine / (paras.length || 1)) * 1000) / 1000,
    maxConsecutiveNarration: rhythm.maxConsecutiveNarrationBlocks,
    emptyBeatLines: paras.filter((p) => p.length <= 8 && !/^"/.test(p)).length,
    ellipsisCount: body.match(/\.\.\.|…/g)?.length ?? 0,
    dialogueCharShare: Math.round(rhythm.dialogueCharShare * 1000) / 1000,
    alternationScore: Math.round(rhythm.alternationScore * 1000) / 1000,
    meanQuoteChars:
      quotes.length > 0
        ? Math.round(quotes.reduce((s, q) => s + q.length, 0) / quotes.length)
        : 0,
    quoteCount: quotes.length,
    hookEndingCount: hookEndings(body),
    handFrequency: hand.handFrequency,
  };
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function aggregateStyleDna(metrics: StyleDnaMetrics[]): AggregatedStyleDna {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    sampleCount: metrics.length,
    sentenceLength: {
      stdDevMean: r(mean(metrics.map((m) => m.lengthStdDev))),
      shortRatioMean: r(mean(metrics.map((m) => m.shortRatio))),
      midRatioMean: r(mean(metrics.map((m) => m.midRatio))),
      longRatioMean: r(mean(metrics.map((m) => m.longRatio))),
      targetMix: "short 35–45% · mid 40–50% · long 10–20% · stdDev ≥14",
    },
    infoReveal: {
      withholdPerTurnMean: r(mean(metrics.map((m) => m.withholdMarkers))),
      factsPer500Mean: r(mean(metrics.map((m) => m.factsPer500Chars))),
      unansweredQMean: r(mean(metrics.map((m) => m.unansweredQuestions))),
      pattern: "beat마다 사실 1개 → withhold(말 중단·대신·… ) → 질문으로 넘김",
    },
    emotionTransition: {
      channelCountMean: r(mean(metrics.map((m) => m.channelCount))),
      transitionsMean: r(mean(metrics.map((m) => m.channelTransitions))),
      labelCountMean: r(mean(metrics.map((m) => m.emotionLabelCount))),
      pattern: "감정 라벨 0 — 소리→시선→공간 채널 교체",
    },
    tension: {
      singleLineParaRatioMean: r(mean(metrics.map((m) => m.singleLineParagraphRatio))),
      maxNarMean: r(mean(metrics.map((m) => m.maxConsecutiveNarration))),
      pattern: "긴장↑: 1문장 단락 연속 · max consecutive narration ≤3",
    },
    whitespace: {
      emptyBeatMean: r(mean(metrics.map((m) => m.emptyBeatLines))),
      ellipsisMean: r(mean(metrics.map((m) => m.ellipsisCount))),
      pattern: "단독 짧은 단락·… 로 박자 늦춤 — 지문 6연속 금지",
    },
    dialogueRhythm: {
      charShareMean: r(mean(metrics.map((m) => m.dialogueCharShare))),
      alternationMean: r(mean(metrics.map((m) => m.alternationScore))),
      meanQuoteCharsMean: r(mean(metrics.map((m) => m.meanQuoteChars))),
      quotesPerTurnMean: r(mean(metrics.map((m) => m.quoteCount))),
      pattern: "지문1–2 → \"대사8–22자\" → 지문1 → \"대사\" · share 18–35%",
    },
    hookRhythm: {
      hooksPerTurnMean: r(mean(metrics.map((m) => m.hookEndingCount))),
      pattern: "turn/micro-beat 끝: ? · … · 미완 대사 · \"사실은?\"",
    },
    handFrequencyMean: r(mean(metrics.map((m) => m.handFrequency))),
  };
}

/** Production Step 2 audit baseline for gap display */
export const PRODUCTION_STYLE_DNA_BASELINE = {
  source: "webnovel-style-production-audit.json (60 samples)",
  dialogueCharShareApprox: 0.12,
  alternationApprox: 0.4,
  maxConsecutiveNarrationApprox: 6.5,
  handFrequencyApprox: 28,
  emotionLabelHeavy: false,
  overallMean: 5.8,
};

export function dnaGapSummary(ref: AggregatedStyleDna): string[] {
  const b = PRODUCTION_STYLE_DNA_BASELINE;
  const lines: string[] = [];
  if (ref.dialogueRhythm.charShareMean < b.dialogueCharShareApprox + 0.05) {
    lines.push(
      `reference dialogueCharShare ${ref.dialogueRhythm.charShareMean} vs production ~${b.dialogueCharShareApprox} — reference가 더 대사 밀집`
    );
  } else {
    lines.push(
      `reference dialogueCharShare ${ref.dialogueRhythm.charShareMean} — production zero-quote/wall 보정 목표`
    );
  }
  lines.push(
    `reference alternation ${ref.dialogueRhythm.alternationMean} vs production ~${b.alternationApprox}`
  );
  lines.push(
    `reference maxNar ${ref.tension.maxNarMean} vs production ~${b.maxConsecutiveNarrationApprox}`
  );
  lines.push(
    `reference handFreq ${ref.handFrequencyMean} vs production ~${b.handFrequencyApprox} (Step 2 bottleneck)`
  );
  return lines;
}
