import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  extractStatusWidgetValuesForTurn,
  resolveEffectiveStatusWidgetFallbackModel,
  resolveStatusWidgetFallbackModel,
  type StatusWidgetExtractCaller,
} from "./extract";
import {
  buildWidgetExtractRepairSystem,
  buildWidgetExtractRepairUserBlock,
  formatPreviousCanonicalWidgetValuesForRepair,
} from "./extractNormalize";
import { collectWidgetJsonKeys } from "./prompt";
import { statusWidgetValuesHasContent } from "./displayPolicy";
import {
  applyStatusWidgetBillingCharge,
  mergeStatusWidgetExtractUsages,
} from "./receiptUsage";
import { resolveBillingExchangeRateSnapshot } from "@/lib/exchangeRate";
import type { Usage } from "@/lib/chatUsage";
import type { ResolvedStatusWidgetTurn, StatusWidget } from "./types";
import type { TokenUsage } from "@/lib/ai";

const usage = (n: number): TokenUsage => ({
  inputTokens: 10 + n,
  outputTokens: 5 + n,
  estimated: true,
});

function characterResolved(widget: StatusWidget = DEFAULT_STATUS_WIDGET): ResolvedStatusWidgetTurn {
  return {
    active: true,
    mode: "character_only",
    displayMode: "creator",
    stackOrder: "character_first",
    characterWidget: widget,
    userWidget: null,
    needsCharacterValues: true,
    needsUserValues: false,
  };
}

function bothResolved(
  characterWidget: StatusWidget = DEFAULT_STATUS_WIDGET,
  userWidget: StatusWidget = {
    ...DEFAULT_STATUS_WIDGET,
    name: "유저 상태창",
    fields: [
      { id: "기분", label: "기분", instruction: "유저 기분" },
      { id: "위치", label: "위치", instruction: "유저 위치" },
    ],
  }
): ResolvedStatusWidgetTurn {
  return {
    active: true,
    mode: "both",
    displayMode: "both",
    stackOrder: "character_first",
    characterWidget,
    userWidget,
    needsCharacterValues: true,
    needsUserValues: true,
  };
}

function jsonForWidget(widget: StatusWidget, overrides: Record<string, string> = {}): string {
  const keys = collectWidgetJsonKeys(widget);
  const obj: Record<string, unknown> = {};
  for (const key of keys) {
    obj[key] = overrides[key] ?? `값-${key}`;
  }
  obj.extracted_facts = [];
  return JSON.stringify(obj);
}

describe("resolveStatusWidgetFallbackModel (opt-in)", () => {
  it("undefined → OFF", () => {
    assert.equal(resolveStatusWidgetFallbackModel({} as NodeJS.ProcessEnv), null);
  });

  it("empty string → OFF", () => {
    assert.equal(
      resolveStatusWidgetFallbackModel({ STATUS_WIDGET_FALLBACK_MODEL: "" } as NodeJS.ProcessEnv),
      null
    );
  });

  it("explicit model → ON", () => {
    assert.equal(
      resolveStatusWidgetFallbackModel({
        STATUS_WIDGET_FALLBACK_MODEL: "google/gemini-2.5-flash",
      } as NodeJS.ProcessEnv),
      "google/gemini-2.5-flash"
    );
  });

  it("same model as primary skips cross-model fallback", () => {
    assert.equal(
      resolveEffectiveStatusWidgetFallbackModel(
        "deepseek/deepseek-chat-v3-0324",
        "deepseek/deepseek-chat-v3-0324"
      ),
      null
    );
    assert.equal(
      resolveEffectiveStatusWidgetFallbackModel(
        "deepseek/deepseek-chat-v3-0324",
        "google/gemini-2.5-flash"
      ),
      "google/gemini-2.5-flash"
    );
  });
});

