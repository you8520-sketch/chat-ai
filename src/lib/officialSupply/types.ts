import type { AdultConsentMode, AdultDialogueProfile } from "@/lib/adultSceneRouting";
import type { AssetPersonTag } from "@/lib/assetPersonTags";
import type { CharacterGender } from "@/lib/characterGender";
import type { CharacterGenre } from "@/lib/characterGenres";

/**
 * Official character supply pipeline vocabulary.
 *
 * Stage names are prefixed by their owner table (`official_supply_*`) and are
 * intentionally distinct from `characters.moderation_status` / `visibility`:
 * the pipeline never writes those columns directly — staging goes through the
 * canonical `createCharacterFromForm` owner.
 */

export const OFFICIAL_CHARACTER_STAGES = [
  "draft",
  "text_locked",
  "appearance_locked",
  "asset_plan_locked",
  "anchor_approved",
  "assets_complete",
  "qa_passed",
  "staged_private",
  "published",
] as const;
export type OfficialCharacterStage = (typeof OFFICIAL_CHARACTER_STAGES)[number];

export function officialCharacterStageRank(stage: OfficialCharacterStage): number {
  return OFFICIAL_CHARACTER_STAGES.indexOf(stage);
}

export function isStageAtLeast(
  stage: OfficialCharacterStage,
  required: OfficialCharacterStage
): boolean {
  return officialCharacterStageRank(stage) >= officialCharacterStageRank(required);
}

export const OFFICIAL_STYLE_STAGES = [
  "candidates_proposed",
  "candidate_approved",
  "style_locked",
  "rejected",
] as const;
export type OfficialStyleStage = (typeof OFFICIAL_STYLE_STAGES)[number];

export type StyleLevel = "low" | "medium" | "high";

/** Structured visual attributes — abstracted tendencies, never an artist/character copy target. */
export type VisualStyleDna = {
  faceProportion: string;
  eyeShape: string;
  noseMouthDetail: string;
  lineDensity: StyleLevel;
  rendering: "cel" | "soft_cel" | "painterly" | "semi_realistic";
  skinRendering: string;
  hairRendering: string;
  bodyProportion: string;
  costumeComplexity: StyleLevel;
  palette: string;
  lightSoftness: "soft" | "medium" | "hard";
  contrast: StyleLevel;
  backgroundDensity: StyleLevel;
  framing: string;
  atmosphere: string;
};

/** 1 (poor) … 5 (excellent) suitability scores shown to the approver. */
export type StyleSuitability = {
  card: number;
  rpLandscape: number;
  maleCharacters: number;
  femaleCharacters: number;
  backgroundScene: number;
  romanticScene: number;
  tenseRelationshipScene: number;
  indoorBedroomScene: number;
  outfitVariation: number;
  emotionRange: number;
  identityConsistencyDifficulty: StyleLevel;
};

/**
 * `external_public_observation` references are display-only links for the
 * approver. Only platform-owned or licensed images may ever be sent to the
 * image provider.
 */
export type StyleReferenceProvenance =
  | "external_public_observation"
  | "platform_owned"
  | "licensed";

export type StyleReference = {
  url: string;
  provenance: StyleReferenceProvenance;
  note: string;
};

export type VisualStyleCandidate = {
  candidateId: string;
  label: string;
  dna: VisualStyleDna;
  suitability: StyleSuitability;
  strengths: string[];
  references: StyleReference[];
};

export type OfficialGenreStyle = {
  styleKey: string;
  genre: CharacterGenre;
  stage: OfficialStyleStage;
  candidates: VisualStyleCandidate[];
  approvedCandidateId: string | null;
  styleSeed: StyleReference | null;
  proofAssetLimit: number;
};

export type OfficialSupportingNpc = {
  name: string;
  age: number | null;
  heightCm: number | null;
  appearance: string;
  personalityKeywords: string[];
  role: string;
  relationToChar: string;
  speech: string;
  /** True when this NPC may take part in adult relationships/scenes. */
  adultEligible: boolean;
};

export type OfficialAdultProfile =
  | { nsfw: false }
  | {
      nsfw: true;
      participantMinAge: number;
      adultDialogueProfile: AdultDialogueProfile;
      adultConsentModesAllowed: AdultConsentMode[];
      /** e.g. "BL", "HL 이성애", "GL", "양성애" — canon of the character, not a runtime flag. */
      orientation: string;
      /** Adult interaction canon woven into the character sheet (not the whole sheet). */
      adultHookSummary: string;
    };

