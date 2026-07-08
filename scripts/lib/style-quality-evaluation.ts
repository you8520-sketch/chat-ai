/**
 * Step 4.1 — Style quality evaluation (human-proxy first).
 * Primary A/B criteria: readable webnovel prose quality — NOT structural adherence or hand-only metrics.
 */

import {
  auditWebnovelStyleText,
  type WebnovelStyleAuditResult,
  type WebnovelStyleDimension,
} from "./webnovel-style-audit";

export type StyleQualityCriterion =
  | "humanProxyOverall"
  | "webnovelLikeness"
  | "sentenceRhythm"
  | "immersion"
  | "repetition"
  | "infoDensity"
  | "handTouch";

export type StyleQualityCriterionMeta = {
  id: StyleQualityCriterion;
  label: string;
  labelKo: string;
  /** Used for production rollout gate */
  primary: boolean;
  higherIsBetter: boolean;
};

export const STYLE_QUALITY_CRITERIA: StyleQualityCriterionMeta[] = [
  {
    id: "humanProxyOverall",
    label: "Human proxy (overall)",
    labelKo: "사람 평가 프록시 (종합)",
    primary: true,
    higherIsBetter: true,
  },
  {
    id: "webnovelLikeness",
    label: "Webnovel likeness",
    labelKo: "웹소설스러움",
    primary: true,
    higherIsBetter: true,
  },
  {
    id: "sentenceRhythm",
    label: "Sentence rhythm",
    labelKo: "문장 리듬",
    primary: true,
    higherIsBetter: true,
  },
  {
    id: "immersion",
    label: "Immersion",
    labelKo: "몰입감",
    primary: true,
    higherIsBetter: true,
  },
  {
    id: "repetition",
    label: "Repetition control",
    labelKo: "반복 억제",
    primary: true,
    higherIsBetter: true,
  },
  {
    id: "infoDensity",
    label: "Information density",
    labelKo: "정보 밀도",
    primary: true,
    higherIsBetter: true,
  },
  {
    id: "handTouch",
    label: "hand/touch (secondary)",
    labelKo: "hand/touch (부차)",
    primary: false,
    higherIsBetter: true,
  },
];

export type StyleQualityScores = Record<StyleQualityCriterion, number>;

export type StyleQualityResult = {
  charCount: number;
  audit: WebnovelStyleAuditResult;
  scores: StyleQualityScores;
  /** Side-channel only — not used for Step 4.1 gate */
  sideMetrics: {
    gestureRepeatScore: number;
    touchShare: number;
    hookEllipsisCount: number;
  };
};

function dimScore(audit: WebnovelStyleAuditResult, id: WebnovelStyleDimension): number {
  return audit.dimensionScores.find((d) => d.dimension === id)?.score ?? 0;
}

function clamp(n: number): number {
  return Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;
}

function scoreRepetition(audit: WebnovelStyleAuditResult): number {
  const raw = audit.raw;
  let s = 8.5;
  s -= Math.min(2.5, raw.gestureRepeatScore / 12);
  s -= Math.min(2, raw.emotionBeatRepeatScore * 0.7);
  s -= Math.min(2, Math.max(0, raw.maxConsecutiveSameStart - 2) * 0.7);
  s -= Math.min(1.5, raw.similarLengthRunCount * 0.35);
  s -= Math.min(1, raw.connectorSpamScore / 8);
  return clamp(s);
}

/** Balanced reveal pacing — not narration wall, not dialogue-only stub */
function scoreInfoDensity(audit: WebnovelStyleAuditResult): number {
  const raw = audit.raw;
  const share = raw.dialogueCharShare;
  const ideal = 0.22;
  let s = 10 - Math.abs(share - ideal) * 16;
  s -= Math.min(3, Math.max(0, raw.maxConsecutiveNarrationBlocks - 4) * 0.55);
  if (share < 0.06) s -= 2;
  if (raw.emotionLabelCount >= 5) s -= 1.5;
  s += Math.min(1.2, raw.lengthStdDev / 30);
  if (audit.charCount < 1800) s -= 1.5;
  return clamp(s);
}

function scoreWebnovelLikeness(audit: WebnovelStyleAuditResult): number {
  const flow = dimScore(audit, "narrativeFlow");
  const rhythm = dimScore(audit, "dialogueRhythm");
  const transition = dimScore(audit, "sceneTransitionRhythm");
  const ratio = dimScore(audit, "dialogueNarrationRatio");
  return clamp(flow * 0.32 + rhythm * 0.28 + transition * 0.22 + ratio * 0.18);
}

function scoreSentenceRhythm(audit: WebnovelStyleAuditResult): number {
  const flow = dimScore(audit, "narrativeFlow");
  const rhythm = dimScore(audit, "dialogueRhythm");
  const pov = dimScore(audit, "povOpeningDiversity");
  return clamp(flow * 0.45 + rhythm * 0.4 + pov * 0.15);
}

function scoreImmersion(audit: WebnovelStyleAuditResult): number {
  const transition = dimScore(audit, "sceneTransitionRhythm");
  const emotion = dimScore(audit, "emotionBeatDiversity");
  const info = scoreInfoDensity(audit);
  return clamp(transition * 0.35 + emotion * 0.35 + info * 0.3);
}

function scoreHumanProxyOverall(scores: Omit<StyleQualityScores, "humanProxyOverall">): number {
  return clamp(
    scores.webnovelLikeness * 0.22 +
      scores.sentenceRhythm * 0.22 +
      scores.immersion * 0.2 +
      scores.infoDensity * 0.16 +
      scores.repetition * 0.14 +
      scores.handTouch * 0.06
  );
}

function countHookEllipsis(text: string): number {
  const body = text.replace(/<<<STATUS[\s\S]*/i, "");
  return (body.match(/\?|\.{3}/g) ?? []).length;
}

export function evaluateStyleQuality(text: string): StyleQualityResult {
  const audit = auditWebnovelStyleText(text, { messageId: 0, chatId: 0 });
  const repetition = scoreRepetition(audit);
  const infoDensity = scoreInfoDensity(audit);
  const webnovelLikeness = scoreWebnovelLikeness(audit);
  const sentenceRhythm = scoreSentenceRhythm(audit);
  const immersion = scoreImmersion(audit);
  const handTouch = dimScore(audit, "handTouchControl");

  const partial = {
    webnovelLikeness,
    sentenceRhythm,
    immersion,
    repetition,
    infoDensity,
    handTouch,
  };

  const scores: StyleQualityScores = {
    ...partial,
    humanProxyOverall: scoreHumanProxyOverall(partial),
  };

  return {
    charCount: audit.charCount,
    audit,
    scores,
    sideMetrics: {
      gestureRepeatScore: audit.raw.gestureRepeatScore,
      touchShare: audit.raw.touchShare,
      hookEllipsisCount: countHookEllipsis(text),
    },
  };
}

/** Step 4.1 screening — 4 metrics only */
export const SCREENING_STYLE_CRITERIA: StyleQualityCriterion[] = [
  "humanProxyOverall",
  "webnovelLikeness",
  "immersion",
  "sentenceRhythm",
];

/** Full validation reports all primary dimensions; gate still uses screening set */
export const PRIMARY_STYLE_CRITERIA = STYLE_QUALITY_CRITERIA.filter((c) => c.primary).map(
  (c) => c.id
);

export const FULL_REPORT_CRITERIA: StyleQualityCriterion[] = [
  ...SCREENING_STYLE_CRITERIA,
  "repetition",
  "infoDensity",
];
