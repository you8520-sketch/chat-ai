/** Step 2 incremental validation — PROSE section line variants. */

import { PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";

/** [MOVEMENT & SPACE] 2번째 줄 — Step 2 baseline (historical). */
export const PROSE_MOVEMENT_LINE1_BASELINE =
  "한 동작마다 무엇이 어디서 어느 방향으로 이동했는지, 그로 인해 공간 관계가 어떻게 바뀌었는지를 포함한다.";

/** [MOVEMENT & SPACE] 2번째 줄 — production (bundle continuous motion; not one-line-per-action). */
export const PROSE_MOVEMENT_LINE1_A =
  "연속된 신체 동작·접촉·감각·반응은 동작마다 독립 문장으로 쪼개지 말고, 하나의 흐름이면 같은 문단에서 자연스럽게 묶는다.";

/** [RHYTHM] 3번째 줄 — Step 2 baseline (production). */
export const PROSE_RHYTHM_LINE2_BASELINE =
  "연속 지문에서 같은 문장 시작형을 반복하지 말고, 다음 문장은 시작점을 바꿔 쓴다.";

/** [RHYTHM] 3번째 줄 — Step 2 candidate A (POV / narrative perspective). */
export const PROSE_RHYTHM_LINE2_A =
  "연속 지문에서 캐릭터명·대명사로만 문장을 이어 가지 말고, 다음 문장은 행동·공간·감각·환경·결과 중 다른 관점에서 시작한다.";

/** [SENSATION] 3번째 줄 — Step 2 baseline (production). */
export const PROSE_SENSATION_LINE2_BASELINE =
  "같은 감각 채널만 연속으로 고정하지 말고, 다음 문장에서는 보조 감각을 바꿔 장면을 전진시킨다.";

/** [SENSATION] 3번째 줄 — Step 2 candidate C (non-touch auxiliary examples). */
export const PROSE_SENSATION_LINE2_C =
  "같은 감각 채널만 연속으로 고정하지 말고, 다음 문장에서는 소리·거리·공기 등 보조 감각으로 바꿔 장면을 전진시킨다.";

/** [SENSATION] 1번째 줄 — Step 2 baseline (production). */
export const PROSE_SENSATION_LINE0_BASELINE =
  "장면에 맞는 감각 채널(시각·청각·촉각·온도·냄새·근육감·공간감) 중 1~2개를 골라 깊게 쓴다.";

/** [SENSATION] 1번째 줄 — Step 2 candidate A (scene-prioritized channel). */
export const PROSE_SENSATION_LINE0_A =
  "장면에 우선인 감각 채널(시각·청각·촉각·온도·냄새·근육감·공간감) 중 1~2개를 골라 깊게 쓴다.";

/** [EMOTION] 4번째 줄 — Step 2 baseline (production). */
export const PROSE_EMOTION_LINE3_BASELINE =
  "같은 몸짓 반응을 연속으로 재사용하지 말고, 다음 beat에서는 다른 신체 신호나 공간 변화를 사용한다.";

/** [EMOTION] 4번째 줄 — Step 2 candidate A (beat-internal hand chain). */
export const PROSE_EMOTION_LINE3_A =
  "같은 몸짓 반응을 한 beat 안에서 연속으로 재사용하지 말고, 다음 beat에서는 이미 쓴 신체 부위 대신 다른 신호나 공간 변화를 사용한다.";

export type Step2EmotionVariant = "baseline" | "emotion-a";
export type Step2SensationVariant = "baseline" | "sensation-a";
export type Step2SensationLine2Variant = "baseline" | "sensation-c";
export type Step2RhythmVariant = "baseline" | "rhythm-a";
export type Step2MovementVariant = "baseline" | "movement-a";

export function proseMovementLine1ForVariant(variant: Step2MovementVariant): string {
  return variant === "movement-a" ? PROSE_MOVEMENT_LINE1_A : PROSE_MOVEMENT_LINE1_BASELINE;
}

export function proseRhythmLine2ForVariant(variant: Step2RhythmVariant): string {
  return variant === "rhythm-a" ? PROSE_RHYTHM_LINE2_A : PROSE_RHYTHM_LINE2_BASELINE;
}

export function proseEmotionLine3ForVariant(variant: Step2EmotionVariant): string {
  return variant === "emotion-a" ? PROSE_EMOTION_LINE3_A : PROSE_EMOTION_LINE3_BASELINE;
}

export function proseSensationLine2ForVariant(variant: Step2SensationLine2Variant): string {
  return variant === "sensation-c" ? PROSE_SENSATION_LINE2_C : PROSE_SENSATION_LINE2_BASELINE;
}

export function proseSensationLine0ForVariant(variant: Step2SensationVariant): string {
  return variant === "sensation-a" ? PROSE_SENSATION_LINE0_A : PROSE_SENSATION_LINE0_BASELINE;
}

export function buildProseStyleSectionForStep2(variant: Step2EmotionVariant): string {
  const line3 = proseEmotionLine3ForVariant(variant);
  if (!PROSE_STYLE_SECTION.includes(PROSE_EMOTION_LINE3_BASELINE)) {
    throw new Error("PROSE_STYLE_SECTION baseline EMOTION line3 mismatch — sync proseStyleStep2Variants");
  }
  return PROSE_STYLE_SECTION.replace(PROSE_EMOTION_LINE3_BASELINE, line3);
}

export function buildProseStyleSectionForStep2Sensation(variant: Step2SensationVariant): string {
  const line0 = proseSensationLine0ForVariant(variant);
  if (!PROSE_STYLE_SECTION.includes(PROSE_SENSATION_LINE0_BASELINE)) {
    throw new Error("PROSE_STYLE_SECTION baseline SENSATION line0 mismatch — sync proseStyleStep2Variants");
  }
  return PROSE_STYLE_SECTION.replace(PROSE_SENSATION_LINE0_BASELINE, line0);
}

export function buildProseStyleSectionForStep2SensationC(variant: Step2SensationLine2Variant): string {
  const line2 = proseSensationLine2ForVariant(variant);
  if (!PROSE_STYLE_SECTION.includes(PROSE_SENSATION_LINE2_BASELINE)) {
    throw new Error("PROSE_STYLE_SECTION baseline SENSATION line2 mismatch — sync proseStyleStep2Variants");
  }
  return PROSE_STYLE_SECTION.replace(PROSE_SENSATION_LINE2_BASELINE, line2);
}

export function buildProseStyleSectionForStep2Rhythm(variant: Step2RhythmVariant): string {
  const line2 = proseRhythmLine2ForVariant(variant);
  if (!PROSE_STYLE_SECTION.includes(PROSE_RHYTHM_LINE2_BASELINE)) {
    throw new Error("PROSE_STYLE_SECTION baseline RHYTHM line2 mismatch — sync proseStyleStep2Variants");
  }
  return PROSE_STYLE_SECTION.replace(PROSE_RHYTHM_LINE2_BASELINE, line2);
}

export function buildProseStyleSectionForStep2Movement(variant: Step2MovementVariant): string {
  const line1 = proseMovementLine1ForVariant(variant);
  if (!PROSE_STYLE_SECTION.includes(PROSE_MOVEMENT_LINE1_BASELINE)) {
    throw new Error("PROSE_STYLE_SECTION baseline MOVEMENT line1 mismatch — sync proseStyleStep2Variants");
  }
  return PROSE_STYLE_SECTION.replace(PROSE_MOVEMENT_LINE1_BASELINE, line1);
}
