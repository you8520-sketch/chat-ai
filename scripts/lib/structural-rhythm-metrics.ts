/**
 * Structural rhythm analysis — no content nouns, no lexicon anchors.
 * Measures mechanisms M01–M10 on production text.
 */
import { analyzeDialogueRhythm } from "./dialogue-rhythm-metrics";
import { analyzeProseVariation } from "./prose-variation-metrics";

export type StructuralRhythmMetrics = {
  charCount: number;
  /** M01/M02: sentence length distribution */
  shortRatio: number;
  midRatio: number;
  longRatio: number;
  lengthStdDev: number;
  /** sentence length: first third vs last third of turn */
  lengthFrontHeavy: number;
  lengthEndCompress: boolean;
  /** M03: withhold proxy — contrast sentences (A but B, not X, instead Y) without nouns */
  contrastSentenceCount: number;
  questionCount: number;
  /** M04: direct emotion in quotes vs narration (label-free: quoted vs not) */
  quotedSentenceRatio: number;
  emotionLabelInNarration: number;
  /** M05/M06: paragraph structure */
  paragraphCount: number;
  singleLineParagraphRatio: number;
  alternationScore: number;
  maxConsecutiveNarration: number;
  /** M07: turn thirds — paragraph density shift */
  paraDensityFirstThird: number;
  paraDensityLastThird: number;
  /** M08–M10: mode inference */
  inferredMode: "calm" | "tension" | "combat" | "mixed";
  hookAtEnd: boolean;
};

const EMOTION_LABEL_RE = /슬프|화가|불안|긴장|설레|공포|당황|기쁨|분노|외로/;
const CONTRAST_RE = /(지만|그러나|않았|아니|대신|말을)/;

function stripArtifacts(text: string): string {
  const i = text.search(/<<<STATUS/i);
  return (i >= 0 ? text.slice(0, i) : text).replace(/\[태그:[^\]]+\]/g, "").trim();
}

function sentenceLengths(text: string): number[] {
  return stripArtifacts(text)
    .replace(/"[^"]*"/g, "「」")
    .split(/(?<=[.?!…])\s+|\n+/)
    .map((s) => s.replace(/「」/g, "").trim().length)
    .filter((l) => l > 0);
}

function band(len: number): "short" | "mid" | "long" {
  if (len <= 18) return "short";
  if (len <= 45) return "mid";
  return "long";
}

function isDialogueParagraph(p: string): boolean {
  return /^["「]/.test(p.trim()) || (p.match(/"[^"]+"/g)?.join("").length ?? 0) / p.length >= 0.45;
}

export function analyzeStructuralRhythm(text: string): StructuralRhythmMetrics {
  const body = stripArtifacts(text);
  const lengths = sentenceLengths(body);
  const total = lengths.length || 1;

  const short = lengths.filter((l) => band(l) === "short").length;
  const mid = lengths.filter((l) => band(l) === "mid").length;
  const long = lengths.filter((l) => band(l) === "long").length;

  const third = Math.max(1, Math.floor(total / 3));
  const front = lengths.slice(0, third);
  const back = lengths.slice(-third);
  const frontMean = front.reduce((a, b) => a + b, 0) / (front.length || 1);
  const backMean = back.reduce((a, b) => a + b, 0) / (back.length || 1);

  const paras = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const singleLine = paras.filter((p) => p.replace(/"[^"]*"/g, "").length <= 22).length;

  const prose = analyzeProseVariation(body);
  const rhythm = analyzeDialogueRhythm(body);

  const narBlocks = paras.map(isDialogueParagraph);
  const firstThirdEnd = Math.floor(paras.length / 3);
  const lastThirdStart = Math.floor((paras.length * 2) / 3);
  const paraFirst = paras.slice(0, firstThirdEnd || 1).length;
  const paraLast = paras.slice(lastThirdStart).length;

  const shortDominant = short / total > 0.45;
  const longDominant = long / total < 0.15;
  let inferredMode: StructuralRhythmMetrics["inferredMode"] = "mixed";
  if (shortDominant && rhythm.maxConsecutiveNarrationBlocks <= 2) inferredMode = "combat";
  else if (shortDominant || rhythm.maxConsecutiveNarrationBlocks <= 3) inferredMode = "tension";
  else if (long / total > 0.2 && rhythm.alternationScore < 0.4) inferredMode = "calm";

  const lastPara = paras[paras.length - 1] ?? "";
  const hookAtEnd = /[?？…]["」]?$/.test(lastPara) || /^["「][^"]*[?？…]/.test(lastPara);

  const narrOnly = paras.filter((p) => !isDialogueParagraph(p)).join("\n");
  const emotionLabelInNarration = narrOnly.match(new RegExp(EMOTION_LABEL_RE, "g"))?.length ?? 0;

  return {
    charCount: body.length,
    shortRatio: Math.round((short / total) * 1000) / 1000,
    midRatio: Math.round((mid / total) * 1000) / 1000,
    longRatio: Math.round((long / total) * 1000) / 1000,
    lengthStdDev: prose.lengthStdDev,
    lengthFrontHeavy: Math.round((frontMean / (backMean || 1)) * 100) / 100,
    lengthEndCompress: backMean < frontMean * 0.85,
    contrastSentenceCount: (body.match(new RegExp(CONTRAST_RE, "g")) ?? []).length,
    questionCount: body.match(/\?/g)?.length ?? 0,
    quotedSentenceRatio: Math.round(rhythm.dialogueCharShare * 1000) / 1000,
    emotionLabelInNarration,
    paragraphCount: paras.length,
    singleLineParagraphRatio: Math.round((singleLine / (paras.length || 1)) * 1000) / 1000,
    alternationScore: rhythm.alternationScore,
    maxConsecutiveNarration: rhythm.maxConsecutiveNarrationBlocks,
    paraDensityFirstThird: paraFirst,
    paraDensityLastThird: paraLast,
    inferredMode,
    hookAtEnd,
  };
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function aggregateStructural(samples: StructuralRhythmMetrics[]) {
  const n = samples.length || 1;
  const r = (fn: (m: StructuralRhythmMetrics) => number) =>
    Math.round(mean(samples.map(fn)) * 1000) / 1000;

  const modes = { calm: 0, tension: 0, combat: 0, mixed: 0 };
  for (const s of samples) modes[s.inferredMode]++;

  return {
    sampleCount: samples.length,
    shortRatio: r((m) => m.shortRatio),
    midRatio: r((m) => m.midRatio),
    longRatio: r((m) => m.longRatio),
    lengthStdDev: r((m) => m.lengthStdDev),
    lengthEndCompressRate: r((m) => (m.lengthEndCompress ? 1 : 0)),
    lengthFrontHeavyMean: r((m) => m.lengthFrontHeavy),
    contrastPerTurn: r((m) => m.contrastSentenceCount),
    questionPerTurn: r((m) => m.questionCount),
    alternation: r((m) => m.alternationScore),
    maxConsecutiveNarration: r((m) => m.maxConsecutiveNarration),
    singleLineParaRatio: r((m) => m.singleLineParagraphRatio),
    hookAtEndRate: r((m) => (m.hookAtEnd ? 1 : 0)),
    emotionLabelInNarration: r((m) => m.emotionLabelInNarration),
    modeDistribution: modes,
  };
}