describe("status widget empty-extract retry", () => {
  it("1. initial V3 success → no extra calls", async () => {
    const calls: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      calls.push(opts.requestKind);
      return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "카페에서 마주쳤다. 시계는 14:30이었다.",
      resolved: characterResolved(),
      caller,
      fallbackModelId: "google/gemini-2.5-flash",
    });
    assert.equal(calls.length, 1);
    assert.equal(result.meta.totalCallCount, 1);
    assert.equal(result.meta.usedRepair, false);
    assert.ok(statusWidgetValuesHasContent(result.values));
  });

  it("2. initial empty → repair success", async () => {
    let n = 0;
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      n += 1;
      if (opts.requestKind.includes("repair")) {
        return {
          text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "15:00", 장소: "도서관" }),
          usage: usage(2),
        };
      }
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "이동한다",
      assistantProse: "도서관으로 걸어갔다. 지금은 오후 3시.",
      resolved: characterResolved(),
      caller,
      fallbackModelId: null,
    });
    assert.equal(n, 2);
    assert.equal(result.meta.character?.finalReasonCode, "V3_REPAIR_USED");
    assert.equal(result.values.character?.["시간"], "15:00");
  });

  it("3. initial parse failure → repair success", async () => {
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      if (opts.requestKind.includes("repair")) {
        return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(2) };
      }
      return { text: "not-json-at-all", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면이 이어진다.",
      resolved: characterResolved(),
      caller,
      fallbackModelId: null,
    });
    assert.equal(result.meta.character?.finalReasonCode, "V3_REPAIR_USED");
    assert.ok(statusWidgetValuesHasContent(result.values));
  });

  it("4. initial+repair fail → Flash fallback success when opt-in", async () => {
    const models: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      models.push(opts.modelId);
      if (opts.requestKind.includes("fallback")) {
        return {
          text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 장소: "옥상" }),
          usage: usage(3),
        };
      }
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "옥상에 올랐다.",
      resolved: characterResolved(),
      caller,
      primaryModelId: "deepseek/deepseek-chat-v3-0324",
      fallbackModelId: "google/gemini-2.5-flash",
    });
    assert.deepEqual(models, [
      "deepseek/deepseek-chat-v3-0324",
      "deepseek/deepseek-chat-v3-0324",
      "google/gemini-2.5-flash",
    ]);
    assert.equal(result.meta.character?.finalReasonCode, "FALLBACK_MODEL_USED");
  });

  it("5. all fail → empty; no prior variant/snapshot copy", async () => {
    const caller: StatusWidgetExtractCaller = async () => ({ text: "", usage: usage(1) });
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "새 장면 — 해변, 저녁 7시.",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "09:00", 장소: "옛장소" } },
      caller,
      fallbackModelId: "google/gemini-2.5-flash",
    });
    assert.equal(result.meta.exhausted, true);
    assert.equal(result.values.character, null);
    assert.notEqual(result.values.character?.["장소"], "옛장소");
  });

  it("unset fallback does not call a third model", async () => {
    const kinds: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      kinds.push(opts.requestKind);
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller,
      env: {} as NodeJS.ProcessEnv,
    });
    assert.equal(kinds.length, 2);
    assert.ok(!kinds.some((k) => k.includes("fallback")));
    assert.equal(result.meta.character?.finalReasonCode, "STATUS_WIDGET_EXTRACT_EXHAUSTED");
  });

  it("same-model fallback config skips third call", async () => {
    const kinds: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      kinds.push(opts.requestKind);
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller,
      primaryModelId: "deepseek/deepseek-chat-v3-0324",
      fallbackModelId: "deepseek/deepseek-chat-v3-0324",
    });
    assert.equal(kinds.length, 2);
    assert.equal(result.meta.character?.finalReasonCode, "STATUS_WIDGET_EXTRACT_EXHAUSTED");
  });

  it("6. character success / user fail → only user gets extra calls", async () => {
    const kinds: string[] = [];
    const caller: StatusWidgetExtractCaller = async (system, _history, opts) => {
      kinds.push(opts.requestKind);
      if (opts.requestKind === "background-status-widget-extract") {
        if (system.includes("default to [CHARACTER]")) {
          return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) };
        }
        return { text: "", usage: usage(1) };
      }
      if (opts.requestKind.includes("repair")) {
        return {
          text: JSON.stringify({ 기분: "긴장", 위치: "복도", extracted_facts: [] }),
          usage: usage(2),
        };
      }
      return { text: "", usage: usage(1) };
    };

    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "따라간다",
      assistantProse: "복도에서 유저가 긴장한 채 선다.",
      resolved: bothResolved(),
      caller,
      fallbackModelId: null,
    });

    assert.equal(result.meta.character?.callCount, 1);
    assert.equal(result.meta.user?.callCount, 2);
    assert.equal(result.values.user?.["기분"], "긴장");
  });

  it("7. temporal unknown values are rejected by existing validator", async () => {
    const caller: StatusWidgetExtractCaller = async () => ({
      text: JSON.stringify({
        시간: "알 수 없음",
        장소: "카페",
        속마음: "차분하다",
        현재상황: "대화",
        의식의흐름: "생각 중",
        extracted_facts: [],
      }),
      usage: usage(1),
    });
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "카페에서 대화했다.",
      resolved: characterResolved(),
      caller,
      fallbackModelId: null,
    });
    assert.notEqual(result.values.character?.["시간"], "알 수 없음");
    assert.equal(result.values.character?.["장소"], "카페");
  });

  it("8. regeneration with different place/time does not copy previous variant", async () => {
    const caller: StatusWidgetExtractCaller = async () => ({
      text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "19:00", 장소: "해변" }),
      usage: usage(1),
    });
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "바다로",
      assistantProse: "해변에 도착했다. 지금은 19:00.",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "09:00", 장소: "학교" } },
      caller,
      fallbackModelId: null,
    });
    assert.equal(result.values.character?.["시간"], "19:00");
    assert.equal(result.values.character?.["장소"], "해변");
  });

  it("9. extracted_facts are merged once without duplicates across sources", async () => {
    const fact = {
      category: "preference",
      subject: "user",
      attribute: "favorite_drink",
      value: "coffee",
      importance: "important",
      fact_text: "사용자는 커피를 즐겨 마신다.",
    };
    const caller: StatusWidgetExtractCaller = async (system, _history, opts) => {
      if (opts.requestKind !== "background-status-widget-extract") {
        return { text: "", usage: usage(1) };
      }
      if (system.includes("default to [CHARACTER]")) {
        return {
          text: JSON.stringify({
            시간: "10:00",
            장소: "카페",
            속마음: "평온",
            현재상황: "대화",
            의식의흐름: "생각",
            extracted_facts: [fact, fact],
          }),
          usage: usage(1),
        };
      }
      return {
        text: JSON.stringify({
          기분: "좋음",
          위치: "카페",
          extracted_facts: [fact],
        }),
        usage: usage(1),
      };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "커피",
      assistantProse: "카페에서 커피를 마셨다.",
      resolved: bothResolved(),
      caller,
      fallbackModelId: null,
    });
    assert.equal((result.values.extracted_facts ?? []).length, 1);
  });
});

