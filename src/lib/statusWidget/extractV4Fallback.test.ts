import assert from "node:assert/strict";
import test from "node:test";
import { OPENROUTER_DEEPSEEK_V4_FLASH_MODEL } from "@/lib/chatModels";
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
  requestedMode: "character_only",
  mode: "character_only",
  displayMode: "creator",
  stackOrder: "character_first",
  characterWidget: widget,
  userWidget: null,
  needsCharacterValues: true,
  needsUserValues: false,
};

test("single-source V4 503 is terminal after one physical attempt", async () => {
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
      throw new CompatibleCompletionError({
        message: "CheaperInference 503",
        provider: "CheaperInference",
        httpStatus: 503,
      });
    },
  });

  assert.deepEqual(calls.map((call) => call.modelId), ["gpt-5.6-luna"]);
  assert.equal(calls[0]?.maxTokens, undefined);
  assert.equal(
    calls.filter((call) => call.modelId === OPENROUTER_DEEPSEEK_V4_FLASH_MODEL).length,
    0
  );
  assert.equal(result.meta.actualCallCount, 1);
  assert.equal(result.meta.postTurnPhysicalAttempted, true);
  assert.equal(result.meta.usedFallback, false);
  assert.equal(result.meta.exhausted, true);
  assert.equal(result.meta.attemptDiagnostics[0]?.httpStatus, 503);
  assert.equal(result.meta.attemptDiagnostics[0]?.errorCode, "CompatibleCompletionError");
  assert.equal(result.values.character, null);
});

test("dual-source partial response preserves valid source without fallback", async () => {
  const userWidget: StatusWidget = {
    ...widget,
    name: "유저 상태",
    fields: [{ id: "기분", label: "기분", instruction: "유저 기분" }],
    htmlTemplate: "{{기분}}",
  };
  const calls: Array<{ modelId: string; requestKind: string }> = [];
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
      calls.push({ modelId: opts.modelId, requestKind: opts.requestKind });
      return {
        text: JSON.stringify({
          character_values: { 시간: "14:35", 장소: "본부 로비" },
          user_values: {},
          extracted_facts: [],
        }),
        usage: { inputTokens: 20, outputTokens: 10, estimated: false },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.modelId, "gpt-5.6-luna");
  assert.equal(calls[0]?.requestKind, "background-status-widget-extract-combined");
  assert.equal(
    calls.filter((call) => call.modelId === OPENROUTER_DEEPSEEK_V4_FLASH_MODEL).length,
    0
  );
  assert.equal(result.meta.actualCallCount, 1);
  assert.equal(result.meta.postTurnPhysicalAttempted, true);
  assert.equal(result.meta.usedFallback, false);
  assert.equal(result.values.character?.["장소"], "본부 로비");
  assert.equal(result.values.user, null);
});
