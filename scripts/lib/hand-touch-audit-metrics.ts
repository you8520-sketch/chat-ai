/** Step 2 EMOTION A — hand/touch repetition metrics (Audit-aligned). */

import { analyzeProseVariation, type ProseVariationMetrics } from "./prose-variation-metrics";

const HAND_LEX = ["손", "손끝", "손가락", "손목", "손바닥", "손잡", "손을", "손이"];
const TOUCH_LEX = ["손", "손끝", "피부", "온기", "냉기", "촉", "접촉", "만지", "잡"];
const SENSORY_LEX = [
  "시선",
  "눈",
  "눈동자",
  "시야",
  "어둠",
  "불빛",
  "그림자",
  "소리",
  "귓",
  "울림",
  "속삭",
  "메아리",
  "침묵",
  "손",
  "손끝",
  "피부",
  "온기",
  "냉기",
  "촉",
  "호흡",
  "숨",
  "숨결",
  "냄새",
  "향",
  "거리",
  "공간",
  "간격",
  "위치",
];

const BODY_PART_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "hand", re: /손|손끝|손가락|손목|손바닥/g },
  { id: "gaze", re: /시선|눈동자|눈을|눈이/g },
  { id: "breath", re: /호흡|숨|숨결/g },
  { id: "shoulder", re: /어깨/g },
  { id: "head", re: /고개/g },
];

export type HandTouchAuditMetrics = {
  gestureRepeatScore: number;
  handFrequency: number;
  touchShare: number;
  beatSameBodyPartRepeat: number;
};

export const HAND_TOUCH_METRIC_DEFS = [
  {
    key: "gestureRepeatScore" as const,
    label: "gestureRepeatScore",
    higherIsBetter: false,
  },
  {
    key: "handFrequency" as const,
    label: "hand frequency",
    higherIsBetter: false,
  },
  {
    key: "touchShare" as const,
    label: "touch share",
    higherIsBetter: false,
  },
  {
    key: "beatSameBodyPartRepeat" as const,
    label: "beat 내부 동일 신체 부위 반복",
    higherIsBetter: false,
  },
] as const;

export type HandTouchMetricKey = (typeof HAND_TOUCH_METRIC_DEFS)[number]["key"];

function stripArtifacts(text: string): string {
  return text
    .replace(/<<<[\s\S]*$/m, "")
    .replace(/\[태그:[^\]]+\]/g, "")
    .trim();
}

function countLex(text: string, words: string[]): number {
  return words.reduce((n, w) => n + (text.match(new RegExp(w, "g"))?.length ?? 0), 0);
}

/** Beat = narration paragraph block (non-dialogue line cluster). */
function splitBeats(text: string): string[] {
  const beats: string[] = [];
  for (const block of stripArtifacts(text).split(/\n+/)) {
    const line = block.trim();
    if (!line) continue;
    if (/^["「『]/.test(line)) continue;
    beats.push(line);
  }
  return beats;
}

function beatSameBodyPartRepeat(text: string): number {
  let excess = 0;
  for (const beat of splitBeats(text)) {
    for (const { re } of BODY_PART_PATTERNS) {
      const hits = beat.match(re);
      if (hits && hits.length >= 2) excess += hits.length - 1;
    }
  }
  return excess;
}

function touchShare(text: string): number {
  const touch = countLex(text, TOUCH_LEX);
  const total = countLex(text, SENSORY_LEX);
  return total > 0 ? Math.round((touch / total) * 10000) / 10000 : 0;
}

function handFrequency(text: string): number {
  return countLex(text, HAND_LEX);
}

export function analyzeHandTouchAudit(text: string): HandTouchAuditMetrics {
  const base = analyzeProseVariation(text);
  return {
    gestureRepeatScore: base.gestureRepeatScore,
    handFrequency: handFrequency(text),
    touchShare: touchShare(text),
    beatSameBodyPartRepeat: beatSameBodyPartRepeat(text),
  };
}

export function handTouchMetricValue(m: HandTouchAuditMetrics, key: HandTouchMetricKey): number {
  return m[key];
}
