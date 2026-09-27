import { hashAppearanceRaw } from "@/lib/appearanceCompiler";
import {
  qaResult,
  type AgeBand,
  type OfficialAppearanceLock,
  type OfficialCharacterDraft,
  type QaIssue,
  type QaResult,
} from "@/lib/officialSupply/types";

const AGE_BAND_RANGES: Record<AgeBand, readonly [number, number]> = {
  early_20s: [19, 23],
  mid_20s: [23, 27],
  late_20s: [26, 30],
  "30s": [29, 40],
  "40s": [39, 50],
  "50_plus": [49, 999],
  ageless_adult: [19, 999],
};

/** Visual descriptors that contradict an adult identity lock. */
const MINOR_VISUAL_RE = /(아동|어린이|유아|초등|중학생|고등학생|교복|child|kid|teen|loli|shota)/i;


/**
 * Canonical visual-age contract for domestic romance-fantasy men in their 30s.
 * Character-specific age/identity stays owned by Appearance Lock; Style DNA
 * may describe rendering and product direction but must not redefine aging.
 */
export const MATURE_MALE_VISUAL_AGE_RULE =
  "MATURE MALE VISUAL AGE LOCK — Keep an adult man in his 30s visibly mature and age-appropriate while preserving a polished romance-target face. Convey maturity through physique, shoulders, neck, posture, gaze, grooming, authority and styling. Keep facial skin clean and healthy, cheek lines controlled, and the jaw defined without adding older-age facial texture. Wrinkles, sagging skin, hollowed cheeks, age spots, visibly receding hair, or an older-than-canon face belong only to characters whose canon explicitly calls for that older visual age. Fantasy silver/gray hair may remain a canonical color and is not itself an aging cue.";

const MATURE_MALE_AGING_DRIFT_RE =
  /(?:노안|중년(?:처럼|으로)?\s*보|장년(?:처럼|으로)?\s*보|실제보다\s*(?:몇\s*살\s*)?(?:늙|나이\s*들)|나이보다\s*(?:늙|들어|많아)|주름진|깊은\s*주름|처진\s*피부|늘어진\s*피부|꺼진\s*볼|검버섯|receding\s*hair|wrinkl|sagging\s*skin|hollow(?:ed)?\s*cheeks|age\s*spots|older[- ]than[- ]canon)/i;

export function isMatureMaleRofanRomanceTarget(draft: OfficialCharacterDraft): boolean {
  return (
    draft.gender === "male" &&
    draft.age >= 30 &&
    draft.age < 40 &&
    draft.genres.includes("로맨스 판타지") &&
    draft.audience !== "male"
  );
}

/** Authoring-time projection for the current romance-fantasy appearance builder. */
export function buildRofanMatureMaleVisualAgeDirection(
  age: number,
  gender: string
): string | null {
  return gender === "male" && age >= 30 && age < 40
    ? MATURE_MALE_VISUAL_AGE_RULE
    : null;
}

/** Provider-prompt projection; wording stays owned here, not in imagePrompt/style DNA. */
export function buildMatureMaleVisualAgePrompt(
  draft: OfficialCharacterDraft
): string | null {
  return isMatureMaleRofanRomanceTarget(draft)
    ? MATURE_MALE_VISUAL_AGE_RULE
    : null;
}

/**
 * Renders the Appearance Lock as the `[외형]` block so the canonical appearance
 * owner (`extractAppearanceRawFromSetting` → appearance_raw/compiled) receives
 * exactly the locked identity. No second appearance store is created.
 */
export function renderAppearanceBlock(lock: OfficialAppearanceLock): string {
  const id = lock.identity;
  return [
    `연령대 인상: ${id.apparentAgeBand}`,
    `얼굴: ${id.faceShape}`,
    `눈: ${id.eyes} (${id.eyeColor})`,
    `머리: ${id.hair} (${id.hairColor}, ${id.hairLength})`,
    `키/체형: ${id.heightCm}cm, ${id.build}`,
    `피부: ${id.skinTone}`,
    id.identifyingFeatures.length ? `특징: ${id.identifyingFeatures.join(", ")}` : "",
    `기본 의상: ${lock.outfit.defaultOutfit}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Appearance Lock hash — the canonical appearance hash of the rendered block. */
export function computeAppearanceLockHash(lock: OfficialAppearanceLock): string {
  return hashAppearanceRaw(renderAppearanceBlock(lock));
}

export function evaluateAppearanceLock(
  draft: OfficialCharacterDraft,
  lock: OfficialAppearanceLock
): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const id = lock.identity;
  for (const [key, value] of Object.entries({
    faceShape: id.faceShape,
    eyes: id.eyes,
    eyeColor: id.eyeColor,
    hair: id.hair,
    hairColor: id.hairColor,
    hairLength: id.hairLength,
    build: id.build,
    skinTone: id.skinTone,
    defaultOutfit: lock.outfit.defaultOutfit,
    alternateOutfitPolicy: lock.outfit.alternateOutfitPolicy,
  })) {
    if (!value.trim()) errors.push({ code: "appearance_field_missing", message: `${key} is required` });
  }
  if (!Number.isInteger(id.heightCm) || id.heightCm < 120 || id.heightCm > 230) {
    errors.push({ code: "appearance_height_invalid", message: `heightCm ${id.heightCm} out of range` });
  }
  const [min, max] = AGE_BAND_RANGES[id.apparentAgeBand];
  if (draft.age < min || draft.age > max) {
    if (id.apparentAgeBand === "ageless_adult" || draft.age >= 19) {
      warnings.push({
        code: "appearance_age_band_offset",
        message: `apparent ${id.apparentAgeBand} differs from structured age ${draft.age}`,
      });
    } else {
      errors.push({ code: "appearance_age_band_conflict", message: `age ${draft.age} vs ${id.apparentAgeBand}` });
    }
  }
  const visualText = [renderAppearanceBlock(lock), lock.outfit.alternateOutfitPolicy].join("\n");
  if (draft.adult.nsfw && MINOR_VISUAL_RE.test(visualText)) {
    errors.push({ code: "appearance_minor_coded", message: "adult character appearance uses minor-coded descriptors" });
  }
  if (isMatureMaleRofanRomanceTarget(draft)) {
    if (id.apparentAgeBand === "40s" || id.apparentAgeBand === "50_plus") {
      errors.push({
        code: "appearance_mature_male_age_band",
        message: `30s romance-target male cannot default to apparentAgeBand ${id.apparentAgeBand}`,
      });
    }
    if (MATURE_MALE_AGING_DRIFT_RE.test(visualText)) {
      errors.push({
        code: "appearance_mature_male_aging_drift",
        message: "30s romance-target male appearance adds older-age facial treatment not required by canon",
      });
    }
  }
  if (lock.forbiddenDrift.length === 0) {
    warnings.push({ code: "appearance_no_forbidden_drift", message: "no forbidden-drift rules recorded" });
  }
  return qaResult(errors, warnings);
}
