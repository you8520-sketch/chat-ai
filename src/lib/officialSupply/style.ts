import { isCharacterGenre } from "@/lib/characterGenres";
import {
  qaResult,
  type OfficialGenreStyle,
  type QaIssue,
  type QaResult,
  type StyleReference,
  type VisualStyleCandidate,
  type VisualStyleDna,
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

/**
 * Cluster B — graphic domestic rofan webtoon target (crisp lines, high contrast, saturated accents).
 * Applied only when the approved style seed declares `styleCluster: cluster_b_graphic`.
 */
export const ROFAN_CLUSTER_B_GRAPHIC_STYLE_DIRECTION = [
  "Prefer crisp, readable linework and graphic cel-shading over painterly blending or semi-realistic softness.",
  "Use stronger saturation and clean hue separation in the target character's canonical colors; the references demonstrate vivid accent handling, not a mandatory shared palette.",
  "Sharper youthful face readability on mobile cards — clean skin highlight structure, not muted beige-gold wash.",
  "Ornament and metal details should read as clear graphic silhouettes; backgrounds stay flatter and cleaner so the face wins.",
  "Avoid heavy mature realism, low-contrast noble haze, or soft airbrush that hides facial structure.",
].join(" ");

/** Structured DNA override for Cluster B representative generation (identity still from Appearance Lock). */
export const ROFAN_CLUSTER_B_VISUAL_STYLE_DNA: VisualStyleDna = {
  faceProportion: "샤프하고 또렷한 젊은 미형 비율, 작은 카드에서도 턱선·눈·코가 선명하게 읽히는 구조",
  eyeShape: "가늘고 긴 눈매, 선명한 속눈썹과 또렷한 캐치라이트, 강한 포인트 컬러로 감정이 즉시 읽히게",
  noseMouthDetail: "코·입은 얇고 깨끗한 선과 그래픽 음영, 과한 사실 텍스처나 번짐 없음",
  lineDensity: "high",
  rendering: "cel",
  skinRendering: "매끈한 피부에 작고 선명한 하이라이트, 부드러운 에어브러시 번짐보다 그래픽 명암",
  hairRendering: "빽빽한 가닥과 선명한 윤광 하이라이트, 큰 덩어리 실루엣 유지",
  bodyProportion: "8등신, 체격·어깨·목선으로 성숙함은 전달하되 얼굴은 젊고 깨끗한 인상",
  costumeComplexity: "high",
  palette: "Appearance Lock의 캐릭터 고유 색상을 그대로 유지하면서 색면 분리·명암 대비·포인트 채도를 선명하게 처리한다. 레퍼런스의 블랙·골드·레드·블루는 색 처리 방식의 예시이며 모든 캐릭터에 강제하는 공통 팔레트가 아니다.",
  lightSoftness: "hard",
  contrast: "high",
  backgroundDensity: "low",
  framing: "2:3 카드 상단 1/3 얼굴 우선, 배경은 단순·플랫",
  atmosphere: "국내 여성향 로판 웹툰풍 — 선명, 고대비, 그래픽, 얼굴-first",
};

/** Legacy v3 user-owned bundle paths that skew painterly / wrong cluster — must not enter Cluster B generation. */
export const CLUSTER_A_LEGACY_STYLE_REF_PATH_MARKERS = [
  "/romance-fantasy-user-owned-v1/primary/p1-face-rendering.webp",
  "/romance-fantasy-user-owned-v1/primary/p2-costume-material-female.webp",
  "/romance-fantasy-user-owned-v1/primary/p3-lighting-composition.webp",
  "/romance-fantasy-user-owned-v1/holdout/h1-overhead-pov.webp",
] as const;

/** Style names that point at a specific artist/work are not visual attributes. */
const COPY_TARGET_RE = /(?:화풍\s*복제|그림체\s*복제|style of\s+\S+|in the style of|작가\s*풍|artist:|by\s+@)/i;

export function isClusterBGraphicStyleSeed(seed: StyleReference | null | undefined): boolean {
  return seed?.styleCluster === "cluster_b_graphic";
}

export function resolveOfficialAssetStyleDna(
  candidateDna: VisualStyleDna,
  styleSeed: StyleReference | null | undefined
): VisualStyleDna {
  return isClusterBGraphicStyleSeed(styleSeed) ? ROFAN_CLUSTER_B_VISUAL_STYLE_DNA : candidateDna;
}

export function clusterBStyleReferenceUrlsContainLegacyClusterA(urls: readonly string[]): string | null {
  for (const url of urls) {
    for (const marker of CLUSTER_A_LEGACY_STYLE_REF_PATH_MARKERS) {
      if (url.includes(marker)) {
        return `cluster B generation must not include legacy Cluster A path ${marker}`;
      }
    }
  }
  return null;
}

export function validateClusterBStyleSeedForApproval(seed: StyleReference | null | undefined): string | null {
  const base = validateStyleSeedForApproval(seed);
  if (base) return base;
  if (!isClusterBGraphicStyleSeed(seed)) {
    return "cluster B proof requires styleCluster cluster_b_graphic on the approved seed";
  }
  const urls = resolveOfficialStyleGenerationReferences(seed);
  const legacy = clusterBStyleReferenceUrlsContainLegacyClusterA(urls);
  if (legacy) return legacy;
  const clusterRoot = "/romance-fantasy-cluster-b-v1/";
  if (!urls.every((url) => url.includes(clusterRoot))) {
    return "cluster B generation references must all come from romance-fantasy-cluster-b-v1";
  }
  return null;
}

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