describe("repair previous canonical anchor", () => {
  it("A. previous clock kept when RP has no time advance (prompt contains 18:30)", async () => {
    let repairBlock = "";
    const caller: StatusWidgetExtractCaller = async (_s, history, opts) => {
      if (opts.requestKind.includes("repair")) {
        repairBlock = history[0]?.content ?? "";
        return {
          text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "18:30", 장소: "복도" }),
          usage: usage(2),
        };
      }
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "계속",
      assistantProse: "복도에서 잠시 숨을 고른다.",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "18:30", 장소: "복도" } },
      caller,
      fallbackModelId: null,
    });
    assert.match(repairBlock, /PREVIOUS CANONICAL WIDGET VALUES/);
    assert.match(repairBlock, /18:30/);
    assert.equal(result.values.character?.["시간"], "18:30");
  });

  it("B. previous clock + two hours later in RP → repair returns 20:30", async () => {
    const caller: StatusWidgetExtractCaller = async (_s, history, opts) => {
      if (opts.requestKind.includes("repair")) {
        assert.match(history[0]?.content ?? "", /18:30/);
        assert.match(history[0]?.content ?? "", /두 시간 후/);
        return {
          text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "20:30", 장소: "복도" }),
          usage: usage(2),
        };
      }
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "기다린다",
      assistantProse: "두 시간 후, 복도에 다시 선다.",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "18:30", 장소: "복도" } },
      caller,
      fallbackModelId: null,
    });
    assert.equal(result.values.character?.["시간"], "20:30");
  });

  it("C. repair prompt uses finalized previous 18:30, never regen variant 23:00", async () => {
    let repairBlock = "";
    const caller: StatusWidgetExtractCaller = async (_s, history, opts) => {
      if (opts.requestKind.includes("repair")) {
        repairBlock = history[0]?.content ?? "";
        return {
          text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "18:30" }),
          usage: usage(2),
        };
      }
      return { text: "", usage: usage(1) };
    };
    // Only pass loadPrevious-style finalized anchor — never the active regen variant snapshot.
    await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면이 이어진다.",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "18:30", 장소: "복도" } },
      caller,
      fallbackModelId: null,
    });
    assert.match(repairBlock, /18:30/);
    assert.doesNotMatch(repairBlock, /23:00/);
    // Explicitly prove variant snapshot was never an argument path — formatter alone.
    const formatted = formatPreviousCanonicalWidgetValuesForRepair(
      { 시간: "18:30", 장소: "복도" },
      DEFAULT_STATUS_WIDGET
    );
    assert.match(formatted, /18:30/);
    assert.doesNotMatch(formatted, /23:00/);
  });

  it("D. previous 장소=복도, RP moves to 사령실 → repair result is 사령실", async () => {
    const caller: StatusWidgetExtractCaller = async (_s, history, opts) => {
      if (opts.requestKind.includes("repair")) {
        assert.match(history[0]?.content ?? "", /복도/);
        assert.match(history[0]?.content ?? "", /사령실/);
        return {
          text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 장소: "사령실", 시간: "18:30" }),
          usage: usage(2),
        };
      }
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "이동",
      assistantProse: "사령실 문으로 들어선다.",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "18:30", 장소: "복도" } },
      caller,
      fallbackModelId: null,
    });
    assert.equal(result.values.character?.["장소"], "사령실");
  });

  it("repair prompt stays slim (no identity / previous prose dump)", () => {
    const keys = ["시간", "장소"];
    const system = buildWidgetExtractRepairSystem(keys);
    const user = buildWidgetExtractRepairUserBlock({
      keys,
      assistantProse: "해변 저녁 장면",
      previousValues: { 시간: "18:30", 장소: "복도" },
      widget: DEFAULT_STATUS_WIDGET,
    });
    assert.match(system, /Fill priority/);
    assert.match(user, /PREVIOUS CANONICAL WIDGET VALUES/);
    assert.match(user, /18:30/);
    assert.doesNotMatch(user, /CHARACTER IDENTITY/);
    assert.doesNotMatch(user, /PREVIOUS TURN ASSISTANT/);
    assert.doesNotMatch(user, /USER MESSAGE/);
  });
});

