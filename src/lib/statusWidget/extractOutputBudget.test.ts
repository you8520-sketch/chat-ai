import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callBackgroundMemory, resolveBackgroundOutputBudget } from "@/lib/ai";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import { extractStatusWidgetValuesForTurn, type StatusWidgetExtractCaller } from "./extract";
import {
  isCombinedExtractLikelyTruncated,
  resolveCombinedDualWidgetExtractMaxTokens,
  resolveWidgetOutputSizeProxy,
} from "./extractNormalize";
import { collectWidgetJsonKeys } from "./prompt";
import type { ResolvedStatusWidgetTurn, StatusWidget } from "./types";

const usage = { inputTokens: 10, outputTokens: 5, estimated: true };

const userWidget: StatusWidget = {
  version: 1,
  name: "유저 상태",
  placement: "bottom",
  htmlTemplate: "{{기분}}",
  fields: [{ id: "기분", label: "기분", instruction: "유저 기분" }],
};

const singleResolved: ResolvedStatusWidgetTurn = {
  active: true,
  requestedMode: "character_only",
  mode: "character_only",
  displayMode: "creator",
  stackOrder: "character_first",
  characterWidget: DEFAULT_STATUS_WIDGET,
  userWidget: null,
  needsCharacterValues: true,
  needsUserValues: false,
};

const dualResolved: ResolvedStatusWidgetTurn = {
  ...singleResolved,
  mode: "both",
  displayMode: "both",
  userWidget,
  needsUserValues: true,
};

describe("status widget extract output budget — request kind policy", () => {
  it("bounds the initial and combined widget extract kinds", () => {
    assert.equal(
      resolveBackgroundOutputBudget("background-status-widget-extract", 296),
      296
    );
    assert.equal(
      resolveBackgroundOutputBudget("background-status-widget-extract-combined", 3072),
      3072
    );
  });

  it("falls back to the request-kind default when no explicit budget is given", () => {
    assert.equal(
      resolveBackgroundOutputBudget("background-status-widget-extract"),
      3072
    );
    assert.equal(
      resolveBackgroundOutputBudget("background-status-widget-extract-combined"),
      3072
    );
  });

  it("keeps the repair / fallback / echo-fix widget kinds unbounded", () => {
    for (const requestKind of [
      "background-status-widget-extract-repair",
      "background-status-widget-extract-fallback",
      "background-status-widget-extract-volatile-echo-fix",
    ]) {
      assert.equal(
        resolveBackgroundOutputBudget(requestKind, 512),
        null,
        `${requestKind} must stay unbounded`
      );
    }
  });

  it("does not change the output budget of the other background kinds", () => {
    for (const requestKind of [
      "background-memory-extract",
      "background-lorebook-compact",
      "background-status-meta-extract",
      "background-suggested-replies-extract",
    ]) {
      assert.equal(
        resolveBackgroundOutputBudget(requestKind, 4096),
        null,
        `${requestKind} must stay unbounded`
      );
    }
  });

  it("does not change the shared post-turn initial budget", () => {
    assert.equal(
      resolveBackgroundOutputBudget("background-post-turn-shared-initial"),
      4096
    );
  });
});

describe("status widget extract output budget — request wiring", () => {
  it("requests the per-widget budget on a single-source initial extract", async () => {
    const calls: Array<{ requestKind: string; maxTokens?: number }> = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push({ requestKind: opts.requestKind, maxTokens: opts.maxTokens });
      return {
        text: JSON.stringify(
          Object.fromEntries(
            collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET).map((key) => [key, `값-${key}`])
          )
        ),
        usage,
      };
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      resolved: singleResolved,
      caller,
      primaryModelId: "gpt-5.6-luna",
      activePromises: [],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.requestKind, "background-status-widget-extract");
    assert.equal(
      calls[0]?.maxTokens,
      resolveWidgetOutputSizeProxy(
        DEFAULT_STATUS_WIDGET,
        collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)
      )
    );
    assert.ok((calls[0]?.maxTokens ?? 0) > 0);
    assert.ok((calls[0]?.maxTokens ?? 0) <= 512);
    assert.equal(result.meta.actualCallCount, 1);
    assert.ok(result.values.character);
  });

  it("requests the combined budget on a dual-source initial extract", async () => {
    const calls: Array<{ requestKind: string; maxTokens?: number }> = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push({ requestKind: opts.requestKind, maxTokens: opts.maxTokens });
      return {
        text: JSON.stringify({
          character_values: { 시간: "14:35", 장소: "본부 로비" },
          user_values: { 기분: "평온" },
          extracted_facts: [],
        }),
        usage,
      };
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      resolved: dualResolved,
      caller,
      primaryModelId: "gpt-5.6-luna",
      activePromises: [],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.requestKind, "background-status-widget-extract-combined");
    assert.equal(
      calls[0]?.maxTokens,
      resolveCombinedDualWidgetExtractMaxTokens(DEFAULT_STATUS_WIDGET, userWidget)
    );
    assert.ok((calls[0]?.maxTokens ?? 0) >= 2048);
    assert.ok((calls[0]?.maxTokens ?? 0) <= 3072);
    assert.equal(result.meta.actualCallCount, 1);
  });

  it("detects a combined extract that hit the requested budget", () => {
    const maxTokens = resolveCombinedDualWidgetExtractMaxTokens(
      DEFAULT_STATUS_WIDGET,
      userWidget
    );
    assert.equal(
      isCombinedExtractLikelyTruncated({
        finishReason: null,
        outputTokens: maxTokens,
        maxTokens,
        jsonParseOk: false,
      }),
      true
    );
    assert.equal(
      isCombinedExtractLikelyTruncated({
        finishReason: "stop",
        outputTokens: maxTokens - 1,
        maxTokens,
        jsonParseOk: true,
      }),
      false
    );
  });
});

