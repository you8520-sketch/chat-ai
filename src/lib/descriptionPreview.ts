export const CHARACTER_DESCRIPTION_PREVIEW_CHARS = 500;

/** 공개 상세 소개 접기 — 문단·줄 경계 우선 */
export function truncateDescriptionPreview(
  content: string,
  maxChars = CHARACTER_DESCRIPTION_PREVIEW_CHARS
): { preview: string; needsExpand: boolean } {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length <= maxChars) {
    return { preview: trimmed, needsExpand: false };
  }

  let cut = maxChars;
  const slice = trimmed.slice(0, maxChars);
  const lastPara = slice.lastIndexOf("\n\n");
  const lastLine = slice.lastIndexOf("\n");
  const lastBreak = Math.max(lastPara, lastLine);
  if (lastBreak >= maxChars * 0.55) {
    cut = lastBreak;
  } else {
    const lastSpace = slice.lastIndexOf(" ");
    if (lastSpace >= maxChars * 0.65) cut = lastSpace;
  }

  return {
    preview: trimmed.slice(0, cut).trimEnd(),
    needsExpand: true,
  };
}
