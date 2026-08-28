/**
 * Single source of truth for character asset vision moderation policy.
 *
 * Three tiers (both NSFW and all-ages public listing):
 * 1. reject=true  — hard reject (female nipples, genitals) → private / block asset
 * 2. adult=true   — ambiguous suggestive → admin pending queue
 * 3. both false   — auto approve
 */

import { ASSET_PERSON_TAGS } from "@/lib/assetPersonTags";

export const ASSET_VISION_REJECT_RULES = `- reject=true (하드 반려): 여성 유두(젖꼭지)가 명확히 보임, 남성·여성 성기·항문 노출, 미성년 성적 묘사, 삽입·구강성교 등 직접 성행위, 불법촬영·학대·고어
- reject=false: 유두·성기·항문이 명확하지 않으면 반려하지 말 것`;

export const ASSET_VISION_REVIEW_RULES = `- adult=true (관리자 검수): 선정성이 애매함 — 유두·성기·항문은 보이지 않지만 전면 노출·선정적 포즈·속옷·젖은 상의·키스·엉덩 강조 등 경계 케이스. reject=false일 때만 adult=true
- adult=false: 명확히 무방 — 일상·표정·전신 옷·후면 등짝·뒤돌아섬(유두·성기·항문 비노출)`;

const PERSON_TAG_LIST = ASSET_PERSON_TAGS.join(", ");

export function buildAssetVisionPrompt(): string {
  return `너는 캐릭터/배경 에셋 분류기다. 첨부 이미지를 직접 보고 JSON Schema에 맞게만 응답한다.

TASK 1 — IMAGE TYPE
- 사람 또는 캐릭터가 한 명이라도 보이면 imageType="person".
- 한 명도 없으면 imageType="background".
- 배경이 아무리 눈에 띄어도 인물이 있으면 person이다.

TASK 2 — TAG (moderation과 별개)
PERSON (imageType=person):
- personTag: 아래 PERSON_TAGS 중 정확히 하나만 선택한다. backgroundTag=null.
- 우선순위: (1) 명확한 얼굴 표정/감정 (2) 눈에 띄는 자세/행동 (3) 전체적인 인물 분위기 (4) 애매하면 "무표정".
- PERSON tag에는 옷, 헤어, 성별, 신체, 장소, 배경, 소품, 무기, 색상, 조명, 카메라, 화풍, 품질 정보를 절대 사용하지 않는다.

PERSON_TAGS:
${PERSON_TAG_LIST}

BACKGROUND (imageType=background):
- personTag=null. backgroundTag: 장소/환경을 나타내는 짧은 한국어 명사구 한 개 (2~10자 권장, 최대 12자).
- 쉼표, 슬래시, 문장, 조명/색감/화풍/카메라 표현 금지.
- 예: 침실, 교실, 카페, 도시 거리, 도시 야경, 숲, 해변

TASK 3 — MODERATION (tag와 별개 판정)
- 선정성/노출 정보는 moderation 판단에만 사용하고 asset tag에는 사용하지 않는다.

하드 반려(reject):
${ASSET_VISION_REJECT_RULES}

관리자 검수(adult):
${ASSET_VISION_REVIEW_RULES}

성인용·일반용 공통: reject=하드 반려, adult=애매한 선정성, 나머지는 adult=false·reject=false.
reason은 moderation 검토용 한국어 한 줄(160자 이내).`;
}

/** Hard reject — female nipples or genitals (blocks upload for all-ages). */
export function isAssetHardRejected(asset: { moderationReject?: boolean }): boolean {
  return asset.moderationReject === true;
}

/** Ambiguous suggestive — admin review queue (does not block upload). */
export function isAssetNeedsAdminReview(asset: {
  adultFlagged?: boolean;
  moderationReject?: boolean;
}): boolean {
  return asset.adultFlagged === true && asset.moderationReject !== true;
}
