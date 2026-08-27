export type GmSseDataHandler = (payload: unknown) => void;

/** Process SSE bytes; supports CRLF, split JSON lines, and EOF tail without trailing newline. */
export function feedGmProviderSseBytes(
  state: { buffer: string },
  chunk: string,
  onData: GmSseDataHandler,
  eof = false
): void {
  state.buffer += chunk;
  drainGmProviderSseBuffer(state, onData, eof);
}

function drainGmProviderSseBuffer(
  state: { buffer: string },
  onData: GmSseDataHandler,
  eof: boolean
): void {
  while (true) {
    const newline = findSseLineBreak(state.buffer);
    if (newline < 0) {
      if (eof && state.buffer.trim()) {
        consumeSseLine(state.buffer.trim(), onData);
        state.buffer = "";
      }
      return;
    }
    const line = state.buffer.slice(0, newline);
    state.buffer = state.buffer.slice(newline + lineBreakWidth(state.buffer, newline));
    consumeSseLine(line.replace(/\r$/, "").trim(), onData);
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

function consumeSseLine(line: string, onData: GmSseDataHandler): void {
  if (!line.startsWith("data:")) return;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return;
  try {
    onData(JSON.parse(data) as unknown);
  } catch {
    // ignore malformed SSE JSON
  }
}
