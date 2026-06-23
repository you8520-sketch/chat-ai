/** 소개란 텍스트에서 이미지 URL 추출 */
export const IMAGE_URL_RE =
  /(?:https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s<>"']*)?|\/uploads\/[^\s<>"']+\.(?:png|jpe?g|gif|webp))/gi;

export type DescriptionBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string };

/** 텍스트와 이미지 URL을 순서대로 블록으로 분리 */
export function parseDescriptionBlocks(content: string): DescriptionBlock[] {
  if (!content.trim()) return [];

  /** `![alt](url)` 안의 URL은 분리하지 않음 — 잘린 `![이미지](` 잔여 방지 */
  const markdownImages: string[] = [];
  const protectedContent = content.replace(
    /!\[[^\]]*\]\(\s*(?:https?:\/\/[^)\s]+|\/uploads\/[^)\s]+)\s*\)/gi,
    (match) => {
      const token = `\u0000MDIMG${markdownImages.length}\u0000`;
      markdownImages.push(match);
      return token;
    }
  );

  const restoreMarkdownImages = (text: string): string => {
    let out = text;
    markdownImages.forEach((original, i) => {
      out = out.split(`\u0000MDIMG${i}\u0000`).join(original);
    });
    return out;
  };

  const blocks: DescriptionBlock[] = [];
  let last = 0;
  const re = new RegExp(IMAGE_URL_RE.source, "gi");

  for (const m of protectedContent.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      const text = restoreMarkdownImages(protectedContent.slice(last, idx)).trim();
      if (text) blocks.push({ kind: "text", text });
    }
    blocks.push({ kind: "image", url: m[0] });
    last = idx + m[0].length;
  }

  const tail = restoreMarkdownImages(protectedContent.slice(last)).trim();
  if (tail) blocks.push({ kind: "text", text: tail });
  if (blocks.length === 0) blocks.push({ kind: "text", text: content });

  return blocks;
}
