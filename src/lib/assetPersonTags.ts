/**
 * Canonical person-image tag taxonomy for asset vision classification.
 * Single owner — prompt, schema, validation, and UI recommendations must import from here.
 */

export const ASSET_PERSON_TAGS = [
  // 표정 / 감정
  "무표정",
  "미소",
  "웃음",
  "기쁨",
  "슬픔",
  "울음",
  "분노",
  "짜증",
  "당황",
  "부끄러움",
  "놀람",
  "공포",
  "긴장",
  "진지함",
  "의심",
  "피곤함",
  // 눈에 띄는 자세 / 행동
  "서있음",
  "앉음",
  "누움",
  "기대기",
  "웅크림",
  "뒤돌아봄",
  "걷기",
  "달리기",
  "전투자세",
  // 분위기 (표정/자세보다 분위기가 더 명확할 때)
  "일상",
  "로맨틱",
  "몽환",
] as const;

export type AssetPersonTag = (typeof ASSET_PERSON_TAGS)[number];

export type AssetVisionImageType = "person" | "background";

export type AssetVisionStructuredResult = {
  imageType: AssetVisionImageType;
  personTag: AssetPersonTag | null;
  backgroundTag: string | null;
  adult: boolean;
  reject: boolean;
  reason: string;
};

const PERSON_TAG_SET = new Set<string>(ASSET_PERSON_TAGS);

export function isAssetPersonTag(value: string): value is AssetPersonTag {
  return PERSON_TAG_SET.has(value);
}

/** Obvious non-place visual/meta descriptors — conservative substring guard. */
const BACKGROUND_META_DESCRIPTOR_TERMS = [
  "역광",
  "조명",
  "색감",
  "화풍",
  "스타일",
  "고화질",
  "저화질",
  "클로즈업",
  "전신샷",
  "구도",
  "앵글",
  "렌즈",
  "보케",
  "블러",
  "분위기",
] as const;

const BACKGROUND_META_DESCRIPTOR_LATIN = [
  /high\s*quality/i,
  /low\s*quality/i,
  /close\s*up/i,
  /bokeh/i,
  /\bblur\b/i,
] as const;

/** Canonical background place-tag normalizer (syntactic + semantic guard). */
export function normalizeBackgroundTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim();
  if (!tag || tag.length > 12) return null;
  if (/[,/\n]/.test(tag)) return null;
  if (/[.!?。]/.test(tag)) return null;
  if (/\s{2,}/.test(tag)) return null;
  if (!/[\uAC00-\uD7A3]/.test(tag)) return null;
  for (const term of BACKGROUND_META_DESCRIPTOR_TERMS) {
    if (tag.includes(term)) return null;
  }
  for (const pattern of BACKGROUND_META_DESCRIPTOR_LATIN) {
    if (pattern.test(tag)) return null;
  }
  return tag;
}

export function validateStructuredAssetVisionResult(
  raw: unknown
): AssetVisionStructuredResult | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const imageType = row.imageType;
  if (imageType !== "person" && imageType !== "background") return null;
  if (typeof row.adult !== "boolean" || typeof row.reject !== "boolean") return null;
  const reason =
    typeof row.reason === "string" ? row.reason.trim().slice(0, 160) : "";

  if (imageType === "person") {
    if (typeof row.personTag !== "string" || !isAssetPersonTag(row.personTag.trim())) {
      return null;
    }
    return {
      imageType: "person",
      personTag: row.personTag.trim() as AssetPersonTag,
      backgroundTag: null,
      adult: row.adult,
      reject: row.reject,
      reason,
    };
  }

  const backgroundTag = normalizeBackgroundTag(row.backgroundTag);
  if (!backgroundTag) return null;
  return {
    imageType: "background",
    personTag: null,
    backgroundTag,
    adult: row.adult,
    reject: row.reject,
    reason,
  };
}

/** Derive persisted/API `tag` from validated structured vision output. */
export function deriveFinalAssetTag(result: AssetVisionStructuredResult): string {
  if (result.imageType === "person") {
    return result.personTag ?? "무표정";
  }
  return result.backgroundTag ?? "배경";
}

export function buildAssetVisionJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      imageType: { type: "string", enum: ["person", "background"] },
      personTag: {
        anyOf: [{ type: "string", enum: [...ASSET_PERSON_TAGS] }, { type: "null" }],
      },
      backgroundTag: { anyOf: [{ type: "string" }, { type: "null" }] },
      adult: { type: "boolean" },
      reject: { type: "boolean" },
      reason: { type: "string" },
    },
    required: [
      "imageType",
      "personTag",
      "backgroundTag",
      "adult",
      "reject",
      "reason",
    ],
    additionalProperties: false,
  };
}
