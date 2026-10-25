/**
 * Audit-only SSE collector aligned to production streamOpenRouterAdult parse
 * (src/lib/openRouterAdult.ts extractOpenRouterStreamDelta / streamContentToText).
 *
 * Differences from production (intentional, evidence-only):
 * - Records [DONE] instead of silently skipping it
 * - Flushes leftover line buffer after reader.done (production leaves it)
 * - No empty-retry, failover, degeneration abort, loop abort, or length cap
 * - Does not invent finishReason
 */
export type CollectedSse = {
  text: string;
  HTTP_STATUS: number;
  SSE_DONE_OBSERVED: boolean;
  FINISH_REASON: string | null;
  USAGE_PRESENT: boolean;
  usage: Record<string, unknown> | null;
  RAW_CHARS: number;
  COLLECTOR_ERROR: string | null;
  leftover_flushed: boolean;
};

function streamContentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(streamContentToText).join("");
  if (typeof content === "object") {
    const o = content as { text?: unknown; content?: unknown };
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
    if (o.content != null) return streamContentToText(o.content);
  }
  return "";
}

function extractOpenRouterStreamDelta(choice: {
  delta?: {
    content?: string | unknown[] | null;
    text?: string | null;
  };
  message?: { content?: string | unknown[] | null };
  text?: string | null;
}): string {
  const delta = choice.delta;
  if (delta?.content != null) {
    const fromContent = streamContentToText(delta.content);
    if (fromContent) return fromContent;
  }
  if (delta?.text) return delta.text;
  if (choice.message?.content != null) {
    const fromMessage = streamContentToText(choice.message.content);
    if (fromMessage) return fromMessage;
  }
  if (choice.text) return choice.text;
  return "";
}

export function parseSseLine(
  line: string,
  state: {
    text: string;
    finish: string | null;
    usage: Record<string, unknown> | null;
    sawDone: boolean;
  }
): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return;
  if (!trimmed.startsWith("data:")) return;
  const payload = trimmed.slice(5).trim();
  if (!payload) return;
  if (payload === "[DONE]") {
    state.sawDone = true;
    return;
  }
  let json: {
    choices?: Array<{
      delta?: { content?: unknown; text?: string | null };
      message?: { content?: unknown };
      text?: string | null;
      finish_reason?: string | null;
    }>;
    usage?: Record<string, unknown>;
  };
  try {
    json = JSON.parse(payload);
  } catch {
    return;
  }
  const choice = json.choices?.[0];
  if (choice) {
    if (choice.finish_reason) state.finish = choice.finish_reason;
    const delta = extractOpenRouterStreamDelta(choice);
    if (delta) state.text += delta;
  }
  if (json.usage && typeof json.usage === "object") {
    state.usage = json.usage;
  }
}

export function parseSseBody(rawBody: string): {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  sawDone: boolean;
} {
  const state = { text: "", finish: null as string | null, usage: null as Record<string, unknown> | null, sawDone: false };
  for (const line of rawBody.split(/\r?\n/)) parseSseLine(line, state);
  return state;
}

export function evaluateStreamComplete(opts: {
  httpStatus: number;
  sawDone: boolean;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  text: string;
  collectorError: string | null;
}): boolean {
  if (opts.collectorError) return false;
  if (opts.httpStatus !== 200) return false;
  if (!opts.text.trim()) return false;
  const terminal = opts.sawDone || Boolean(opts.finishReason);
  if (!terminal) return false;
  if (!opts.usage) return false;
  return true;
}

export async function collectProductionAlignedSse(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs = 240_000
): Promise<CollectedSse> {
  const state = {
    text: "",
    finish: null as string | null,
    usage: null as Record<string, unknown> | null,
    sawDone: false,
  };
  let leftoverFlushed = false;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 2000);
      return {
        text: "",
        HTTP_STATUS: res.status,
        SSE_DONE_OBSERVED: false,
        FINISH_REASON: null,
        USAGE_PRESENT: false,
        usage: null,
        RAW_CHARS: 0,
        COLLECTOR_ERROR: errText,
        leftover_flushed: false,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      return {
        text: "",
        HTTP_STATUS: res.status,
        SSE_DONE_OBSERVED: false,
        FINISH_REASON: null,
        USAGE_PRESENT: false,
        usage: null,
        RAW_CHARS: 0,
        COLLECTOR_ERROR: "empty response body",
        leftover_flushed: false,
      };
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) parseSseLine(line, state);
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      parseSseLine(buffer, state);
      leftoverFlushed = true;
    }
    return {
      text: state.text,
      HTTP_STATUS: res.status,
      SSE_DONE_OBSERVED: state.sawDone,
      FINISH_REASON: state.finish,
      USAGE_PRESENT: state.usage != null,
      usage: state.usage,
      RAW_CHARS: state.text.length,
      COLLECTOR_ERROR: null,
      leftover_flushed: leftoverFlushed,
    };
  } catch (e) {
    return {
      text: state.text,
      HTTP_STATUS: 0,
      SSE_DONE_OBSERVED: state.sawDone,
      FINISH_REASON: state.finish,
      USAGE_PRESENT: state.usage != null,
      usage: state.usage,
      RAW_CHARS: state.text.length,
      COLLECTOR_ERROR: String(e),
      leftover_flushed: leftoverFlushed,
    };
  }
}
