import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, isCheaperInferenceModel } from "@/lib/chatModels";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { isMockApiMode } from "@/lib/mockApiMode";
import { adaptTrpgBotChatBody, adaptTrpgGmChatBody } from "./gmClient";
import type { TrpgModelUsage } from "./billing";
import { TRPG_BOT_MODEL, TRPG_GM_MODEL } from "./types";

export type TrpgGmCallResult = { text: string; usage?: TrpgModelUsage };

const MOCK_GM = `<<<NARRATION>>>
낡은 등불이 흔들린다. 당신은 문턱에 서서 다음 한 수를 고른다. 안에서 숨소리가 들린다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"문 너머를 조사하거나 말을 건넨다.","campaign_finished":false}`;

const MOCK_BOT = `*창가에 붙어 낮게* "…먼저 나가지 마. 내가 볼게."`;

function resolveTrpgProModel(modelId: string): string {
  return isCheaperInferenceModel(modelId) ? modelId : CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
}

function usageFromResponse(
  modelId: string,
  data: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  }
): TrpgModelUsage | undefined {
  const prompt = Number(data.usage?.prompt_tokens ?? 0);
  const completion = Number(data.usage?.completion_tokens ?? 0);
  const cached = Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0);
  if (prompt <= 0 && completion <= 0) return undefined;
  return {
    modelId,
    inputTokens: prompt,
    outputTokens: completion,
    cacheReadTokens: cached > 0 ? cached : undefined,
  };
}

async function postTrpgChat(opts: {
  model: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}): Promise<{ text: string; usage?: TrpgModelUsage }> {
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
    body: JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[TRPG] ${res.status}: ${errText.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("[TRPG] empty completion");
  return { text, usage: usageFromResponse(opts.model, data) };
}

/** Isolated GM Pro call. Must not go through RP adaptCheaperInferenceChatBody. */
export async function callTrpgGm(opts: {
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<TrpgGmCallResult> {
  if (isMockApiMode()) {
    return { text: MOCK_GM };
  }
  const model = resolveTrpgProModel(TRPG_GM_MODEL);
  const body = adaptTrpgGmChatBody({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: false,
    temperature: 0.7,
  });
  return postTrpgChat({ model, body, timeoutMs: opts.timeoutMs ?? 180_000 });
}

/** Bot-seat Pro call (thinking off). Separate from GM narration. */
export async function callTrpgBot(opts: {
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<TrpgGmCallResult> {
  if (isMockApiMode()) {
    return { text: MOCK_BOT };
  }
  const model = resolveTrpgProModel(TRPG_BOT_MODEL);
  const body = adaptTrpgBotChatBody({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: false,
    temperature: 0.85,
    max_tokens: 768,
  });
  return postTrpgChat({ model, body, timeoutMs: opts.timeoutMs ?? 45_000 });
}
