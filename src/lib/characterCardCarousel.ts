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
