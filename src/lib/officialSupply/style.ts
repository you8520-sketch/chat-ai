import { isCharacterGenre } from "@/lib/characterGenres";
import {
  qaResult,
  type OfficialGenreStyle,
  type QaIssue,
  type QaResult,
  type StyleReference,
  type VisualStyleCandidate,
} from "@/lib/officialSupply/types";

export const OFFICIAL_STYLE_KEY_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*_v\d+$/;
export const STYLE_CANDIDATES_MIN = 3;
export const STYLE_CANDIDATES_MAX = 5;
export const DEFAULT_STYLE_PROOF_ASSET_LIMIT = 3;

/** Style names that point at a specific artist/work are not visual attributes. */
const COPY_TARGET_RE = /(?:화풍\s*복제|그림체\s*복제|style of\s+\S+|in the style of|작가\s*풍|artist:|by\s+@)/i;

export function isGenerationSafeReference(reference: StyleReference | null | undefined): boolean {
  return reference?.provenance === "platform_owned" || reference?.provenance === "licensed";
}

function suitabilityScoreOk(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function validateCandidate(candidate: VisualStyleCandidate, index: number): QaIssue[] {
  const errors: QaIssue[] = [];
  const at = `candidate[${index}]`;
  if (!candidate.candidateId.trim()) errors.push({ code: "candidate_id_missing", message: `${at} id missing` });
  const dnaText = Object.values(candidate.dna).join(" ");
  for (const [key, value] of Object.entries(candidate.dna)) {
    if (typeof value !== "string" || !value.trim()) {
      errors.push({ code: "dna_field_missing", message: `${at}.dna.${key} is empty` });
    }
  }
  if (COPY_TARGET_RE.test(`${candidate.label} ${dnaText}`)) {
    errors.push({
      code: "style_copy_target",
      message: `${at} names an artist/work as the target; describe visual attributes instead`,
    });
  }
  const s = candidate.suitability;
  for (const key of [
    "card",
    "rpLandscape",
    "maleCharacters",
    "femaleCharacters",
    "backgroundScene",
    "romanticScene",
    "tenseRelationshipScene",
    "indoorBedroomScene",
    "outfitVariation",
    "emotionRange",
  ] as const) {
    if (!suitabilityScoreOk(s[key])) {
      errors.push({ code: "suitability_score_invalid", message: `${at}.suitability.${key} must be 1-5` });
    }
  }
  if (candidate.references.length === 0) {
    errors.push({ code: "candidate_reference_missing", message: `${at} needs at least one public reference` });
  }
  return errors;
}

export function validateStyleProposal(style: Pick<OfficialGenreStyle, "styleKey" | "genre" | "candidates">): QaResult {
  const errors: QaIssue[] = [];
  if (!OFFICIAL_STYLE_KEY_RE.test(style.styleKey)) {
    errors.push({ code: "style_key_invalid", message: "styleKey must look like romance_fantasy_v1" });
  }
  if (!isCharacterGenre(style.genre)) {
    errors.push({ code: "genre_not_canonical", message: `genre ${style.genre} is not in CHARACTER_GENRES` });
  }
  if (style.candidates.length < STYLE_CANDIDATES_MIN || style.candidates.length > STYLE_CANDIDATES_MAX) {
    errors.push({
      code: "candidate_count",
      message: `each genre needs ${STYLE_CANDIDATES_MIN}-${STYLE_CANDIDATES_MAX} style candidates`,
    });
  }
  const ids = new Set<string>();
  style.candidates.forEach((candidate, index) => {
    if (ids.has(candidate.candidateId)) {
      errors.push({ code: "candidate_id_duplicate", message: `duplicate candidate ${candidate.candidateId}` });
    }
    ids.add(candidate.candidateId);
    errors.push(...validateCandidate(candidate, index));
  });
  return qaResult(errors);
}

export function validateStyleSeedForApproval(seed: StyleReference | null | undefined): string | null {
  if (!seed?.url.trim()) return "style seed reference is required before any paid generation";
  if (!isGenerationSafeReference(seed)) {
    return "only platform-owned or licensed references may be sent to the image provider";
  }
  return null;
}
