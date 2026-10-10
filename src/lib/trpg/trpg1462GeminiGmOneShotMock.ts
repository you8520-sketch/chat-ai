import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import type { Trpg1462OneShotFetch } from "./trpg1462GeminiGmOneShot";

export type Trpg1462MockFetchLog = {
  count: number;
  urls: string[];
  bodies: string[];
};

export function createTrpg1462MockSseResponse(opts?: {
  narration?: string;
  location?: string;
  status?: number;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  empty?: boolean;
}): { status: number; body: string } {
  if (opts?.empty) {
    return { status: opts.status ?? 200, body: "data: [DONE]\n\n" };
  }
  const wire = buildTrpgGmStructuredWireText(opts?.narration ?? "골목은 그대로다.", {
    players: [],
    location: opts?.location ?? "석등 골목",
    next_round_context: "다음 행동을 고른다.",
    campaign_finished: false,
  });
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: wire }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: opts?.finishReason ?? "stop" }],
      usage: {
        prompt_tokens: opts?.inputTokens ?? 12,
        completion_tokens: opts?.outputTokens ?? 8,
      },
    })}`,
    "data: [DONE]",
    "",
  ].join("\n");
  return { status: opts?.status ?? 200, body };
}

export function createTrpg1462MockFetch(script: {
  mode: "success" | "http" | "unknown" | "hang";
  status?: number;
  narration?: string;
}): { fetchImpl: Trpg1462OneShotFetch; log: Trpg1462MockFetchLog } {
  const log: Trpg1462MockFetchLog = { count: 0, urls: [], bodies: [] };
  const fetchImpl: Trpg1462OneShotFetch = async (input, init) => {
    log.count += 1;
    log.urls.push(String(input));
    log.bodies.push(init.body);
    if (script.mode === "hang") {
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          const error = new Error("aborted");
          error.name = "TimeoutError";
          reject(error);
        };
        const timer = setTimeout(abort, 25);
        if (init.signal?.aborted) {
          clearTimeout(timer);
          abort();
          return;
        }
        init.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            abort();
          },
          { once: true }
        );
      });
    }
    if (script.mode === "http") {
      return new Response("provider 5xx", { status: script.status ?? 500 });
    }
    const built = createTrpg1462MockSseResponse({
      narration: script.narration,
      empty: script.mode === "unknown",
    });
    return new Response(built.body, { status: built.status });
  };
  return { fetchImpl, log };
}
