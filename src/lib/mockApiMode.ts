import fs from "fs";
import path from "path";
import { estimateTokens } from "@/lib/tokenEstimate";

/** true | 1 | yes — 실제 LLM HTTP 호출 차단 (dry-run) */
export function isMockApiMode(): boolean {
  const raw = process.env.MOCK_MODE?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function getMockFinishReason(): string {
  const raw = process.env.MOCK_FINISH_REASON?.trim().toUpperCase();
  if (raw === "MAX_TOKENS" || raw === "LENGTH") return "MAX_TOKENS";
  return "STOP";
}

const MOCK_BASE =
  "[테스트 응답] 렌이 당신을 바라보며 미소 짓습니다. (가짜 텍스트 200자)";

/** 약 200자 mock 본문 */
export function getMockResponseText(): string {
  if (getMockFinishReason() === "MAX_TOKENS") {
    return `${MOCK_BASE.slice(0, 120)}…`;
  }
  if (MOCK_BASE.length >= 200) return MOCK_BASE.slice(0, 200);
  return MOCK_BASE.padEnd(200, " ");
}

export const MOCK_INPUT_TOKENS = 20_000;
export const MOCK_OUTPUT_TOKENS = 500;

export type MockPayloadRecord = {
  at: string;
  provider: "gemini" | "openrouter" | "gemini-cache";
  requestKind?: string;
  model?: string;
  payloadChars: number;
  payloadTokens: number;
  historyMessages?: number;
  payload: unknown;
};

const DEBUG_PAYLOAD_PATH = path.join(process.cwd(), "debug_payload.json");
const MAX_DEBUG_ENTRIES = 50;

let mockModeLogged = false;

export function logMockModeOnce(): void {
  if (!isMockApiMode() || mockModeLogged) return;
  mockModeLogged = true;
  console.warn(
    "[MOCK_MODE] 활성 — Gemini/OpenRouter/CachedContent HTTP 호출 차단. debug_payload.json에 payload 기록."
  );
}

export function recordMockApiPayload(record: Omit<MockPayloadRecord, "at">): void {
  logMockModeOnce();
  const entry: MockPayloadRecord = { ...record, at: new Date().toISOString() };

  console.log("[MOCK_MODE] payload snapshot", {
    provider: entry.provider,
    requestKind: entry.requestKind,
    model: entry.model,
    payloadChars: entry.payloadChars,
    payloadTokens: entry.payloadTokens,
    historyMessages: entry.historyMessages,
    finishReason: getMockFinishReason(),
  });

  try {
    let entries: MockPayloadRecord[] = [];
    if (fs.existsSync(DEBUG_PAYLOAD_PATH)) {
      const raw = fs.readFileSync(DEBUG_PAYLOAD_PATH, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) entries = parsed as MockPayloadRecord[];
    }
    entries.push(entry);
    if (entries.length > MAX_DEBUG_ENTRIES) {
      entries = entries.slice(-MAX_DEBUG_ENTRIES);
    }
    fs.writeFileSync(DEBUG_PAYLOAD_PATH, JSON.stringify(entries, null, 2), "utf8");
  } catch (e) {
    console.warn("[MOCK_MODE] debug_payload.json write failed:", (e as Error).message);
  }
}

export function estimatePayloadFromBody(body: unknown): { chars: number; tokens: number } {
  const serialized = JSON.stringify(body);
  return {
    chars: serialized.length,
    tokens: estimateTokens(serialized),
  };
}

export function countHistoryMessages(body: Record<string, unknown>): number | undefined {
  const contents = body.contents;
  if (Array.isArray(contents)) return contents.length;
  const messages = body.messages;
  if (Array.isArray(messages)) return messages.length;
  return undefined;
}

/** Gemini generateContent mock usageMetadata */
export function buildMockGeminiGenerateJson(text: string) {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: getMockFinishReason(),
      },
    ],
    usageMetadata: {
      promptTokenCount: MOCK_INPUT_TOKENS,
      candidatesTokenCount: MOCK_OUTPUT_TOKENS,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
    },
  };
}

/** Gemini streamGenerateContent SSE 한 청크 */
export function buildMockGeminiStreamSse(text: string): string {
  const payload = {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: getMockFinishReason(),
      },
    ],
    usageMetadata: {
      promptTokenCount: MOCK_INPUT_TOKENS,
      candidatesTokenCount: MOCK_OUTPUT_TOKENS,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 0,
    },
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** OpenRouter chat/completions (stream chunk + final) */
export function buildMockOpenRouterStreamChunks(text: string, model: string): string[] {
  const finish = getMockFinishReason();
  const usage = {
    prompt_tokens: MOCK_INPUT_TOKENS,
    completion_tokens: MOCK_OUTPUT_TOKENS,
    total_tokens: MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS,
  };
  return [
    `data: ${JSON.stringify({
      choices: [{ delta: { content: text }, finish_reason: null }],
      model,
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: finish }],
      usage,
      model,
    })}\n\n`,
    "data: [DONE]\n\n",
  ];
}

export function buildMockOpenRouterGenerateJson(text: string, model: string) {
  return {
    choices: [
      {
        message: { role: "assistant", content: text },
        finish_reason: getMockFinishReason(),
      },
    ],
    usage: {
      prompt_tokens: MOCK_INPUT_TOKENS,
      completion_tokens: MOCK_OUTPUT_TOKENS,
      total_tokens: MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS,
    },
    model,
  };
}

/** ReadableStream — fetch Response.body 대체 */
export function mockReadableStreamFromText(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i++;
    },
  });
}
