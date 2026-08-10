import assert from "node:assert/strict";
import test from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL,
} from "@/lib/chatModels";
import { CompatibleCompletionError } from "@/lib/openRouterCompletion";
import { extractStatusWidgetValuesForTurn } from "./extract";
import type { ResolvedStatusWidgetTurn, StatusWidget } from "./types";

const widget: StatusWidget = {
  version: 1,
  name: "테스트",
  placement: "bottom",
  htmlTemplate: "{{시간}} {{장소}}",
  fields: [
    { id: "시간", label: "시간", instruction: "현재 시각" },
    { id: "장소", label: "장소", instruction: "현재 장소" },
  ],
};

const resolved: ResolvedStatusWidgetTurn = {
  active: true,
  mode: "character_only",
  displayMode: "creator",
  stackOrder: "character_first",
  characterWidget: widget,
  userWidget: null,
  needsCharacterValues: true,
  needsUserValues: false,
};

test("V4 Flash is unbounded and falls back to OpenRouter V4 once with diagnostics", async () => {
  const calls: Array<{ modelId: string; maxTokens?: number }> = [];
  const result = await extractStatusWidgetValuesForTurn({
    charName: "라이크",
    personaName: "렌",
    userMessage: "이제 뭐 하면 돼?",
    assistantProse: "두 사람은 본부 로비에 서 있었다.",
    resolved,
    env: {},
    caller: async (_system, _history, opts) => {
      calls.push({ modelId: opts.modelId, maxTokens: opts.maxTokens });
      if (opts.modelId === CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL) {
        throw new CompatibleCompletionError({
          message: "CheaperInference 503",
          provider: "CheaperInference",
          httpStatus: 503,
        });
      }
      return {
        text: JSON.stringify({ 시간: "14:35", 장소: "본부 로비" }),
        usage: {
          inputTokens: 300,
          outputTokens: 40,
          estimated: false,
          finishReason: "stop",
        },
      };
    },
  });

  assert.deepEqual(
    calls.map((call) => call.modelId),
    [
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      OPENROUTER_DEEPSEEK_V4_FLASH_MODEL,
    ]
  );
  assert.equal(calls[0]?.maxTokens, undefined);
  assert.equal(calls[1]?.maxTokens, undefined);
  assert.equal(calls[2]?.maxTokens, undefined);
  assert.equal(result.meta.usedFallback, true);
  assert.equal(result.meta.attemptDiagnostics[0]?.httpStatus, 503);
  assert.equal(result.meta.attemptDiagnostics[1]?.httpStatus, 503);
  assert.equal(result.meta.attemptDiagnostics[2]?.finishReason, "stop");
  assert.equal(result.values.character?.["장소"], "본부 로비");
});

test("dual-source extraction never calls the OpenRouter V4 fallback more than once per turn", async () => {
  const userWidget: StatusWidget = {
    ...widget,
    name: "유저 상태",
    fields: [{ id: "기분", label: "기분", instruction: "유저 기분" }],
    htmlTemplate: "{{기분}}",
  };
  const models: string[] = [];
  const result = await extractStatusWidgetValuesForTurn({
    charName: "라이크",
    personaName: "렌",
    userMessage: "이제 뭐 하면 돼?",
    assistantProse: "두 사람은 본부 로비에 서 있었다.",
    resolved: {
      ...resolved,
      mode: "both",
      displayMode: "both",
      userWidget,
      needsUserValues: true,
    },
    env: {},
    caller: async (_system, _history, opts) => {
      models.push(opts.modelId);
      return {
        text: "",
        usage: { inputTokens: 20, outputTokens: 10, estimated: false },
      };
    },
  });

  assert.equal(
    models.filter((model) => model === OPENROUTER_DEEPSEEK_V4_FLASH_MODEL).length,
    1
  );
  assert.equal(result.meta.usedFallback, true);
});
