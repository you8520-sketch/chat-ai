const NARRATION_KEY = '"narration"';

export type GmStructuredStreamParserState = {
  /** Raw provider buffer for incremental key/value discovery. */
  buffer: string;
  /** Narration text exposed to clients (never includes JSON syntax). */
  narration: string;
  /** True once narration string value is closed — no further narration is emitted. */
  narrationClosed: boolean;
  /** Internal scan phase within the narration string extractor. */
  phase: "seek_key" | "seek_value_quote" | "in_string" | "done";
  /** Escape / unicode handling while inside narration string. */
  escape: boolean;
  unicodeRemaining: number;
  unicodeHex: string;
};

export function createGmStructuredStreamParser(): GmStructuredStreamParserState {
  return {
    buffer: "",
    narration: "",
    narrationClosed: false,
    phase: "seek_key",
    escape: false,
    unicodeRemaining: 0,
    unicodeHex: "",
  };
}

/** Incrementally parse structured JSON chunks; returns newly exposed narration suffix only. */
export function feedGmStructuredStreamParser(state: GmStructuredStreamParserState, chunk: string): string {
  if (!chunk || state.narrationClosed) return "";
  state.buffer += chunk;
  let emitted = "";

  while (state.phase !== "done") {
    if (state.buffer.length === 0) break;
    if (state.phase === "seek_key") {
      const idx = state.buffer.indexOf(NARRATION_KEY);
      if (idx < 0) {
        state.buffer = holdPartialSuffix(state.buffer, NARRATION_KEY);
        break;
      }
      state.buffer = state.buffer.slice(idx + NARRATION_KEY.length);
      state.phase = "seek_value_quote";
      continue;
    }

    if (state.phase === "seek_value_quote") {
      const quoteIdx = state.buffer.indexOf('"');
      if (quoteIdx < 0) {
        state.buffer = "";
        break;
      }
      state.buffer = state.buffer.slice(quoteIdx + 1);
      state.phase = "in_string";
      state.escape = false;
      state.unicodeRemaining = 0;
      state.unicodeHex = "";
      continue;
    }

    if (state.phase === "in_string") {
      let i = 0;
      while (i < state.buffer.length) {
        const ch = state.buffer[i]!;
        if (state.unicodeRemaining > 0) {
          state.unicodeHex += ch;
          state.unicodeRemaining -= 1;
          i += 1;
          if (state.unicodeRemaining === 0) {
            const code = Number.parseInt(state.unicodeHex, 16);
            if (Number.isFinite(code)) {
              const decoded = String.fromCodePoint(code);
              state.narration += decoded;
              emitted += decoded;
            }
            state.unicodeHex = "";
          }
          continue;
        }
        if (state.escape) {
          state.escape = false;
          if (ch === "u") {
            state.unicodeRemaining = 4;
            state.unicodeHex = "";
            i += 1;
            continue;
          }
          const decoded = decodeEscape(ch);
          state.narration += decoded;
          emitted += decoded;
          i += 1;
          continue;
        }
        if (ch === "\\") {
          state.escape = true;
          i += 1;
          continue;
        }
        if (ch === '"') {
          state.buffer = state.buffer.slice(i + 1);
          state.phase = "done";
          state.narrationClosed = true;
          break;
        }
        state.narration += ch;
        emitted += ch;
        i += 1;
      }
      if (state.phase === "in_string") {
        state.buffer = state.buffer.slice(i);
      }
      break;
    }
  }

  return emitted;
}

function decodeEscape(ch: string): string {
  switch (ch) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case '"':
      return '"';
    case "\\":
      return "\\";
    case "/":
      return "/";
    case "b":
      return "\b";
    case "f":
      return "\f";
    default:
      return ch;
  }
}

function holdPartialSuffix(text: string, marker: string): string {
  const max = Math.min(marker.length - 1, text.length);
  for (let n = max; n > 0; n -= 1) {
    if (marker.startsWith(text.slice(-n))) return text.slice(-n);
  }
  return "";
}

export function gmStructuredStreamParserComplete(state: GmStructuredStreamParserState): void {
  if (state.phase === "done" || state.narrationClosed) return;
  if (state.phase !== "in_string") return;
  const tail = state.buffer;
  state.buffer = "";
  if (!tail) return;
  let emitted = "";
  for (const ch of tail) {
    if (state.escape) {
      state.escape = false;
      if (ch === "u") continue;
      const decoded = decodeEscape(ch);
      state.narration += decoded;
      emitted += decoded;
      continue;
    }
    if (ch === "\\") {
      state.escape = true;
      continue;
    }
    if (ch === '"') {
      state.narrationClosed = true;
      state.phase = "done";
      break;
    }
    state.narration += ch;
    emitted += ch;
  }
  void emitted;
}
