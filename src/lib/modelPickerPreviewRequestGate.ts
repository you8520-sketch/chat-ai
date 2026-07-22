/** Monotonic request gate — only the latest preview fetch may commit UI state. */
export function createModelPickerPreviewRequestGate() {
  let latestSeq = 0;
  return {
    next(): number {
      latestSeq += 1;
      return latestSeq;
    },
    isLatest(requestSeq: number): boolean {
      return requestSeq === latestSeq;
    },
    latest(): number {
      return latestSeq;
    },
  };
}
