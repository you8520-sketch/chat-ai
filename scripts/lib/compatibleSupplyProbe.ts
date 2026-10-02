/** Single SSE reader for supplier qualification; never imported by production. */
export type ProbeJson = Record<string, unknown>;
export type SupplyStreamState = {
  text: string;
  finishReason: string | null;
  usage: ProbeJson | null;
  resolvedModel: string | null;
  generationId: string | null;
  firstDeltaAtMs: number | null;
  sawDone: boolean;
  envelope?: ProbeJson;
};

export function processCompatibleSupplySseLine(
  line: string,
  state: SupplyStreamState,
  nowMs = Date.now(),
  strict = false
): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data) return;
  if (data === "[DONE]") { state.sawDone = true; return; }
  let event: ProbeJson;
  try {
    event = JSON.parse(data);
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error();
  } catch {
    if (strict) throw new Error("malformed_stream");
    return;
  }
  if (strict && state.sawDone) throw new Error("event_after_done");
  if (strict && event.error != null) throw new Error("provider_stream_error");
  state.envelope = { ...state.envelope, ...event };
  if (typeof event.id === "string") state.generationId = event.id;
  if (typeof event.model === "string") state.resolvedModel = event.model;
  if (event.usage && typeof event.usage === "object" && !Array.isArray(event.usage)) {
    state.usage = strict ? { ...state.usage, ...event.usage as ProbeJson } : event.usage as ProbeJson;
    if (strict) state.envelope.usage = state.usage;
  }
  const choice = Array.isArray(event.choices) ? event.choices[0] : undefined;
  const content = typeof choice?.delta?.content === "string"
    ? choice.delta.content
    : typeof choice?.message?.content === "string" ? choice.message.content : "";
  if (content) {
    if (state.firstDeltaAtMs == null) state.firstDeltaAtMs = nowMs;
    state.text += content;
  }
  if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }
}

async function readWithSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal.throwIfAborted();
  let abort!: () => void;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally { signal.removeEventListener("abort", abort); }
}

export async function executeCompatibleSupplyProbe(input: {
  endpoint: string;
  headers: Record<string, string>;
  body: ProbeJson;
  timeoutMs: number;
  signal?: AbortSignal;
  strict?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const started = now();
  const state: SupplyStreamState = {
    text: "", finishReason: null, usage: null, resolvedModel: null,
    generationId: null, firstDeltaAtMs: null, sawDone: false,
  };
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
  let httpStatus = 0;
  let requestStarted = false;
  let error: string | null = null;
  let responseHeaders: Headers | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let completed = false;
  try {
    signal.throwIfAborted();
    requestStarted = true;
    const response = await (input.fetchImpl ?? fetch)(input.endpoint, {
      method: "POST", headers: input.headers, body: JSON.stringify(input.body), signal,
    });
    httpStatus = response.status;
    responseHeaders = response.headers;
    if (!response.ok) {
      error = input.strict ? `http_${response.status}` : (await response.text()).slice(0, 2000);
      if (input.strict) void response.body?.cancel().catch(() => {});
    } else {
      if (input.strict && response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/event-stream") {
        throw new Error("unexpected_content_type");
      }
      reader = response.body?.getReader();
      if (!reader) throw new Error("missing_stream_body");
      const decoder = new TextDecoder();
      let buffer = "";
      let bytes = 0;
      const processLine = (line: string) => processCompatibleSupplySseLine(line, state, now(), input.strict);
      while (true) {
        const { done, value } = await readWithSignal(reader, signal);
        if (done) break;
        bytes += value.byteLength;
        if (input.strict && bytes > 8_000_000) throw new Error("stream_limit_exceeded");
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) processLine(buffer);
      completed = true;
      if (input.strict && (!state.sawDone || !state.finishReason || !state.text.trim())) {
        error = "incomplete_stream";
      }
    }
  } catch (caught) {
    error = signal.aborted ? (timeout.aborted ? "timeout" : "cancelled")
      : caught instanceof Error ? caught.message : "transport_error";
  } finally {
    if (reader) {
      if (!completed) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const totalSeconds = Math.max(0, (now() - started) / 1000);
  const ttftSeconds = state.firstDeltaAtMs == null ? null : Math.max(0, (state.firstDeltaAtMs - started) / 1000);
  return {
    ...state, httpStatus, requestStarted, error, responseHeaders, totalSeconds, ttftSeconds,
    visibleChars: state.text.length,
    visibleCharsPerSecondAfterTtft: ttftSeconds == null ? null
      : state.text.length / Math.max(0.001, totalSeconds - ttftSeconds),
  };
}
