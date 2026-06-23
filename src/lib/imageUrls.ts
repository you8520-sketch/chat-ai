/** 줄바꿈·쉼표로 구분된 이미지 URL 목록 파싱 */
export function parseImageUrls(input: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of input.split(/[\n,]+/)) {
    const url = part.trim();
    if (!url || seen.has(url)) continue;
    if (url.startsWith("http") || url.startsWith("/uploads/")) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}
