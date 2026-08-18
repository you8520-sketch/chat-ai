import type { TrpgParticipantKind, TrpgSuccessTier } from "./types";

export const TRPG_D20_TONES = ["nat1", "fail", "success", "nat20"] as const;
export type TrpgD20Tone = (typeof TRPG_D20_TONES)[number];

/** Action cards pass accent=false so a printed name does not create a speaker rail. */
export function resolveTrpgSpeakerRail(accent: boolean | undefined, hasName: boolean): boolean {
  if (accent === false) return false;
  if (accent === true) return true;
  return hasName;
}

export function trpgRollIsSuccess(tier: TrpgSuccessTier): boolean {
  switch (tier) {
    case "PARTIAL_SUCCESS":
    case "SUCCESS":
    case "GREAT_SUCCESS":
    case "CRITICAL_SUCCESS":
      return true;
    case "CRITICAL_FAILURE":
    case "SEVERE_FAILURE":
    case "FAILURE":
      return false;
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

export function trpgRollOutcomeLabel(tier: TrpgSuccessTier): "성공" | "실패" {
  return trpgRollIsSuccess(tier) ? "성공" : "실패";
}

/** Face 1/20 get stronger emphasis; otherwise the resolved tier. */
export function resolveTrpgD20Tone(d20: number, tier: TrpgSuccessTier): TrpgD20Tone {
  if (d20 === 1) return "nat1";
  if (d20 === 20) return "nat20";
  return trpgRollIsSuccess(tier) ? "success" : "fail";
}

export function isTrpgD20Face(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}

/** Same face string the SVG `<text>` renders. No client roll. */
export function trpgD20ViewModel(value: number, tone: TrpgD20Tone): {
  face: number;
  faceText: string;
  tone: TrpgD20Tone;
  fontSize: number;
} {
  const face = Number.isInteger(value) ? value : 0;
  return {
    face,
    faceText: String(face),
    tone,
    fontSize: face >= 10 ? 21 : 26,
  };
}

/** Number color only. No card background, gradient, or glow. */
export function trpgRollResultNumberClass(tone: TrpgD20Tone): string {
  switch (tone) {
    case "nat20":
      return "text-[#d4b45a]";
    case "nat1":
      return "text-[#c45c66]";
    case "success":
      return "text-emerald-200/90";
    case "fail":
      return "text-rose-200/90";
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}

/** Outcome label follows success/fail, not a rewritten critical tier. */
export function trpgRollResultOutcomeClass(tone: TrpgD20Tone): string {
  switch (tone) {
    case "nat20":
    case "success":
      return "text-emerald-300/80";
    case "nat1":
    case "fail":
      return "text-rose-300/80";
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}

export function trpgActionCardCompactName(name: string, kind: TrpgParticipantKind): string {
  return kind === "ai_character" ? `${name} AI` : name;
}
