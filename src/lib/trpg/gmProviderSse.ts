export type GmSseDataHandler = (payload: unknown) => void;

/** Process SSE bytes; supports CRLF, split JSON lines, and EOF tail without trailing newline. */
export function feedGmProviderSseBytes(
  state: { buffer: string },
  chunk: string,
  onData: GmSseDataHandler,
  eof = false
): boolean {
  state.buffer += chunk;
  return drainGmProviderSseBuffer(state, onData, eof);
}

function drainGmProviderSseBuffer(
  state: { buffer: string },
  onData: GmSseDataHandler,
  eof: boolean
): boolean {
  let done = false;
  while (true) {
    const newline = findSseLineBreak(state.buffer);
    if (newline < 0) {
      if (eof && state.buffer.trim()) {
        done = consumeSseLine(state.buffer.trim(), onData) || done;
        state.buffer = "";
      }
      return done;
    }
    const line = state.buffer.slice(0, newline);
    state.buffer = state.buffer.slice(newline + lineBreakWidth(state.buffer, newline));
    done = consumeSseLine(line.replace(/\r$/, "").trim(), onData) || done;
    if (done) return true;
  }
}

function findSseLineBreak(buffer: string): number {
  const lf = buffer.indexOf("\n");
  const cr = buffer.indexOf("\r");
  if (lf < 0) return cr;
  if (cr < 0) return lf;
  return Math.min(lf, cr);
}

function lineBreakWidth(buffer: string, index: number): number {
  if (buffer[index] === "\r" && buffer[index + 1] === "\n") return 2;
  return 1;
}

function consumeSseLine(line: string, onData: GmSseDataHandler): boolean {
  if (!line.startsWith("data:")) return false;
  const data = line.slice(5).trim();
  if (!data) return false;
  if (data === "[DONE]") return true;
  try {
    onData(JSON.parse(data) as unknown);
  } catch {
    // ignore malformed SSE JSON
  }
  return false;
}