/**
 * Transport-level contract — the caller-level `maxTokens` assertion above only
 * proves the extract asks for a budget. This proves the budget reaches the wire
 * (and that the unbounded kinds stay unbounded on the wire too).
 *
 * No network and no paid model call: `globalThis.fetch` is stubbed, so the
 * request body is inspected instead of being sent.
 */
describe("status widget extract output budget — wire body", () => {
  it("sends max_tokens for the widget extract and omits it for unbounded kinds", async () => {
    const previousFetch = globalThis.fetch;
    const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousMockMode = process.env.MOCK_MODE;
    const bodies: Array<Record<string, unknown>> = [];

    process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
    delete process.env.MOCK_MODE;
    globalThis.fetch = (async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      await callBackgroundMemory(
        "system",
        [{ role: "user", content: "hi" }],
        undefined,
        "background-status-widget-extract",
        { maxTokens: 296, modelId: "gpt-6-luna" }
      );
      await callBackgroundMemory(
        "system",
        [{ role: "user", content: "hi" }],
        undefined,
        "background-memory-extract"
      );

      assert.equal(bodies[0]?.max_tokens, 296);
      assert.deepEqual(bodies[0]?.reasoning, { effort: "none" });
      assert.equal(bodies[0]?.reasoning_effort, "none");
      // Unbounded kinds must stay unbounded on the wire.
      assert.equal(bodies[1]?.max_tokens, undefined);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
      if (previousMockMode == null) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = previousMockMode;
    }
  });
});

/**
 * Failure contract — the extract has a hard one-attempt contract.
 *
 * `background-status-widget-extract-repair` / `-fallback` /
 * `-volatile-echo-fix` have no production call site, and the `repairOnly`
 * branch of the per-source extract performs no provider call at all. A
 * truncated (finishReason=length) initial extract therefore persists nothing
 * and is NOT retried. These tests pin that contract so no document may claim
 * a recovery path that does not exist.
 */
describe("status widget extract output budget — failure contract", () => {
  it("a truncated single-source initial extract persists nothing and is not retried", async () => {
    const calls: Array<{ requestKind: string; maxTokens?: number }> = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push({ requestKind: opts.requestKind, maxTokens: opts.maxTokens });
      return {
        // Provider stopped at the requested budget: the JSON is cut mid-object.
        text: '{"시간":"14:20","장소":"사령부',
        usage: {
          inputTokens: 100,
          outputTokens: 296,
          estimated: false,
          finishReason: "length",
        },
      };
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      resolved: singleResolved,
      caller,
      primaryModelId: "gpt-6-luna",
      activePromises: [],
    });

    // Exactly one physical provider call — no repair, no fallback.
    assert.equal(calls.length, 1);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.values.character ?? null, null);
    assert.equal(result.meta.exhausted, true);
    assert.equal(result.meta.usedRepair, false);
    assert.equal(result.meta.usedFallback, false);
  });

  it("the combined path's per-source recovery performs no extra provider call", async () => {
    const calls: Array<{ requestKind: string; maxTokens?: number }> = [];
    const caller: StatusWidgetExtractCaller = async (_system, _history, opts) => {
      calls.push({ requestKind: opts.requestKind, maxTokens: opts.maxTokens });
      return {
        // The user source is missing → the user-side recovery branch runs.
        text: JSON.stringify({
          character_values: { 시간: "14:35" },
          extracted_facts: [],
        }),
        usage,
      };
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "라이크",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "라이크는 복도에 서 있었다.",
      resolved: dualResolved,
      caller,
      primaryModelId: "gpt-6-luna",
      activePromises: [],
    });

    // The failed user source must NOT trigger a second provider call.
    assert.equal(calls.length, 1);
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.values.user ?? null, null);
    assert.equal(result.meta.exhausted, true);
  });
});

