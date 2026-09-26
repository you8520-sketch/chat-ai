import crypto from "crypto";
import { characterAdultTextBlob, findAdultTermsInText } from "@/lib/characterAdultText";
import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import { sanitizeCharacterGenres } from "@/lib/characterGenres";
import { ADULT_SCENE_MIN_AGE, validateNsfwParticipantAgeContract } from "@/lib/participantMinAge";
import {
  qaResult,
  type OfficialCharacterDraft,
  type OfficialSupportingNpc,
  type QaIssue,
  type QaResult,
} from "@/lib/officialSupply/types";

export const SUPPORTING_NPC_MAX = 3;
/** ~200 chars target per NPC line; hard ceiling leaves room for long names. */
export const SUPPORTING_NPC_LINE_SOFT_MAX = 200;
export const SUPPORTING_NPC_LINE_HARD_MAX = 240;

/**
 * Soft authoring bands (not hard targets). Only the canonical form limits in
 * `characterFormLimits` are hard; these produce warnings so simple characters
 * are not padded.
 */
export const OFFICIAL_TEXT_LENGTH_BANDS = {
  total: [6000, 8000],
  worldAndSituation: [1500, 2300],
  characterCore: [2500, 3500],
  relationshipsAndDrives: [700, 1000],
  speech: [500, 900],
  supportingNpcs: [0, 600],
} as const;

/** Below this the sheet is too thin for official quality (hard). */
export const OFFICIAL_TEXT_THIN_FLOOR = 3000;
/** Reserved for the `[외형]` block rendered from the Appearance Lock at staging. */
export const OFFICIAL_APPEARANCE_BLOCK_RESERVE = 600;
/** Non-adult canon must dominate an adult sheet. */
export const ADULT_SECTION_MAX_SHARE = 0.25;

