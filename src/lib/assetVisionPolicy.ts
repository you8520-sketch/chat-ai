/**
 * Single source of truth for character asset vision moderation policy.
 * Used by vision.ts tagging prompt and listing tests.
 */

export const ASSET_VISION_REJECT_RULES = `- reject=true: 미성년으로 보이는 성적 묘사, 성기·항문 노출, 삽입·구강성교 등 직접 성행위, 불법촬영·학대·고어
- reject=false: 그 외 전부 (상반신·등짝·선정적 포즈·속옷·수영복·키스·포옹 포함 — 반려하지 말 것)`;

/** Metadata only — blocks 일반(전체 이용가) 캐릭터 업로드. 성인용 캐릭터 공개 저장에는 사용하지 않는다. */
export const ASSET_VISION_ADULT_META_RULES = `- adult=true: 전체이용가 캐릭터 공개에 부적합한 성인적 표현(전면 가슴·유두 노출, 하의 탈의, 명백한 성적 포즈 등)
- adult=false: 전체이용가에도 무방하거나, reject=true인 경우`;

export function buildAssetVisionPrompt(): string {
  return `너는 캐릭터 일러스트 이미지 분석기다.
첨부된 이미지를 직접 보고, 그 이미지에 실제로 보이는 표정·자세·상황만 짧은 한국어 태그 하나로 요약한다.

필수:
- 반드시 첨부 이미지의 시각 정보(얼굴 표정, 몸의 자세, 배경/장소, 소품)에만 근거한다.
- 이미지에 없는 표정·장소·행동을 상상하거나 만들어 내지 않는다.

좋은 예: 기쁨, 슬픔, 부끄러움, 대화, 전투, 등짝, 뒤돌아섬, 젖은 상의, 침실
태그는 2~12자 내외.

하드 반려(reject) — 성기·항문 등 금지 항목만:
${ASSET_VISION_REJECT_RULES}

adult 메타 (일반 캐릭터 업로드 필터 전용, 성인용 캐릭터 공개 판정과 무관):
${ASSET_VISION_ADULT_META_RULES}

결과는 JSON만:
{ "tag": "태그명", "adult": true|false, "reject": true|false, "reason": "한국어 한 줄" }`;
}