describe("extract usage merge across attempts", () => {
  it("1. initial success → usage 1 attempt", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller: async () => ({ text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) }),
      fallbackModelId: null,
    });
    assert.equal(result.meta.totalCallCount, 1);
    assert.equal(result.usage?.inputTokens, 11);
    assert.equal(result.usage?.outputTokens, 6);
    assert.equal(result.meta.mergedInputTokens, 11);
  });

  it("2. initial empty + repair success → usage 2 attempts summed", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller: async (_s, _h, opts) => {
        if (opts.requestKind.includes("repair")) {
          return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(20) };
        }
        return { text: "", usage: usage(10) };
      },
      fallbackModelId: null,
    });
    assert.equal(result.meta.totalCallCount, 2);
    assert.equal(result.usage?.inputTokens, (10 + 10) + (10 + 20));
    assert.equal(result.usage?.outputTokens, (5 + 10) + (5 + 20));
    assert.equal(result.meta.character?.attemptUsages.length, 2);
  });

  it("3. initial + repair fail + fallback success → usage 3 attempts summed", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller: async (_s, _h, opts) => {
        if (opts.requestKind.includes("fallback")) {
          return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(30) };
        }
        return { text: "", usage: usage(opts.requestKind.includes("repair") ? 20 : 10) };
      },
      primaryModelId: "deepseek/deepseek-chat-v3-0324",
      fallbackModelId: "google/gemini-2.5-flash",
    });
    assert.equal(result.meta.totalCallCount, 3);
    const expectedIn = (10 + 10) + (10 + 20) + (10 + 30);
    assert.equal(result.usage?.inputTokens, expectedIn);
    assert.equal(result.meta.character?.attemptUsages.length, 3);
  });

  it("4. character 1 + user 3 → total 4 attempts merged", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(),
      caller: async (system, _h, opts) => {
        if (opts.requestKind === "background-status-widget-extract") {
          if (system.includes("default to [CHARACTER]")) {
            return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) };
          }
          return { text: "", usage: usage(2) };
        }
        if (opts.requestKind.includes("repair")) {
          return { text: "", usage: usage(3) };
        }
        return {
          text: JSON.stringify({ 기분: "ok", 위치: "여기", extracted_facts: [] }),
          usage: usage(4),
        };
      },
      primaryModelId: "deepseek/deepseek-chat-v3-0324",
      fallbackModelId: "google/gemini-2.5-flash",
    });
    assert.equal(result.meta.character?.callCount, 1);
    assert.equal(result.meta.user?.callCount, 3);
    assert.equal(result.meta.totalCallCount, 4);
    assert.equal(result.meta.character?.attemptUsages.length, 1);
    assert.equal(result.meta.user?.attemptUsages.length, 3);
    const expectedIn = (10 + 1) + (10 + 2) + (10 + 3) + (10 + 4);
    assert.equal(result.usage?.inputTokens, expectedIn);
  });

  it("5. API throw without usage → only received usages merged (no NaN)", async () => {
    let n = 0;
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller: async (_s, _h, opts) => {
        n += 1;
        if (opts.requestKind.includes("repair")) {
          throw new Error("boom");
        }
        return { text: "", usage: usage(7) };
      },
      fallbackModelId: null,
    });
    assert.equal(n, 2);
    assert.equal(result.usage?.inputTokens, 17);
    assert.ok(Number.isFinite(result.usage?.inputTokens));
    assert.ok((result.usage?.inputTokens ?? -1) >= 0);
    assert.equal(result.meta.character?.attemptUsages.length, 1);
  });

  it("6. merged usage feeds applyStatusWidgetBillingCharge / receipt", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller: async (_s, _h, opts) => {
        if (opts.requestKind.includes("repair")) {
          return {
            text: jsonForWidget(DEFAULT_STATUS_WIDGET),
            usage: {
              inputTokens: 800,
              outputTokens: 40,
              estimated: false,
              upstreamCostUsd: 0.001,
            },
          };
        }
        return {
          text: "",
          usage: {
            inputTokens: 1000,
            outputTokens: 50,
            estimated: false,
            upstreamCostUsd: 0.002,
          },
        };
      },
      fallbackModelId: null,
    });
    assert.equal(result.meta.totalCallCount, 2);
    assert.equal(result.usage?.inputTokens, 1800);
    assert.equal(result.usage?.outputTokens, 90);

    const exchangeRate = resolveBillingExchangeRateSnapshot();
    const base: Usage = {
      input: 10000,
      output: 1000,
      model: "deepseek/deepseek-v4-pro",
      provider: "openrouter",
      route: "nsfw",
      cost: 48,
      baseCost: 48,
      breakdown: [],
      apiInputTokens: 17970,
      apiOutputTokens: 1500,
      apiRawCostKrw: 33,
      mainApiRawCostKrw: 33,
    };
    const billed = applyStatusWidgetBillingCharge(base, result.usage!, exchangeRate, 48);
    assert.equal(billed.record.statusWidgetExtract?.input, 1800);
    assert.equal(billed.record.statusWidgetExtract?.output, 90);
    assert.ok(billed.widgetCostPoints > 0);
    assert.equal(billed.totalCost, 48 + billed.widgetCostPoints);

    const mergedAgain = mergeStatusWidgetExtractUsages([
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      { inputTokens: Number.NaN, outputTokens: -5, estimated: false },
    ]);
    assert.equal(mergedAgain?.inputTokens, 1000);
    assert.equal(mergedAgain?.outputTokens, 50);
  });
});
