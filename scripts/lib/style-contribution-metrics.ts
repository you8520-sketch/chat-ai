/**
 * Step 3-1 — unified style contribution metrics (audit harness).
 * Combines hand/touch, prose variation, dialogue rhythm, POV, and webnovel overall score.
 */

import { analyzeHandTouchAudit } from "./hand-touch-audit-metrics";
import { analyzeDialogueRhythm, dialogueRhythmScore } from "./dialogue-rhythm-metrics";
import { analyzeProseVariation } from "./prose-variation-metrics";
import { auditWebnovelStyleText } from "./webnovel-style-audit";

export type StyleContributionMetrics = {
  handFrequency: number;
  touchShare: number;
  gestureRepeatScore: number;
  sentenceStartDiversity: number;
  sentenceStructureDiversity: number;
  povRepetition: number;
  dialogueRhythm: number;
  narrationWall: number;
  overallHumanScore: number;
  charLength: number;
};

export const STYLE_CONTRIBUTION_METRIC_DEFS = [
  { key: "handFrequency" as const, label: "hand frequency", higherIsBetter: false },
  { key: "touchShare" as const, label: "touch share", higherIsBetter: false },
  { key: "gestureRepeatScore" as const, label: "gestureRepeatScore", higherIsBetter: false },
  {
    key: "sentenceStartDiversity" as const,
    label: "sentence start diversity",
    higherIsBetter: true,
  },
  {
    key: "sentenceStructureDiversity" as const,
    label: "sentence structure diversity",
    higherIsBetter: true,
  },
  { key: "povRepetition" as const, label: "POV repetition", higherIsBetter: false },
  { key: "dialogueRhythm" as const, label: "dialogue rhythm", higherIsBetter: true },
  { key: "narrationWall" as const, label: "narration wall", higherIsBetter: false },
  { key: "overallHumanScore" as const, label: "overall human score", higherIsBetter: true },
  { key: "charLength" as const, label: "char length (expansion)", higherIsBetter: true },
] as const;

export type StyleContributionMetricKey = (typeof STYLE_CONTRIBUTION_METRIC_DEFS)[number]["key"];

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

function povNameStartShare(text: string): number {
  const paragraphs = splitParagraphs(text);
  const openings = paragraphs.map((p) => {
    const prose = p.replace(/"[^"]*"/g, "").trim();
    const m = prose.match(/^[\s]*([^\s,.]{1,8})/);
    return m?.[1] ?? prose.slice(0, 4);
  });
  if (openings.length === 0) return 0;
  const nameStarts = openings.filter((o) => /[가-힣]{2,4}(은|는|이|가|의)$/.test(o)).length;
  return nameStarts / openings.length;
}

/** Composite 0–10 — lengthStdDev up, similarLengthRunCount down */
export function sentenceStructureDiversityScore(prose: {
  lengthStdDev: number;
  similarLengthRunCount: number;
}): number {
  const raw = prose.lengthStdDev / 35 + 1 / (1 + prose.similarLengthRunCount);
  return Math.round(Math.min(10, raw * 4) * 100) / 100;
}

export function analyzeStyleContribution(text: string): StyleContributionMetrics {
  const handTouch = analyzeHandTouchAudit(text);
  const prose = analyzeProseVariation(text);
  const rhythm = analyzeDialogueRhythm(text);
  const rhythmScore = dialogueRhythmScore(rhythm);
  const audit = auditWebnovelStyleText(text, { messageId: 0, chatId: 0 });
  const body = stripArtifacts(text);

  return {
    handFrequency: handTouch.handFrequency,
    touchShare: handTouch.touchShare,
    gestureRepeatScore: handTouch.gestureRepeatScore,
    sentenceStartDiversity: prose.startTokenUniqueRatio,
    sentenceStructureDiversity: sentenceStructureDiversityScore(prose),
    povRepetition: povNameStartShare(body),
    dialogueRhythm: rhythmScore,
    narrationWall: rhythm.narrationWall ? 1 : 0,
    overallHumanScore: audit.overallScore,
    charLength: body.length,
  };
}

export function metricValue(m: StyleContributionMetrics, key: StyleContributionMetricKey): number {
  return m[key];
}

/** Positive = layer ON helps (removing layer hurts this metric). */
export function layerContributionDelta(
  onMean: number,
  offMean: number,
  higherIsBetter: boolean
): number {
  const delta = higherIsBetter ? onMean - offMean : offMean - onMean;
  return Math.round(delta * 1000) / 1000;
}
