/** Top-level JSON object key for GM narration streaming. */
const TOP_LEVEL_NARRATION_KEY = "narration";

type ObjectFrame = {
  /** True only for the root `{ ... }` object. */
  root: boolean;
  /** After `:` — next token is a property value. */
  afterColon: boolean;
  /** Root key name when `afterColon` is false and a key string just closed. */
  pendingRootKey: string | null;
};

type StringMode = "key" | "top_level_narration" | "skip";

export type GmStructuredStreamParserState = {
  /** Unprocessed tail from the latest provider chunk(s). */
  buffer: string;
  /** Narration text exposed to clients (never includes JSON syntax). */
  narration: string;
  /** True once top-level narration string value is closed. */
  narrationClosed: boolean;
  /** Container nesting depth (`{`/`[` minus `}`/`]`). */
  depth: number;
  /** Active object frames — one per unclosed `{`. */
  objectStack: ObjectFrame[];
  /** When set, scanner is inside a JSON string. */
  stringMode: StringMode | null;
  escape: boolean;
  unicodeRemaining: number;
  unicodeHex: string;
  /** Accumulates object key names while `stringMode === "key"`. */
  keyAcc: string;
};

export function createGmStructuredStreamParser(): GmStructuredStreamParserState {
  return {
    buffer: "",
    narration: "",
    narrationClosed: false,
    depth: 0,
    objectStack: [],
    stringMode: null,
    escape: false,
    unicodeRemaining: 0,
    unicodeHex: "",
    keyAcc: "",
  };
}

/** Incrementally parse structured JSON chunks; returns newly exposed narration suffix only. */
export function feedGmStructuredStreamParser(state: GmStructuredStreamParserState, chunk: string): string {
  if (!chunk || state.narrationClosed) return "";
  state.buffer += chunk;
  let emitted = "";
  while (state.buffer.length > 0) {
    const prevLen = emitted.length;
    const prevBufferLen = state.buffer.length;
    drainOne(state, (text) => {
      state.narration += text;
      emitted += text;
    });
    if (emitted.length === prevLen && state.buffer.length === prevBufferLen) break;
  }
  return emitted;
}

function drainOne(state: GmStructuredStreamParserState, emit: (text: string) => void): void {
  if (state.stringMode) {
    consumeStringChar(state, emit);
    return;
  }
  const ch = state.buffer[0]!;
  if (isWhitespace(ch)) {
    state.buffer = state.buffer.slice(1);
    return;
  }
  if (ch === "{") {
    state.buffer = state.buffer.slice(1);
    state.depth += 1;
    state.objectStack.push({ root: state.objectStack.length === 0, afterColon: false, pendingRootKey: null });
    return;
  }
  if (ch === "[") {
    state.buffer = state.buffer.slice(1);
    state.depth += 1;
    return;
  }
  if (ch === "}") {
    state.buffer = state.buffer.slice(1);
    state.depth = Math.max(0, state.depth - 1);
    if (state.objectStack.length > 0) state.objectStack.pop();
    return;
  }
  if (ch === "]") {
    state.buffer = state.buffer.slice(1);
    state.depth = Math.max(0, state.depth - 1);
    return;
  }
  if (ch === '"') {
    state.buffer = state.buffer.slice(1);
    state.stringMode = resolveStringMode(state);
    state.keyAcc = "";
    state.escape = false;
    state.unicodeRemaining = 0;
    state.unicodeHex = "";
    return;
  }
  if (ch === ":") {
    const frame = currentObjectFrame(state);
    if (frame && !frame.afterColon) {
      state.buffer = state.buffer.slice(1);
      frame.afterColon = true;
      return;
    }
    // Malformed JSON — hold until more context arrives.
    return;
  }
  if (ch === ",") {
    const frame = currentObjectFrame(state);
    if (frame?.afterColon) {
      state.buffer = state.buffer.slice(1);
      frame.afterColon = false;
      frame.pendingRootKey = null;
      return;
    }
    return;
  }
  // Unknown structural byte — skip to avoid deadlock on whitespace/noise variants.
  state.buffer = state.buffer.slice(1);
}

function currentObjectFrame(state: GmStructuredStreamParserState): ObjectFrame | null {
  return state.objectStack.length > 0 ? state.objectStack[state.objectStack.length - 1]! : null;
}

function resolveStringMode(state: GmStructuredStreamParserState): StringMode {
  const frame = currentObjectFrame(state);
  if (!frame) return "skip";
  if (!frame.afterColon) return "key";
  if (frame.root && frame.pendingRootKey === TOP_LEVEL_NARRATION_KEY) return "top_level_narration";
  return "skip";
}

function consumeStringChar(state: GmStructuredStreamParserState, emit: (text: string) => void): void {
  if (state.buffer.length === 0) return;
  const ch = state.buffer[0]!;
  state.buffer = state.buffer.slice(1);

  if (state.stringMode === "key") {
    if (state.escape) {
      state.escape = false;
      if (ch === "u") {
        state.unicodeRemaining = 4;
        state.unicodeHex = "";
        return;
      }
      state.keyAcc += decodeEscape(ch);
      return;
    }
    if (state.unicodeRemaining > 0) {
      state.unicodeHex += ch;
      state.unicodeRemaining -= 1;
      if (state.unicodeRemaining === 0) {
        const code = Number.parseInt(state.unicodeHex, 16);
        if (Number.isFinite(code)) state.keyAcc += String.fromCodePoint(code);
        state.unicodeHex = "";
      }
      return;
    }
    if (ch === "\\") {
      state.escape = true;
      return;
    }
    if (ch === '"') {
      closeKeyString(state);
      return;
    }
    state.keyAcc += ch;
    return;
  }

  // narration value or skipped string value
  if (state.escape) {
    state.escape = false;
    if (ch === "u") {
      state.unicodeRemaining = 4;
      state.unicodeHex = "";
      return;
    }
    const decoded = decodeEscape(ch);
    if (state.stringMode === "top_level_narration") emit(decoded);
    return;
  }
  if (state.unicodeRemaining > 0) {
    state.unicodeHex += ch;
    state.unicodeRemaining -= 1;
    if (state.unicodeRemaining === 0) {
      const code = Number.parseInt(state.unicodeHex, 16);
      if (Number.isFinite(code) && state.stringMode === "top_level_narration") {
        emit(String.fromCodePoint(code));
      }
      state.unicodeHex = "";
    }
    return;
  }
  if (ch === "\\") {
    state.escape = true;
    return;
  }
  if (ch === '"') {
    if (state.stringMode === "top_level_narration") {
      state.narrationClosed = true;
    }
    state.stringMode = null;
    const frame = currentObjectFrame(state);
    if (frame) frame.afterColon = true;
    return;
  }
  if (state.stringMode === "top_level_narration") emit(ch);
}

function closeKeyString(state: GmStructuredStreamParserState): void {
  const frame = currentObjectFrame(state);
  if (frame?.root && !frame.afterColon) {
    frame.pendingRootKey = state.keyAcc;
  }
  state.stringMode = null;
  state.keyAcc = "";
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
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

export function gmStructuredStreamParserComplete(state: GmStructuredStreamParserState): void {
  if (state.narrationClosed || state.stringMode !== "top_level_narration") return;
  // Provider ended mid-string — expose trailing buffer literally (no closing quote).
  if (state.buffer) {
    state.narration += state.buffer;
    state.buffer = "";
  }
}
