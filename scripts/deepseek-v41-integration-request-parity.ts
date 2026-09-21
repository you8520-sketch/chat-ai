/**
 * DeepSeek V4 Pro vs V4.1 Flash — post-integration FINAL REQUEST parity.
 * Credential-free: buildContext + assemblePrimaryRpRequest only.
 * Run: node --conditions=react-server --import tsx scripts/deepseek-v41-integration-request-parity.ts
 */
import Module from "module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { assemblePrimaryRpRequest, type AssembledPrimaryRpRequest } from "@/lib/openRouterAdult";
import { buildContext } from "@/services/contextBuilder";

const OUT_DIR = join(
  process.cwd(),
  "docs/audits/deepseek-v41-integration-2026-09-21/request-parity"
);

const originalLoad = Module._load;
Module._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy hook
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

type BodyRecord = Record<string, unknown>;

function diffKeys(a: BodyRecord, b: BodyRecord): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
}

function buildPair(modelId: string) {
  const ctx = buildContext({
    charName: "강이현",
    chunks: [
      {
        id: "c-identity",
        title: "[정체]",
        content: "검은 장미단 부단장. 29세.",
        kind: "character",
      },
    ],
    userNickname: "민수",
    shortTermHistory: [{ role: "user", content: "오늘 하루 어땠어?" }],
    currentUserMessage: "…기억하고 싶지 않아.",
    modelId,
    targetResponseChars: 3200,
    nsfw: false,
  });
  return assemblePrimaryRpRequest({
    system: ctx.systemPrompt,
    history: ctx.history,
    modelId,
    targetResponseChars: 3200,
  });
}

function summarize(req: AssembledPrimaryRpRequest) {
  const body = req.requestBody as BodyRecord;
  return {
    model: body.model,
    thinking: body.thinking ?? null,
    reasoning_effort: body.reasoning_effort ?? null,
    temperature: body.temperature ?? null,
    top_p: body.top_p ?? null,
    max_tokens: body.max_tokens ?? null,
    messageCount: req.messages.length,
    systemChars: req.messages.find((m) => m.role === "system")?.content.length ?? 0,
  };
}

const pro = buildPair(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
const v41 = buildPair(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
const proBody = pro.requestBody as BodyRecord;
const v41Body = v41.requestBody as BodyRecord;
const changedKeys = diffKeys(proBody, v41Body);

const report = {
  generatedAt: new Date().toISOString(),
  exactMainHead: process.env.GIT_HEAD ?? "see branch cursor/v41-flash-hidden-integration-a91d",
  classification: "POST_INTEGRATION_REQUEST_PARITY",
  proModel: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  v41Model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  changedKeys,
  pro: summarize(pro),
  v41: summarize(v41),
  parityChecks: {
    thinkingEqual: JSON.stringify(proBody.thinking) === JSON.stringify(v41Body.thinking),
    reasoningEffortEqual: proBody.reasoning_effort === v41Body.reasoning_effort,
    temperatureEqual: proBody.temperature === v41Body.temperature,
    topPEqual: proBody.top_p === v41Body.top_p,
    messageCountEqual: pro.messages.length === v41.messages.length,
    systemCharsDelta:
      (pro.messages.find((m) => m.role === "system")?.content.length ?? 0) -
      (v41.messages.find((m) => m.role === "system")?.content.length ?? 0),
  },
  stopCondition:
    changedKeys.every((k) => ["model", "thinking", "reasoning", "include_reasoning", "enable_thinking"].includes(k)) ||
    changedKeys.every((k) => k === "model")
      ? null
      : "UNEXPLAINED_PROMPT_SEMANTICS_DIFF",
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "request-parity.json"), JSON.stringify(report, null, 2));

if (report.stopCondition) {
  console.error("STOP:", report.stopCondition, changedKeys);
  process.exit(1);
}

console.log("POST_INTEGRATION_REQUEST_PARITY OK", join(OUT_DIR, "request-parity.json"));
