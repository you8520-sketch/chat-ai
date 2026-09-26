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
  if (lock.forbiddenDrift.length === 0) {
    warnings.push({ code: "appearance_no_forbidden_drift", message: "no forbidden-drift rules recorded" });
  }
  return qaResult(errors, warnings);
}
