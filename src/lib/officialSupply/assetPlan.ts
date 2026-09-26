import { normalizeCreatorAssetTag } from "@/lib/characterAssets";
import { isAssetPersonTag } from "@/lib/assetPersonTags";
import { ADULT_SCENE_MIN_AGE } from "@/lib/participantMinAge";
import {
  qaResult,
  type OfficialAssetPlan,
  type OfficialAssetSlotKind,
  type OfficialCharacterDraft,
  type QaIssue,
  type QaResult,
} from "@/lib/officialSupply/types";

/** 1 representative (2:3) + 13 RP assets (3:2) per character. */
export const OFFICIAL_ASSET_SLOT_COUNTS: Readonly<Record<OfficialAssetSlotKind, number>> = {
  representative: 1,
  signature: 4,
  emotion: 6,
  scene: 3,
};

export const OFFICIAL_ASSET_TOTAL = Object.values(OFFICIAL_ASSET_SLOT_COUNTS).reduce((a, b) => a + b, 0);

/** Scene wording that describes an empty place rather than the character in it. */
const BACKGROUND_ONLY_RE = /(배경만|인물\s*없|사람\s*없|무인|빈\s*공간만|background[-\s]?only|no\s+(?:people|person|character))/i;

export function adultDepictionAllowed(draft: OfficialCharacterDraft): boolean {
  return draft.adult.nsfw && draft.adult.participantMinAge >= ADULT_SCENE_MIN_AGE;
}

/**
 * Text-only plan QA — runs before any paid call. Per-character tags are free
 * text (the canonical asset tag owner accepts arbitrary semantic tags and
 * duplicate tags); no global emotion list is imposed.
 */
export function evaluateAssetPlan(draft: OfficialCharacterDraft, plan: OfficialAssetPlan): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const counts: Record<OfficialAssetSlotKind, number> = { representative: 0, signature: 0, emotion: 0, scene: 0 };
  const slotKeys = new Set<string>();

  for (const slot of plan.slots) {
    counts[slot.kind] += 1;
    if (!slot.slotKey.trim() || slotKeys.has(slot.slotKey)) {
      errors.push({ code: "slot_key_invalid", message: `slot key "${slot.slotKey}" missing or duplicated` });
    }
    slotKeys.add(slot.slotKey);
    const tag = normalizeCreatorAssetTag(slot.tag);
    if (!tag || tag !== slot.tag) {
      errors.push({ code: "slot_tag_not_canonical", message: `${slot.slotKey}: tag must survive normalizeCreatorAssetTag` });
    }
    if (!slot.expression.trim()) errors.push({ code: "slot_expression_missing", message: `${slot.slotKey}: expression` });
    if (slot.characterPresence !== "required") {
      errors.push({ code: "slot_character_absent", message: `${slot.slotKey}: character must appear` });
    }
    if (slot.personTag != null && !isAssetPersonTag(slot.personTag)) {
      errors.push({ code: "slot_person_tag_unknown", message: `${slot.slotKey}: ${slot.personTag}` });
    }
    if (slot.kind === "scene") {
      if (!slot.location?.trim() || !slot.situation?.trim()) {
        errors.push({ code: "scene_location_missing", message: `${slot.slotKey}: scene needs location + situation` });
      }
      if (BACKGROUND_ONLY_RE.test(`${slot.location ?? ""} ${slot.situation ?? ""} ${slot.tag}`)) {
        errors.push({ code: "scene_background_only", message: `${slot.slotKey}: background-only scenes are out of scope` });
      }
    } else if (slot.location || slot.situation) {
      warnings.push({ code: "non_scene_location", message: `${slot.slotKey}: location ignored for ${slot.kind}` });
    }
    if (slot.depiction === "adult_grounded_non_explicit") {
      if (slot.kind === "representative") {
        errors.push({ code: "representative_adult_depiction", message: "card representative stays standard depiction" });
      }
      if (!adultDepictionAllowed(draft)) {
        errors.push({ code: "adult_depiction_not_allowed", message: `${slot.slotKey}: character is not a confirmed adult nsfw sheet` });
      }
    }
  }

  for (const kind of Object.keys(OFFICIAL_ASSET_SLOT_COUNTS) as OfficialAssetSlotKind[]) {
    if (counts[kind] !== OFFICIAL_ASSET_SLOT_COUNTS[kind]) {
      errors.push({
        code: "slot_count",
        message: `${kind}: ${counts[kind]} planned, ${OFFICIAL_ASSET_SLOT_COUNTS[kind]} required`,
      });
    }
  }

  const representative = plan.slots.find((slot) => slot.kind === "representative");
  if (representative && plan.slots.some((slot) => slot.kind !== "representative" && slot.tag === representative.tag)) {
    errors.push({
      code: "representative_tag_shared",
      message: "representative tag must be unique so RP tag selection never picks the 2:3 portrait",
    });
  }
  const sceneLocations = plan.slots.filter((s) => s.kind === "scene").map((s) => s.location?.trim() ?? "");
  if (new Set(sceneLocations).size !== sceneLocations.length) {
    warnings.push({ code: "scene_location_repeated", message: "special scenes reuse a location" });
  }
  return qaResult(errors, warnings);
}
