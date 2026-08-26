/**
 * Single source of truth for character asset vision moderation policy.
 *
 * Three tiers (both NSFW and all-ages public listing):
 * 1. reject=true  — hard reject (female nipples, genitals) → private / block asset
 * 2. adult=true   — ambiguous suggestive → admin pending queue
 * 3. both false   — auto approve
 */

export const ASSET_VISION_REJECT_RULES = `- reject=true (하드 반려): 여성 유두(젖꼭지)가 명확히 보임, 남성·여성 성기·항문 노출, 미성년 성적 묘사, 삽입·구강성교 등 직접 성행위, 불법촬영·학대·고어
- reject=false: 유두·성기·항문이 명확하지 않으면 반려하지 말 것`;

export const ASSET_VISION_REVIEW_RULES = `- adult=true (관리자 검수): 선정성이 애매함 — 유두·성기·항문은 보이지 않지만 전면 노출·선정적 포즈·속옷·젖은 상의·키스·엉덩 강조 등 경계 케이스. reject=false일 때만 adult=true
- adult=false: 명확히 무방 — 일상·표정·전신 옷·후면 등짝·뒤돌아섬(유두·성기·항문 비노출)`;

export function buildAssetVisionPrompt(): string {
  return `너는 캐릭터 일러스트 이미지 분석기다.
첨부된 이미지를 직접 보고, 그 이미지에 실제로 보이는 표정·자세·상황만 짧은 한국어 태그 하나로 요약한다.

필수:
- 반드시 첨부 이미지의 시각 정보(얼굴 표정, 몸의 자세, 배경/장소, 소품)에만 근거한다.
- 이미지에 없는 표정·장소·행동을 상상하거나 만들어 내지 않는다.

좋은 예: 기쁨, 슬픔, 부끄러움, 대화, 등짝, 뒤돌아섬, 젖은 상의, 침실
태그는 2~12자 내외.

하드 반려(reject):
${ASSET_VISION_REJECT_RULES}

관리자 검수(adult) — 애매한 선정성:
${ASSET_VISION_REVIEW_RULES}

성인용·일반용 공통: reject=하드 반려 규칙, adult=애매한 선정성, 나머지는 adult=false·reject=false.

결과는 JSON만:
{ "tag": "태그명", "adult": true|false, "reject": true|false, "reason": "한국어 한 줄" }`;
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
