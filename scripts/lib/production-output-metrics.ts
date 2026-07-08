/** Extended output metrics for production craft validation. */

import { analyzeProseVariation, type ProseVariationMetrics } from "./prose-variation-metrics";

export type ProductionOutputMetrics = ProseVariationMetrics & {
  charLength: number;
  dialogueLineCount: number;
  narrationLineCount: number;
  dialogueDensity: number;
  handoffOpenScore: number;
  sensoryLexCount: number;
  gestureLexCount: number;
};

const SENSORY_ALL = [
  "시선", "눈", "소리", "귓", "손", "손끝", "피부", "온기", "호흡", "숨", "냄새", "향", "거리", "공간",
];
const GESTURE_ALL = ["시선", "고개", "손", "어깨", "입술", "호흡", "숨", "몸", "미소", "눈썹", "손가락"];

function countLex(text: string, words: string[]): number {
  return words.reduce((n, w) => n + (text.match(new RegExp(w, "g"))?.length ?? 0), 0);
}

function countDialogueLines(text: string): number {
  return text.split("\n").filter((l) => /^["「『].*["」』]?$/.test(l.trim())).length;
}

function countNarrationLines(text: string): number {
  return text.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 0 && !/^["「『]/.test(t);
  }).length;
}

/** 1 = open handoff (ends on dialogue/?/…); 0 = closed narration beat */
function handoffOpenScore(text: string): number {
  const lines = text.trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (/^["「『]/.test(last)) return 1;
  if (/[?…]$/.test(last)) return 1;
  if (/다\.?$/.test(last) && lines.length >= 3) return 0.3;
  return 0.5;
}

export function analyzeProductionOutput(text: string): ProductionOutputMetrics {
  const base = analyzeProseVariation(text);
  const dlg = countDialogueLines(text);
  const nar = countNarrationLines(text);
  const total = dlg + nar || 1;
  return {
    ...base,
    charLength: text.length,
    dialogueLineCount: dlg,
    narrationLineCount: nar,
    dialogueDensity: Math.round((dlg / total) * 1000) / 1000,
    handoffOpenScore: handoffOpenScore(text),
    sensoryLexCount: countLex(text, SENSORY_ALL),
    gestureLexCount: countLex(text, GESTURE_ALL),
  };
}

export const PRODUCTION_METRIC_LABELS: Record<string, { label: string; higherIsBetter: boolean }> = {
  charLength: { label: "scene expansion (chars)", higherIsBetter: true },
  gestureLexCount: { label: "gesture lexicon hits", higherIsBetter: false },
  sensoryLexCount: { label: "sensation lexicon hits", higherIsBetter: false },
  gestureRepeatScore: { label: "gesture repeat score", higherIsBetter: false },
  dominantSensoryShare: { label: "sensory channel concentration", higherIsBetter: false },
  maxConsecutiveSameStart: { label: "sentence rhythm (same-start run)", higherIsBetter: false },
  similarLengthRunCount: { label: "sentence rhythm (length runs)", higherIsBetter: false },
  lengthStdDev: { label: "sentence rhythm (length stddev)", higherIsBetter: true },
  dialogueDensity: { label: "dialogue density", higherIsBetter: false },
  handoffOpenScore: { label: "handoff openness", higherIsBetter: true },
  startTokenUniqueRatio: { label: "sentence start diversity", higherIsBetter: true },
};