export function formatSupportingNpcLine(npc: OfficialSupportingNpc): string {
  return [
    npc.name,
    npc.age != null ? `${npc.age}세` : null,
    npc.heightCm != null ? `${npc.heightCm}cm` : null,
    npc.appearance,
    npc.personalityKeywords.join("·"),
    npc.role,
    npc.relationToChar,
    npc.speech,
  ]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

function joinSections(parts: Array<[string, string]>): string {
  return parts
    .filter(([, body]) => body.trim())
    .map(([header, body]) => `[${header}]\n${body.trim()}`)
    .join("\n\n");
}

/** `system_prompt` composition. `[외형]` is appended only after the Appearance Lock. */
export function composeOfficialSystemPrompt(
  draft: OfficialCharacterDraft,
  appearanceBlock = ""
): string {
  return joinSections([
    ["캐릭터 본체", draft.sections.characterCore],
    ["관계·갈등·행동원리", draft.sections.relationshipsAndDrives],
    ["보조 인물", draft.supportingNpcs.map(formatSupportingNpcLine).join("\n")],
    ["기타 설정", draft.sections.extraCanon],
    ["성인 관계 성향", draft.adult.nsfw ? `${draft.adult.orientation}\n${draft.adult.adultHookSummary}` : ""],
    ["외형", appearanceBlock],
  ]);
}

export type OfficialCanonicalFormAsset = {
  url: string;
  tag: string;
  width: number;
  height: number;
  viewerBlur: boolean;
  adultFlagged?: boolean;
  moderationReject?: boolean;
  moderationReason?: string;
};

/**
 * Maps a draft onto the exact request body the canonical character save owner
 * (`parseCharacterFormBody` / `createCharacterFromForm`) accepts. Visibility is
 * always private — publication is a separate, later decision.
 */
export function buildOfficialCharacterFormBody(input: {
  draft: OfficialCharacterDraft;
  appearanceBlock: string;
  assets: OfficialCanonicalFormAsset[];
  lorebookIds?: number[];
}): Record<string, unknown> {
  const { draft } = input;
  const adult = draft.adult;
  return {
    content_kind: "character",
    name: draft.name,
    tagline: draft.tagline,
    description: draft.description,
    greeting: draft.greeting,
    world: draft.sections.worldAndSituation,
    system_prompt: composeOfficialSystemPrompt(draft, input.appearanceBlock),
    speech_personality: draft.speech.personality,
    speech_traits: draft.speech.traits,
    speech_examples: draft.speech.examples,
    speech_forbidden: draft.speech.forbidden,
    genres: draft.genres,
    tags: draft.tags,
    gender: draft.gender,
    audience: draft.audience,
    visibility: "private",
    nsfw: adult.nsfw,
    participant_min_age: adult.nsfw ? adult.participantMinAge : draft.age,
    ...(adult.nsfw
      ? {
          adult_dialogue_profile: adult.adultDialogueProfile,
          adult_consent_modes_allowed: adult.adultConsentModesAllowed,
        }
      : {}),
    lorebook_ids: input.lorebookIds ?? [],
    assets: input.assets,
  };
}

export function officialSubstantiveCharCount(draft: OfficialCharacterDraft, appearanceBlock = ""): number {
  return (
    draft.sections.worldAndSituation.length +
    composeOfficialSystemPrompt(draft, appearanceBlock).length +
    draft.speech.personality.length +
    draft.speech.traits.length
  );
}

export function computeTextLockHash(draft: OfficialCharacterDraft): string {
  const canonical = JSON.stringify({
    name: draft.name,
    tagline: draft.tagline,
    description: draft.description,
    greeting: draft.greeting,
    gender: draft.gender,
    age: draft.age,
    genres: draft.genres,
    sections: draft.sections,
    speech: draft.speech,
    supportingNpcs: draft.supportingNpcs,
    secrets: draft.secrets,
    adult: draft.adult,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function band(
  warnings: QaIssue[],
  code: string,
  value: number,
  range: readonly [number, number]
): void {
  if (value < range[0] || value > range[1]) {
    warnings.push({ code, message: `${code}: ${value} chars (soft band ${range[0]}-${range[1]})` });
  }
}

export function evaluateOfficialTextLength(draft: OfficialCharacterDraft): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const npcText = draft.supportingNpcs.map(formatSupportingNpcLine).join("\n");
  const total = officialSubstantiveCharCount(draft);
  band(warnings, "length_total", total, OFFICIAL_TEXT_LENGTH_BANDS.total);
  band(warnings, "length_world", draft.sections.worldAndSituation.length, OFFICIAL_TEXT_LENGTH_BANDS.worldAndSituation);
  band(warnings, "length_core", draft.sections.characterCore.length, OFFICIAL_TEXT_LENGTH_BANDS.characterCore);
  band(
    warnings,
    "length_relationships",
    draft.sections.relationshipsAndDrives.length,
    OFFICIAL_TEXT_LENGTH_BANDS.relationshipsAndDrives
  );
  band(
    warnings,
    "length_speech",
    draft.speech.personality.length + draft.speech.traits.length,
    OFFICIAL_TEXT_LENGTH_BANDS.speech
  );
  band(warnings, "length_npcs", npcText.length, OFFICIAL_TEXT_LENGTH_BANDS.supportingNpcs);
  if (total < OFFICIAL_TEXT_THIN_FLOOR) {
    errors.push({ code: "text_too_thin", message: `total ${total} < ${OFFICIAL_TEXT_THIN_FLOOR}` });
  }
  if (total + OFFICIAL_APPEARANCE_BLOCK_RESERVE > AI_LEARNING_LIMIT) {
    errors.push({
      code: "text_exceeds_canonical_ceiling",
      message: `total ${total} + appearance reserve ${OFFICIAL_APPEARANCE_BLOCK_RESERVE} exceeds ${AI_LEARNING_LIMIT}`,
    });
  }
  return qaResult(errors, warnings);
}

export function evaluateSupportingNpcs(draft: OfficialCharacterDraft): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  if (draft.supportingNpcs.length > SUPPORTING_NPC_MAX) {
    errors.push({ code: "npc_count", message: `at most ${SUPPORTING_NPC_MAX} supporting NPCs` });
  }
  const names = new Set<string>();
  for (const npc of draft.supportingNpcs) {
    const line = formatSupportingNpcLine(npc);
    if (!npc.name.trim() || !npc.role.trim() || !npc.relationToChar.trim()) {
      errors.push({ code: "npc_incomplete", message: `NPC ${npc.name || "?"} needs name, role and relation` });
    }
    if (npc.name.trim() === draft.name.trim()) {
      errors.push({ code: "npc_name_collides_main", message: `NPC ${npc.name} shares the main character name` });
    }
    if (names.has(npc.name.trim())) {
      errors.push({ code: "npc_name_duplicate", message: `duplicate NPC ${npc.name}` });
    }
    names.add(npc.name.trim());
    if (line.length > SUPPORTING_NPC_LINE_HARD_MAX) {
      errors.push({ code: "npc_line_too_long", message: `NPC ${npc.name}: ${line.length} chars` });
    } else if (line.length > SUPPORTING_NPC_LINE_SOFT_MAX) {
      warnings.push({ code: "npc_line_long", message: `NPC ${npc.name}: ${line.length} chars` });
    }
  }
  return qaResult(errors, warnings);
}

/**
 * Present-tense minor status / unknown age. School-year words followed by a
 * past marker ("고등학생 시절") are backstory, not current status.
 */
const MINOR_STATUS_RE =
  /(?:미성년|나이\s*(?:불명|미상)|나이를\s*알\s*수\s*없)|(?:고등학생|중학생|초등학생|여고생|남고생|여중생|남중생|초딩|중딩|고딩)(?!\s*(?:때|시절|무렵|이던|였던|적))/;
/** Youthful-appearance wording is legal for adults; flagged for the reviewer, never auto-passed silently. */
const YOUTHFUL_AMBIGUITY_RE = /(어려\s*보|학생처럼|소년|소녀|앳된|동안|아이\s*같)/;
/** `N살/N세` not followed by a past-time marker (e.g. "12살 때"). */
const PRESENT_AGE_RE = /(\d{1,3})\s*(?:세|살)(?!\s*(?:때|무렵|시절|적|에|이던|였던))/g;

function statesAge(text: string, age: number): boolean {
  return new RegExp(`(?<!\\d)${age}\\s*(?:세|살)`).test(text);
}

function mainSheetText(draft: OfficialCharacterDraft): string {
  return [
    draft.description,
    draft.greeting,
    draft.sections.worldAndSituation,
    draft.sections.characterCore,
    draft.sections.relationshipsAndDrives,
    draft.sections.extraCanon,
  ].join("\n");
}

/**
 * Structured age ↔ prose consistency for every character (adult or not), plus
 * the adult-only contract checks. Canonical validation
 * (`validateNsfwParticipantAgeContract`) is reused, never re-implemented.
 */
export function evaluateAgeAndAdultConsistency(draft: OfficialCharacterDraft): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const sheet = mainSheetText(draft);

  if (!Number.isInteger(draft.age) || draft.age <= 0) {
    errors.push({ code: "main_age_missing", message: "main character needs a structured integer age" });
  } else if (!statesAge(draft.sections.characterCore, draft.age)) {
    errors.push({ code: "main_age_not_stated", message: `character core must state ${draft.age}세 explicitly` });
  }

  const adult = draft.adult;
  if (!adult.nsfw) {
    if (findAdultTermsInText(characterAdultTextBlob({
      name: draft.name,
      tagline: draft.tagline,
      description: draft.description,
      greeting: draft.greeting,
      tags: draft.tags,
    })).length > 0) {
      errors.push({ code: "sfw_public_text_has_adult_terms", message: "all-ages public text contains adult terms" });
    }
    return qaResult(errors, warnings);
  }

  const contractError = validateNsfwParticipantAgeContract({
    nsfw: true,
    participantMinAge: adult.participantMinAge,
  });
  if (contractError) errors.push({ code: "adult_age_contract", message: contractError });
  if (draft.age < ADULT_SCENE_MIN_AGE) {
    errors.push({ code: "adult_main_under_19", message: `main character age ${draft.age} < ${ADULT_SCENE_MIN_AGE}` });
  }

  const eligibleNpcAges: number[] = [];
  for (const npc of draft.supportingNpcs) {
    if (npc.age == null) {
      errors.push({ code: "adult_npc_age_missing", message: `adult sheet NPC ${npc.name} needs an explicit age` });
      continue;
    }
    if (npc.age < ADULT_SCENE_MIN_AGE) {
      errors.push({
        code: "adult_npc_under_19",
        message: `adult sheet NPC ${npc.name} is ${npc.age}; official adult sheets keep every NPC ${ADULT_SCENE_MIN_AGE}+`,
      });
    }
    if (npc.adultEligible) eligibleNpcAges.push(npc.age);
    if (MINOR_STATUS_RE.test(formatSupportingNpcLine(npc))) {
      errors.push({ code: "adult_npc_minor_wording", message: `NPC ${npc.name} line implies a minor` });
    }
  }
  const expectedMinAge = Math.min(draft.age, ...eligibleNpcAges);
  if (adult.participantMinAge !== expectedMinAge) {
    errors.push({
      code: "participant_min_age_mismatch",
      message: `participantMinAge ${adult.participantMinAge} must equal youngest adult participant age ${expectedMinAge}`,
    });
  }

  if (MINOR_STATUS_RE.test(sheet)) {
    errors.push({ code: "adult_minor_wording", message: "adult sheet contains minor-status wording" });
  }
  if (YOUTHFUL_AMBIGUITY_RE.test(sheet)) {
    warnings.push({
      code: "adult_youthful_wording",
      message: "youthful-appearance wording on an adult sheet — reviewer must confirm it reads as adult",
    });
  }
  for (const match of sheet.matchAll(PRESENT_AGE_RE)) {
    const mentioned = Number(match[1]);
    if (mentioned > 0 && mentioned < ADULT_SCENE_MIN_AGE) {
      errors.push({ code: "adult_under_19_age_mention", message: `sheet mentions a present age of ${mentioned}` });
    }
  }

  if (!adult.adultHookSummary.trim() || !adult.orientation.trim()) {
    errors.push({ code: "adult_profile_incomplete", message: "adult orientation and hook summary are required" });
  }
  const nonAdultChars =
    draft.sections.worldAndSituation.length +
    draft.sections.characterCore.length +
    draft.sections.relationshipsAndDrives.length +
    draft.sections.extraCanon.length;
  const adultChars = adult.adultHookSummary.length + adult.orientation.length;
  if (adultChars > (nonAdultChars + adultChars) * ADULT_SECTION_MAX_SHARE) {
    errors.push({
      code: "adult_dominates_sheet",
      message: "adult canon must be woven into a complete character, not replace it",
    });
  }
  if (adult.adultDialogueProfile === "none") {
    warnings.push({ code: "adult_profile_none", message: "nsfw=true with adultDialogueProfile=none" });
  }
  return qaResult(errors, warnings);
}

export function evaluateDraftSchema(draft: OfficialCharacterDraft): QaResult {
  const errors: QaIssue[] = [];
  for (const [key, value] of Object.entries({
    draftKey: draft.draftKey,
    worldKey: draft.worldKey,
    styleKey: draft.styleKey,
    name: draft.name,
    tagline: draft.tagline,
    greeting: draft.greeting,
    worldAndSituation: draft.sections.worldAndSituation,
    characterCore: draft.sections.characterCore,
    relationshipsAndDrives: draft.sections.relationshipsAndDrives,
    archetype: draft.hook.archetype,
    relationshipTrope: draft.hook.relationshipTrope,
    occupation: draft.hook.occupation,
    rpHook: draft.hook.rpHook,
  })) {
    if (!String(value ?? "").trim()) errors.push({ code: "field_missing", message: `${key} is required` });
  }
  if (sanitizeCharacterGenres(draft.genres).length !== draft.genres.length || draft.genres.length === 0) {
    errors.push({ code: "genre_not_canonical", message: "genres must be canonical CHARACTER_GENRES values" });
  }
  return qaResult(errors);
}

export function mergeQa(...results: QaResult[]): QaResult {
  return qaResult(
    results.flatMap((r) => r.errors),
    results.flatMap((r) => r.warnings)
  );
}
