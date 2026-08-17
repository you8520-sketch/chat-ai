/**
 * One isolated Bot-seat call to confirm true OFF:
 * thinking.disabled + reasoning_effort.none → reasoning_tokens = 0.
 * Does not write campaign state or billing.
 */
import { writeFileSync } from "node:fs";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import { adaptTrpgBotChatBody } from "@/lib/trpg/gmClient";
import { extractRawUsage } from "@/lib/trpg/thinkingBench/usage";
import { TRPG_BOT_MAX_TOKENS, TRPG_BOT_MODEL } from "@/lib/trpg/types";
import { loadEnvLocal } from "./load-env-local";

async function main(): Promise<void> {
  loadEnvLocal();
  const body = adaptTrpgBotChatBody({
    model: TRPG_BOT_MODEL,
    messages: [
      { role: "system", content: "You are a TRPG player character. Korean only. One short action beat." },
      { role: "user", content: "로비 비상계단을 막아 선다. 80자 안으로." },
    ],
    stream: false,
    temperature: 0.85,
    max_tokens: TRPG_BOT_MAX_TOKENS,
  });
  const started = Date.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const latencyMs = Date.now() - started;
  const payload = (await res.json()) as Record<string, unknown>;
  const text =
    typeof (payload as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content === "string"
      ? String((payload as { choices: { message?: { content?: string } }[] }).choices[0].message?.content)
      : "";
  const usage = extractRawUsage(payload);
  const out = {
    httpStatus: res.status,
    latencyMs,
    thinking: body.thinking,
    reasoning_effort: body.reasoning_effort,
    reasoning_tokens: usage.reasoning_tokens,
    completion_tokens: usage.completion_tokens,
    visible_completion_tokens: usage.visible_completion_tokens,
    textChars: text.length,
    rawUsage: payload.usage ?? null,
  };
  writeFileSync("/opt/cursor/artifacts/trpg_bot_true_off_probe.json", JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
