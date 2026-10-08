/**
 * Canonical OpenAI-compatible SSE protocol decoder for Main RP / #1354.
 * Owns line buffering, `data:` events, `[DONE]`, and JSON event parse only.
 * Does not own client streaming, loop/degeneration guards, clamp, retry, or persist.
 */

export type OpenAiCompatibleSseEvent =
  | { kind: "done" }
  | { kind: "json"; value: Record<string, unknown> }
  | { kind: "malformed"; raw: string; error: string };

export type OpenAiCompatibleSseFeedState = {
  buffer: string;
};

export type OpenAiCompatibleSseEvidence = {
  text: string;
  responseModelId: string | null;
  generationId: string | null;
  finishReason: string | null;
  lastUsage: unknown;
  lastCheaperInference: unknown;
  lastJson: Record<string, unknown> | null;
  doneObserved: boolean;
  schemaError: string | null;
  streamCompleted: boolean;
};

export function createOpenAiCompatibleSseFeedState(): OpenAiCompatibleSseFeedState {
  return { buffer: "" };
}

export function createOpenAiCompatibleSseEvidence(): OpenAiCompatibleSseEvidence {
  return {
    text: "",
    responseModelId: null,
    generationId: null,
    finishReason: null,
    lastUsage: null,
    lastCheaperInference: null,
    lastJson: null,
    doneObserved: false,
    schemaError: null,
    streamCompleted: false,
  };
}

export function isOpenAiCompatibleSseContentType(contentType: string | null): boolean {
  return /text\/event-stream/i.test(contentType ?? "");
}

/** OpenAI/OpenRouter SSE content parts — string or array. */
export function streamContentToText(content: unknown): string {
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

/** Visible completion text from one OpenAI-compatible stream choice. */
export function extractOpenAiCompatibleStreamDelta(choice: unknown): string {
  if (!choice || typeof choice !== "object") return "";
  const typed = choice as {
    delta?: { content?: unknown; text?: string | null };
    message?: { content?: unknown };
    text?: string | null;
  };
  const delta = typed.delta;
  if (delta?.content != null) {
    const fromContent = streamContentToText(delta.content);
    if (fromContent) return fromContent;
  }
  if (delta?.text) return delta.text;
  if (typed.message?.content != null) {
    const fromMessage = streamContentToText(typed.message.content);
    if (fromMessage) return fromMessage;
  }
  if (typed.text) return typed.text;
  return "";
}

function consumeSseLine(line: string): OpenAiCompatibleSseEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  if (payload === "[DONE]") return { kind: "done" };
  try {
    const value = JSON.parse(payload) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { kind: "malformed", raw: payload, error: "sse event is not a JSON object" };
    }
    return { kind: "json", value: value as Record<string, unknown> };
  } catch (error) {
    return {
      kind: "malformed",
      raw: payload,
      error: error instanceof Error ? error.message : "sse json parse failed",
    };
  }
}

/**
 * Feed a decoded UTF-8 chunk. Incomplete lines stay in `state.buffer`.
 * `eof` drains a trailing line that has no final newline.
 */
export function feedOpenAiCompatibleSseChunk(
  state: OpenAiCompatibleSseFeedState,
  chunk: string,
  eof = false
): OpenAiCompatibleSseEvent[] {
  state.buffer += chunk;
  const lines = state.buffer.split("\n");
  state.buffer = eof ? "" : (lines.pop() ?? "");
  const events: OpenAiCompatibleSseEvent[] = [];
  for (const line of lines) {
    const event = consumeSseLine(line);
    if (event) events.push(event);
  }
  return events;
}

export function applyOpenAiCompatibleSseEvent(
  evidence: OpenAiCompatibleSseEvidence,
  event: OpenAiCompatibleSseEvent
): void {
  if (event.kind === "done") {
    evidence.doneObserved = true;
    return;
  }
  if (event.kind === "malformed") {
    if (!evidence.schemaError) evidence.schemaError = event.error;
    return;
  }
  const json = event.value;
  evidence.lastJson = json;
  if (typeof json.model === "string" && json.model.trim()) {
    if (!evidence.responseModelId) evidence.responseModelId = json.model.trim();
  }
  if (typeof json.id === "string" && json.id.trim()) {
    if (!evidence.generationId) evidence.generationId = json.id.trim();
  }
  if (json.usage != null) evidence.lastUsage = json.usage;
  if (json.cheaper_inference != null) evidence.lastCheaperInference = json.cheaper_inference;
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice = choices[0];
  if (choice && typeof choice === "object") {
    const finish = (choice as { finish_reason?: unknown }).finish_reason;
    if (typeof finish === "string" && finish.trim()) evidence.finishReason = finish.trim();
    evidence.text += extractOpenAiCompatibleStreamDelta(choice);
  }
}

export function reconstructOpenAiCompatibleCompletionBody(
  evidence: OpenAiCompatibleSseEvidence
): Record<string, unknown> {
  return {
    id: evidence.generationId,
    model: evidence.responseModelId,
    choices: [{ message: { content: evidence.text } }],
    usage: evidence.lastUsage,
    cheaper_inference: evidence.lastCheaperInference,
  };
}

export async function decodeOpenAiCompatibleSseResponse(
  res: Response
): Promise<OpenAiCompatibleSseEvidence> {
  const evidence = createOpenAiCompatibleSseEvidence();
  if (!res.body) {
    evidence.schemaError = "empty response body";
    evidence.streamCompleted = true;
    return evidence;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const state = createOpenAiCompatibleSseFeedState();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        for (const event of feedOpenAiCompatibleSseChunk(state, decoder.decode(), true)) {
          applyOpenAiCompatibleSseEvent(evidence, event);
        }
        evidence.streamCompleted = true;
        break;
      }
      for (const event of feedOpenAiCompatibleSseChunk(
        state,
        decoder.decode(value, { stream: true })
      )) {
        applyOpenAiCompatibleSseEvent(evidence, event);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!evidence.doneObserved && !evidence.schemaError) {
    evidence.schemaError = "eof before terminal SSE metadata/DONE";
  }
  return evidence;
}
