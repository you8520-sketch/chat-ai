/**
 * Provider contract probe — DeepSeek V4 Pro vs V4.1 Flash (bounded).
 * Run: node --conditions=react-server --import tsx scripts/deepseek-v41-flash-preflight-probe.ts
 * Requires CHEAPER_INFERENCE_API_KEY.
 */
import Module from "module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
} from "@/lib/cheaperInferenceConfig";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID } from "@/lib/deepseekV41FlashPreflight";

const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy hook
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const OUT_DIR = join(process.cwd(), "docs/audits/deepseek-v41-flash-preflight-2026-09-20");
const MAX_CALLS = 4;
const MODELS = [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID] as const;

async function probeModel(modelId: string, cacheWarmup: boolean): Promise<Record<string, unknown>> {
  const key = process.env.CHEAPER_INFERENCE_API_KEY;
  if (!key?.trim()) throw new Error("CHEAPER_INFERENCE_API_KEY required");

  const systemPrefix =
    "You are a Korean roleplay assistant. Reply in prose only. No markdown. " +
    "Character: 테스트. ".repeat(cacheWarmup ? 400 : 20);
  const body = adaptCheaperInferenceChatBody({
    model: modelId,
    messages: [
      { role: "system", content: systemPrefix },
      { role: "user", content: cacheWarmup ? "이어서 짧게 대답해." : "안녕, 짧게 인사해." },
    ],
    max_tokens: 128,
    temperature: 0.7,
    stream: false,
  });

  const started = Date.now();
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(key),
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - started;
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    return { modelId, cacheWarmup, status: "error", httpStatus: res.status, latencyMs, json };
  }

  const usageRaw = json.usage as Record<string, unknown> | undefined;
  const parsed = usageRaw ? parseOpenRouterUsage(usageRaw, new Headers()) : null;
  const choices = json.choices as Array<{ message?: { content?: string }; finish_reason?: string }>;
  const content = choices?.[0]?.message?.content ?? "";

  return {
    modelId,
    cacheWarmup,
    status: "success",
    latencyMs,
    responseModelId: typeof json.model === "string" ? json.model : null,
    requestedModelId: modelId,
    finishReason: choices?.[0]?.finish_reason ?? null,
    outputChars: content.length,
    usageRaw,
    parsedUsage: parsed,
    usageReportingEvidence: parsed?.usageReportingEvidence ?? null,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const plannedCalls = MODELS.length * 2;
  if (plannedCalls > MAX_CALLS) {
    throw new Error(`Planned ${plannedCalls} exceeds MAX_CALLS ${MAX_CALLS}`);
  }

  const results: Record<string, unknown>[] = [];
  for (const modelId of MODELS) {
    results.push(await probeModel(modelId, false));
    results.push(await probeModel(modelId, true));
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    plannedCalls,
    maxCalls: MAX_CALLS,
    results,
  };
  writeFileSync(join(OUT_DIR, "PROVIDER_PROBE.json"), JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUT_DIR}/PROVIDER_PROBE.json (${results.length} calls)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