/**
 * Measured-production floor.
 *
 * The per-widget budget must stay at or above the output tokens that the
 * background text model actually produced for real status-widget extracts.
 *
 * The operating background model is CheaperInference GPT-6 Luna
 * (`resolveBackgroundPrimaryModelId` migrates every historical DeepSeek primary
 * alias to it). The measurements below are from its predecessor in the same
 * Luna family, captured with the identical reasoning-off wire contract
 * (`reasoning: { effort: "none" }` + `include_reasoning: false`), so the
 * provider-reported completion total is the visible JSON size.
 *
 * Sources (committed raw benchmark artifacts, not synthetic fixtures):
 *  - 5-key single-source extract, max provider output tokens = 145
 *    (origin/chatgpt/background-model-ab-luna-vs-deepseek,
 *     docs/benchmarks/background-model-ab-20260826/status-widget-results.json, S8)
 *  - 10-key combined extract (5 character + 5 user), max = 229
 *    (origin/cursor/background-model-ab-bench-689a,
 *     data/background-model-ab/raw/status-results.json, general_dual_pov)
 */
describe("status widget extract output budget — measured production floor", () => {
  const fiveKeyWidget: StatusWidget = {
    version: 1,
    name: "모던 상태창",
    placement: "bottom",
    htmlTemplate: "{{시간}}{{장소}}{{속마음}}{{현재상황}}{{의식의흐름}}",
    fields: [
      { id: "시간", label: "시간", instruction: "현재 시각" },
      { id: "장소", label: "장소", instruction: "현재 장소" },
      { id: "속마음", label: "속마음", instruction: "NPC의 속마음" },
      { id: "현재상황", label: "현재상황", instruction: "현재 상황 요약" },
      { id: "의식의흐름", label: "의식의흐름", instruction: "NPC의 의식의 흐름" },
    ],
  };

  const MEASURED_5_KEY_SINGLE_OUTPUT_TOKENS = 145;
  const MEASURED_10_KEY_COMBINED_OUTPUT_TOKENS = 229;

  it("the single-source budget covers the measured 5-key production extract", () => {
    const budget = resolveWidgetOutputSizeProxy(
      fiveKeyWidget,
      collectWidgetJsonKeys(fiveKeyWidget)
    );
    assert.ok(
      budget >= MEASURED_5_KEY_SINGLE_OUTPUT_TOKENS,
      `single-source budget ${budget} must cover the measured ${MEASURED_5_KEY_SINGLE_OUTPUT_TOKENS} production output tokens`
    );
  });

  it("the 10-key budget covers the measured 10-key production extract", () => {
    const tenKeyWidget: StatusWidget = {
      ...fiveKeyWidget,
      htmlTemplate: `${fiveKeyWidget.htmlTemplate}${"{{k1}}"}`,
      fields: [
        ...fiveKeyWidget.fields,
        { id: "k1", label: "k1", instruction: "값 하나" },
        { id: "k2", label: "k2", instruction: "값 하나" },
        { id: "k3", label: "k3", instruction: "값 하나" },
        { id: "k4", label: "k4", instruction: "값 하나" },
        { id: "k5", label: "k5", instruction: "값 하나" },
      ],
    };
    const budget = resolveWidgetOutputSizeProxy(
      tenKeyWidget,
      collectWidgetJsonKeys(tenKeyWidget)
    );
    assert.ok(
      budget >= MEASURED_10_KEY_COMBINED_OUTPUT_TOKENS,
      `10-key budget ${budget} must cover the measured ${MEASURED_10_KEY_COMBINED_OUTPUT_TOKENS} production output tokens`
    );
  });

  it("the combined budget covers the measured 10-key production extract", () => {
    const combined = resolveCombinedDualWidgetExtractMaxTokens(
      fiveKeyWidget,
      fiveKeyWidget
    );
    assert.ok(
      combined >= MEASURED_10_KEY_COMBINED_OUTPUT_TOKENS,
      `combined budget ${combined} must cover the measured ${MEASURED_10_KEY_COMBINED_OUTPUT_TOKENS} production output tokens`
    );
  });
});
