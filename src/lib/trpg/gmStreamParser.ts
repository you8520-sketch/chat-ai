import { TRPG_GM_DELTA_OPEN, TRPG_GM_NARRATION_OPEN } from "./gmPrompt";

const NARRATION_OPEN = TRPG_GM_NARRATION_OPEN;
const DELTA_OPEN = TRPG_GM_DELTA_OPEN;

export type GmStreamParserState = {
  /** Raw provider buffer not yet classified. */
  buffer: string;
  /** Whether NARRATION marker has been found and consumed. */
  narrationOpen: boolean;
  /** Narration text exposed to clients (never includes markers or DELTA). */
  narration: string;
  /** True once DELTA marker begins — no further narration is emitted. */
  deltaSeen: boolean;
};

export function createGmStreamParser(): GmStreamParserState {
  return { buffer: "", narrationOpen: false, narration: "", deltaSeen: false };
}

/** Incrementally parse provider chunks; returns newly exposed narration suffix only. */
export function feedGmStreamParser(state: GmStreamParserState, chunk: string): string {
  if (!chunk || state.deltaSeen) return "";
  state.buffer += chunk;
  let emitted = "";

  if (!state.narrationOpen) {
    const idx = state.buffer.indexOf(NARRATION_OPEN);
    if (idx < 0) {
      // Hold partial marker prefix at end of buffer.
      const hold = partialMarkerHold(state.buffer, NARRATION_OPEN);
      if (hold > 0) state.buffer = state.buffer.slice(-hold);
      else state.buffer = "";
      return "";
    }
    state.buffer = state.buffer.slice(idx + NARRATION_OPEN.length);
    state.narrationOpen = true;
  }

  while (!state.deltaSeen && state.buffer.length > 0) {
    const deltaIdx = state.buffer.indexOf(DELTA_OPEN);
    if (deltaIdx >= 0) {
      const slice = state.buffer.slice(0, deltaIdx);
      if (slice) {
        state.narration += slice;
        emitted += slice;
      }
      state.deltaSeen = true;
      state.buffer = "";
      break;
    }
    const hold = partialMarkerHold(state.buffer, DELTA_OPEN);
    const safeLen = state.buffer.length - hold;
    if (safeLen <= 0) break;
    const slice = state.buffer.slice(0, safeLen);
    state.buffer = state.buffer.slice(safeLen);
    state.narration += slice;
    emitted += slice;
  }

  return emitted;
}

function partialMarkerHold(text: string, marker: string): number {
  const max = Math.min(marker.length - 1, text.length);
  for (let n = max; n > 0; n -= 1) {
    if (marker.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

export function gmStreamParserComplete(state: GmStreamParserState): void {
  if (state.deltaSeen || !state.narrationOpen) return;
  const tail = state.buffer;
  state.buffer = "";
  if (tail) {
    state.narration += tail;
  }
}
