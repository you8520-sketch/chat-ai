/** 공개 상세 소개 — 접힘 시 전체 렌더 높이 대비 표시 비율 (이미지·텍스트 혼합 포함) */
export const CHARACTER_DESCRIPTION_PREVIEW_RATIO = 0.25;

/** 전체 높이가 이보다 작으면 펼치기 UI 생략 */
export const CHARACTER_DESCRIPTION_COLLAPSE_MIN_HEIGHT_PX = 120;

export function resolveDescriptionCollapsedMaxHeight(
  fullHeightPx: number,
  ratio = CHARACTER_DESCRIPTION_PREVIEW_RATIO
): number {
  return Math.max(0, fullHeightPx * ratio);
}

export function descriptionNeedsExpand(
  fullHeightPx: number,
  minFullHeight = CHARACTER_DESCRIPTION_COLLAPSE_MIN_HEIGHT_PX
): boolean {
  return fullHeightPx > minFullHeight;
}