export type OfficialCharacterHook = {
  archetype: string;
  relationshipTrope: string;
  occupation: string;
  rpHook: string;
};

export type OfficialCharacterSections = {
  worldAndSituation: string;
  characterCore: string;
  relationshipsAndDrives: string;
  extraCanon: string;
};

export type OfficialCharacterSpeech = {
  personality: string;
  traits: string;
  examples: string;
  forbidden: string;
};

export type OfficialCharacterDraft = {
  draftKey: string;
  worldKey: string;
  styleKey: string;
  name: string;
  tagline: string;
  description: string;
  greeting: string;
  gender: CharacterGender;
  age: number;
  genres: CharacterGenre[];
  tags: string[];
  audience: "all" | "female" | "male";
  sections: OfficialCharacterSections;
  speech: OfficialCharacterSpeech;
  supportingNpcs: OfficialSupportingNpc[];
  hook: OfficialCharacterHook;
  /** Hidden canon as short key phrases (true identity, secret lineage, future events). Never shared across characters. */
  secrets: string[];
  adult: OfficialAdultProfile;
};

export type OfficialWorldLorebookEntry = {
  entryKey: string;
  name: string;
  keywords: string[];
  content: string;
};

export type AgeBand = "early_20s" | "mid_20s" | "late_20s" | "30s" | "40s" | "50_plus" | "ageless_adult";

/** Identity Lock — must hold across every variation. */
export type OfficialIdentityLock = {
  apparentAgeBand: AgeBand;
  faceShape: string;
  eyes: string;
  eyeColor: string;
  hair: string;
  hairColor: string;
  hairLength: string;
  heightCm: number;
  build: string;
  skinTone: string;
  identifyingFeatures: string[];
};

/** Outfit Lock — default outfit plus the policy that governs scene variants. */
export type OfficialOutfitLock = {
  defaultOutfit: string;
  alternateOutfitPolicy: string;
};

export type OfficialAppearanceLock = {
  identity: OfficialIdentityLock;
  outfit: OfficialOutfitLock;
  forbiddenDrift: string[];
};

export type OfficialAssetSlotKind = "representative" | "signature" | "emotion" | "scene";

export type OfficialAssetDepiction = "standard" | "adult_grounded_non_explicit";

export type OfficialAssetSlotPlan = {
  slotKey: string;
  kind: OfficialAssetSlotKind;
  /** Creator asset tag (semantic selection cue, stored via the canonical asset owner). */
  tag: string;
  expression: string;
  pose: string;
  /** "default" or a scene-specific outfit variant (Identity Lock still applies). */
  outfit: string;
  /** Scene slots only. */
  location: string | null;
  situation: string | null;
  /** Every official asset depicts the character — background-only assets do not exist here. */
  characterPresence: "required";
  depiction: OfficialAssetDepiction;
  /** Optional canonical person-tag hint when a taxonomy tag fits. */
  personTag: AssetPersonTag | null;
};

export type OfficialAssetPlan = {
  slots: OfficialAssetSlotPlan[];
};

export type OfficialAssetStatus =
  | "planned"
  | "generating"
  | "upload_pending"
  | "generated"
  | "approved"
  | "rejected"
  | "failed"
  | "stale";

export type QaCheck = { ok: boolean; note?: string };

export type OfficialAnchorQaReport = {
  gender: QaCheck;
  ageAppearance: QaCheck;
  face: QaCheck;
  hair: QaCheck;
  eyes: QaCheck;
  body: QaCheck;
  identifyingFeatures: QaCheck;
  artStyle: QaCheck;
  outfit: QaCheck;
  cardCrop: QaCheck;
};

export type OfficialVariationQaReport = {
  identityMatchesAnchor: QaCheck;
  expressionMatchesPlan: QaCheck;
  characterPresent: QaCheck;
  artStyle: QaCheck;
};

/**
 * Canonical asset-vision moderation result for one generated asset. Recorded
 * by the pipeline (never supplied inside a reviewer's QA report).
 * `unavailable` is explicit — it is never treated as a clean pass.
 */
export type OfficialAssetModeration =
  | { status: "checked"; adultFlagged: boolean; moderationReject: boolean; reason: string }
  | { status: "unavailable"; reason: string };

export type QaIssue = { code: string; message: string };

export type QaResult = {
  ok: boolean;
  errors: QaIssue[];
  warnings: QaIssue[];
};

export function qaResult(errors: QaIssue[], warnings: QaIssue[] = []): QaResult {
  return { ok: errors.length === 0, errors, warnings };
}
