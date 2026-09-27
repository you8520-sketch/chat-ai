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
/** Representative generation may send at most this many style-only images (primary + companions). */
export const OFFICIAL_STYLE_GENERATION_REF_MAX = 3;

/**
 * Product-level visual direction for the domestic-first romance-fantasy line.
 * This is an abstract style brief, not a reference to any artist, work, or competitor asset.
 * Character-specific age/identity remains owned by Appearance Lock.
 */
export const DOMESTIC_ROFAN_STYLE_DIRECTION = [
  "국내 여성향 로맨스 판타지 카드에서 얼굴 매력이 첫눈에 읽히는 세련된 미형을 우선한다.",
  "한국 여성향 웹툰·애니메이션 계열의 선명한 선과 polished digital rendering을 기반으로, 피부는 매끈하고 깨끗하게, 눈매와 헤어 디테일은 또렷하게 표현한다.",
  "남성 캐릭터의 성숙함과 남성성은 체격·목선·어깨·자세·시선·지휘감에서 전달하고, 얼굴은 romance-target으로서 정돈된 매력과 카드 가독성을 유지한다.",
  "의상·갑옷·보석·배경은 판타지 세계관을 풍부하게 보이게 하되 얼굴과 표정을 압도하지 않으며, 모바일 2:3 카드에서도 인물의 인상이 즉시 읽히게 한다.",
  "냉미·다정·유혹·권력 긴장처럼 캐릭터별 정서를 표정과 색 포인트로 분화하고, 동일한 얼굴형·헤어·팔레트로 포트폴리오가 수렴하지 않게 한다.",
].join("\n");

/** Style names that point at a specific artist/work are not visual attributes. */
const COPY_TARGET_RE = /(?:화풍\s*복제|그림체\s*복제|style of\s+\S+|in the style of|작가\s*풍|artist:|by\s+@)/i;

export function isGenerationSafeReference(reference: StyleReference | null | undefined): boolean {
  return reference?.provenance === "platform_owned" || reference?.provenance === "licensed";
}

/**
 * URLs the representative slot sends to the image provider as STYLE-ONLY references.
 * Appearance Lock remains the character identity owner — these images must never
 * override face/hair/outfit/age canon.
 */
export function resolveOfficialStyleGenerationReferences(
  seed: StyleReference | null | undefined
): string[] {
  if (!seed?.url.trim()) return [];
  const companions = (seed.styleOnlyVisualReferences ?? [])
    .map((ref) => ref.url.trim())
    .filter(Boolean);
  const urls: string[] = [];
  for (const url of [seed.url.trim(), ...companions]) {
    if (!urls.includes(url)) urls.push(url);
    if (urls.length >= OFFICIAL_STYLE_GENERATION_REF_MAX) break;
  }
  return urls;
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
  const companions = seed.styleOnlyVisualReferences ?? [];
  if (companions.length > OFFICIAL_STYLE_GENERATION_REF_MAX - 1) {
    return `at most ${OFFICIAL_STYLE_GENERATION_REF_MAX - 1} companion style-only references are allowed`;
  }
  for (const [index, ref] of companions.entries()) {
    if (!ref.url.trim()) return `styleOnlyVisualReferences[${index}] url is required`;
    if (!isGenerationSafeReference(ref)) {
      return `styleOnlyVisualReferences[${index}] must be platform-owned or licensed`;
    }
    if (ref.styleOnlyVisualReferences?.length) {
      return `styleOnlyVisualReferences[${index}] must not nest further companions`;
    }
  }
  if (resolveOfficialStyleGenerationReferences(seed).length > OFFICIAL_STYLE_GENERATION_REF_MAX) {
    return `style generation references exceed max ${OFFICIAL_STYLE_GENERATION_REF_MAX}`;
  }
  return null;
}
