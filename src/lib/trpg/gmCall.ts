import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  isCheaperInferenceModel,
} from "@/lib/chatModels";
import {
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { isMockApiMode } from "@/lib/mockApiMode";
import { adaptTrpgGmChatBody } from "./gmClient";
import { TRPG_GM_MODEL } from "./types";

export type TrpgGmCallResult = { text: string };

const MOCK_GM = `<<<NARRATION>>>
낡은 등불이 흔들린다. 당신은 문턱에 서서 다음 한 수를 고른다. 안에서 숨소리가 들린다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"문 너머를 조사하거나 말을 건넨다.","campaign_finished":false}`;

/** Isolated GM Pro call. Must not go through RP adaptCheaperInferenceChatBody. */
export async function callTrpgGm(opts: {
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<TrpgGmCallResult> {
  if (isMockApiMode()) {
    return { text: MOCK_GM };
  }
  const model = isCheaperInferenceModel(TRPG_GM_MODEL)
    ? TRPG_GM_MODEL
    : CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
  const body = adaptTrpgGmChatBody({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: false,
    temperature: 0.7,
    max_tokens: 4096,
  });
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[TRPG GM] ${res.status}: ${errText.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("[TRPG GM] empty completion");
  return { text };
}
