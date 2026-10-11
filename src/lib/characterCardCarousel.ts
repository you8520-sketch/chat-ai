export const CARD_CAROUSEL_INTERVAL_MS = 1000;

export function nextCarouselIndex(current: number, length: number): number {
  if (length <= 1) return 0;
  return (current + 1) % length;
}

export function shouldRunCarousel(input: {
  urlCount: number;
  reducedMotion: boolean;
  hovering: boolean;
  focused: boolean;
  visible: boolean;
  documentVisible: boolean;
}): boolean {
  return (
    input.urlCount > 1 &&
    !input.reducedMotion &&
    !input.hovering &&
    !input.focused &&
    input.visible &&
    input.documentVisible
  );
}

/** 로딩에 실패한 URL은 회전 후보에서 뺀다. 재시도하지 않는다. */
export function usableCarouselUrls(urls: readonly string[], failed: ReadonlySet<string>): string[] {
  return urls.filter((url) => !failed.has(url));
}
