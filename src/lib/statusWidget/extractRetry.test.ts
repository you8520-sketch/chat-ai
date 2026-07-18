import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_STATUS_WIDGET } from "./defaultTemplate";
import {
  extractStatusWidgetValuesForTurn,
  type StatusWidgetExtractCaller,
} from "./extract";
import {
  buildWidgetExtractRepairSystem,
  buildWidgetExtractRepairUserBlock,
  dropRepairEchoFields,
  formatPreviousCanonicalWidgetValuesForRepair,
  resolveRepairMaxTokens,
  sliceAssistantProseForRepair,
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
import { OPENROUTER_GEMINI_25_FLASH_MODEL } from "@/lib/chatModels";

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
  characterWidget: StatusWidget,
  userWidget: StatusWidget
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

describe("status widget empty-extract retry (V3 repair only)", () => {
  it("initial success → no repair call", async () => {
    const kinds: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      kinds.push(opts.requestKind);
      return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "카페에서 마주쳤다.",
      resolved: characterResolved(),
      caller,
    });
    assert.deepEqual(kinds, ["background-status-widget-extract"]);
    assert.equal(result.meta.totalCallCount, 1);
    assert.equal(result.meta.usedRepair, false);
  });

  it("initial empty → repair success", async () => {
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
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
      userMessage: "이동",
      assistantProse: "도서관으로 갔다. 오후 3시.",
      resolved: characterResolved(),
      caller,
    });
    assert.equal(result.meta.character?.finalReasonCode, "V3_REPAIR_USED");
    assert.equal(result.values.character?.["시간"], "15:00");
  });

  it("all fail → empty; no previous snapshot copy", async () => {
    const caller: StatusWidgetExtractCaller = async () => ({ text: "", usage: usage(1) });
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "해변 저녁",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "09:00", 장소: "옛장소" } },
      caller,
    });
    assert.equal(result.meta.exhausted, true);
    assert.equal(result.values.character, null);
    assert.equal(result.meta.totalCallCount, 2);
    assert.ok(result.usage);
    assert.ok(result.meta.billing);
    assert.equal(result.meta.billing!.callCount, 2);
  });

  it("character success / user fail → only user repairs", async () => {
    const kinds: string[] = [];
    const caller: StatusWidgetExtractCaller = async (_system, _h, opts) => {
      kinds.push(opts.requestKind);
      if (opts.requestKind.includes("combined")) {
        return {
          text: JSON.stringify({
            character_values: JSON.parse(jsonForWidget(DEFAULT_STATUS_WIDGET)),
            user_values: {},
            extracted_facts: [],
          }),
          usage: usage(1),
        };
      }
      return {
        text: JSON.stringify({ 기분: "긴장", 위치: "복도", extracted_facts: [] }),
        usage: usage(2),
      };
    };
    const userWidget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      name: "유저",
      fields: [
        { id: "기분", label: "기분", instruction: "유저의 현재 감정" },
        { id: "위치", label: "위치", instruction: "유저 위치" },
      ],
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "따라간다",
      assistantProse: "복도에서 유저가 긴장한다.",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller,
    });
    assert.deepEqual(kinds, [
      "background-status-widget-extract-combined",
      "background-status-widget-extract-repair",
    ]);
    assert.equal(result.meta.extractMode, "dual_combined");
    assert.equal(result.meta.character?.sharedCombinedInitial, true);
    assert.equal(result.meta.character?.callCount, 0);
    assert.equal(result.meta.user?.callCount, 1);
    assert.equal(result.meta.actualCallCount, 2);
    assert.equal(result.meta.totalCallCount, 2);
    assert.equal(result.values.user?.["기분"], "긴장");
  });

  it("regeneration does not copy previous variant place/time", async () => {
    const caller: StatusWidgetExtractCaller = async () => ({
      text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "19:00", 장소: "해변" }),
      usage: usage(1),
    });
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "바다로",
      assistantProse: "해변, 19:00.",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "09:00", 장소: "학교" } },
      caller,
    });
    assert.equal(result.values.character?.["장소"], "해변");
    assert.notEqual(result.values.character?.["장소"], "학교");
  });
});

describe("repair field contract + POV", () => {
  it("repair user block includes source, contract, user message, RP tail, previous", () => {
    const keys = collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET);
    const block = buildWidgetExtractRepairUserBlock({
      keys,
      widget: DEFAULT_STATUS_WIDGET,
      source: "character",
      charName: "레온",
      personaName: "렌",
      userMessage: "두 시간 기다린다",
      assistantProse: "복도에서 숨을 고른다.",
      previousValues: { 시간: "18:30", 장소: "복도" },
    });
    assert.match(block, /\[SOURCE\]\ncharacter/);
    assert.match(block, /Default subject: \[CHARACTER\]\(레온\)/);
    assert.match(block, /WIDGET FIELD CONTRACT/);
    assert.match(block, /instruction:/);
    assert.match(block, /CURRENT USER MESSAGE/);
    assert.match(block, /두 시간 기다린다/);
    assert.match(block, /ASSISTANT RP — FINAL SCENE PRIORITY/);
    assert.match(block, /PREVIOUS CANONICAL WIDGET VALUES/);
    assert.match(block, /18:30/);
    assert.doesNotMatch(block, /CHARACTER IDENTITY/);
  });

  it("1. character vs user inner-state same key → POV separated in contract", () => {
    const field = {
      id: "속마음",
      label: "속마음",
      instruction: "현재 속마음",
    };
    const charBlock = buildWidgetExtractRepairUserBlock({
      keys: ["속마음"],
      widget: { ...DEFAULT_STATUS_WIDGET, fields: [field] },
      source: "character",
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
    });
    const userBlock = buildWidgetExtractRepairUserBlock({
      keys: ["속마음"],
      widget: { ...DEFAULT_STATUS_WIDGET, fields: [field] },
      source: "user",
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
    });
    assert.match(charBlock, /defaultSubject: character/);
    assert.match(userBlock, /defaultSubject: user/);
  });

  it("2. 의식의 흐름 / 현재 감정 follow instruction/source", () => {
    const charWidget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [{ id: "의식의흐름", label: "의식의 흐름", instruction: "NPC의 의식의 흐름" }],
    };
    const userWidget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [{ id: "현재감정", label: "현재 감정", instruction: "유저의 현재 감정" }],
    };
    const charBlock = buildWidgetExtractRepairUserBlock({
      keys: ["의식의흐름"],
      widget: charWidget,
      source: "character",
      charName: "레온",
      personaName: "렌",
      assistantProse: "장면",
    });
    const userBlock = buildWidgetExtractRepairUserBlock({
      keys: ["현재감정"],
      widget: userWidget,
      source: "user",
      charName: "레온",
      personaName: "렌",
      assistantProse: "장면",
    });
    assert.match(charBlock, /defaultSubject: character/);
    assert.match(userBlock, /defaultSubject: user/);
    assert.match(buildWidgetExtractRepairSystem(["의식의흐름"], "character"), /default to \[CHARACTER\]/);
  });

  it("3. user message-only time is present in repair prompt", () => {
    const block = buildWidgetExtractRepairUserBlock({
      keys: ["시간"],
      widget: {
        ...DEFAULT_STATUS_WIDGET,
        fields: [{ id: "시간", label: "시간", instruction: "HH:MM" }],
      },
      source: "character",
      charName: "레온",
      personaName: "렌",
      userMessage: "지금은 14:30이야",
      assistantProse: "복도에서 잠시 선다.",
    });
    assert.match(block, /지금은 14:30이야/);
  });

  it("4. field initialValue appears in contract for first fill", () => {
    const block = buildWidgetExtractRepairUserBlock({
      keys: ["시간"],
      widget: {
        ...DEFAULT_STATUS_WIDGET,
        fields: [
          { id: "시간", label: "시간", instruction: "HH:MM 형식의 현재 시각", initialValue: "08:30" },
        ],
      },
      source: "character",
      charName: "레온",
      personaName: "렌",
      assistantProse: "아침 복도.",
      previousValues: null,
    });
    assert.match(block, /initialValue: 08:30/);
    assert.match(buildWidgetExtractRepairSystem(["시간"]), /Field initialValue/);
  });

  it("5. D-DAY / 만난일수 instruction kept in contract", () => {
    const block = buildWidgetExtractRepairUserBlock({
      keys: ["만난일수", "DDAY"],
      widget: {
        ...DEFAULT_STATUS_WIDGET,
        fields: [
          {
            id: "만난일수",
            label: "만난일수",
            instruction: "숫자만 표시. 1부터 시작하며 하루마다 1 증가",
            initialValue: "1",
          },
          { id: "DDAY", label: "D-DAY", instruction: "D-숫자 또는 미정" },
        ],
      },
      source: "character",
      charName: "레온",
      personaName: "렌",
      assistantProse: "장면",
    });
    assert.match(block, /1부터 시작하며 하루마다 1 증가/);
    assert.match(block, /D-숫자 또는 미정/);
  });
});

describe("repair previous canonical anchor", () => {
  it("A. previous 18:30 kept in repair prompt when RP has no advance", async () => {
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
    });
    assert.match(repairBlock, /18:30/);
    assert.equal(result.values.character?.["시간"], "18:30");
  });

  it("B. previous 18:30 + user says wait two hours → repair can return 20:30", async () => {
    const caller: StatusWidgetExtractCaller = async (_s, history, opts) => {
      if (opts.requestKind.includes("repair")) {
        assert.match(history[0]?.content ?? "", /18:30/);
        assert.match(history[0]?.content ?? "", /두 시간/);
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
      userMessage: "두 시간 기다린다",
      assistantProse: "복도에서 발걸음을 멈춘다.",
      resolved: characterResolved(),
      previousValues: { character: { 시간: "18:30", 장소: "복도" } },
      caller,
    });
    assert.equal(result.values.character?.["시간"], "20:30");
  });

  it("C. repair prompt has finalized 18:30, never regen variant 23:00", () => {
    const formatted = formatPreviousCanonicalWidgetValuesForRepair(
      { 시간: "18:30", 장소: "복도" },
      DEFAULT_STATUS_WIDGET
    );
    assert.match(formatted, /18:30/);
    assert.doesNotMatch(formatted, /23:00/);
  });

  it("D. previous 복도 + RP moves to 사령실", async () => {
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
    });
    assert.equal(result.values.character?.["장소"], "사령실");
  });
});

describe("repair echo validator", () => {
  it("drops exact instruction/label echoes but keeps other fields", () => {
    const widget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [
        { id: "시간", label: "시간", instruction: "HH:MM 형식의 현재 시각" },
        { id: "속마음", label: "속마음", instruction: "NPC의 속마음" },
        { id: "장소", label: "장소", instruction: "현재 장소" },
      ],
    };
    const filtered = dropRepairEchoFields(
      {
        시간: "HH:MM 형식의 현재 시각",
        속마음: "NPC의 속마음",
        장소: "사령실",
      },
      widget
    );
    assert.equal(filtered.values["장소"], "사령실");
    assert.equal(filtered.values["시간"], undefined);
    assert.equal(filtered.values["속마음"], undefined);
    assert.ok(filtered.droppedKeys.includes("시간"));
  });

  it("all-echo repair → exhausted / empty values", async () => {
    const widget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      fields: [
        { id: "속마음", label: "속마음", instruction: "NPC의 속마음" },
        { id: "장소", label: "장소", instruction: "현재 장소" },
      ],
    };
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      if (opts.requestKind.includes("repair")) {
        return {
          text: JSON.stringify({
            속마음: "NPC의 속마음",
            장소: "현재 장소",
            extracted_facts: [],
          }),
          usage: usage(2),
        };
      }
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(widget),
      caller,
    });
    assert.equal(result.meta.exhausted, true);
    assert.equal(result.values.character, null);
    assert.ok((result.meta.character?.echoDroppedKeys.length ?? 0) >= 1);
  });
});

describe("repair final-scene tail slice", () => {
  it("keeps last scene when prose exceeds budget", () => {
    const head = "오전 9시, 숙소에서 일어났다. ".repeat(800);
    const tail = "밤 11시, 옥상으로 이동했다.";
    const sliced = sliceAssistantProseForRepair(head + tail, 12_000);
    assert.match(sliced, /밤 11시/);
    assert.match(sliced, /옥상/);
    assert.ok(sliced.length <= 12_000);
  });

  it("repair prompt prefers final scene content", async () => {
    const head = "오전 9시, 숙소. ".repeat(900);
    const tail = "밤 11시, 옥상으로 이동.";
    let repairBlock = "";
    const caller: StatusWidgetExtractCaller = async (_s, history, opts) => {
      if (opts.requestKind.includes("repair")) {
        repairBlock = history[0]?.content ?? "";
        return {
          text: jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "23:00", 장소: "옥상" }),
          usage: usage(2),
        };
      }
      return { text: "", usage: usage(1) };
    };
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "이동",
      assistantProse: head + tail,
      resolved: characterResolved(),
      caller,
    });
    assert.match(repairBlock, /옥상/);
    assert.match(repairBlock, /밤 11시/);
    assert.equal(result.values.character?.["시간"], "23:00");
    assert.equal(result.values.character?.["장소"], "옥상");
  });
});

describe("repair maxTokens", () => {
  it("scales between 256 and 512 by field count / free-text", () => {
    const six = resolveRepairMaxTokens(
      {
        ...DEFAULT_STATUS_WIDGET,
        fields: Array.from({ length: 6 }, (_, i) => ({
          id: `f${i}`,
          label: `필드${i}`,
          instruction: "짧은 값",
        })),
      },
      ["a", "b", "c", "d", "e", "f"]
    );
    assert.equal(six, 256);

    const twelve = resolveRepairMaxTokens(
      {
        ...DEFAULT_STATUS_WIDGET,
        fields: Array.from({ length: 12 }, (_, i) => ({
          id: `f${i}`,
          label: `필드${i}`,
          instruction: "짧은 값",
        })),
      },
      Array.from({ length: 12 }, (_, i) => `f${i}`)
    );
    assert.ok(twelve >= 256 && twelve <= 512);
    assert.ok(twelve > six);

    const heavy = resolveRepairMaxTokens(
      {
        ...DEFAULT_STATUS_WIDGET,
        fields: [
          { id: "속마음", label: "속마음", instruction: "NPC의 속마음 서술" },
          { id: "의식", label: "의식의 흐름", instruction: "의식의 흐름 문장" },
          ...Array.from({ length: 10 }, (_, i) => ({
            id: `f${i}`,
            label: `필드${i}`,
            instruction: "값",
          })),
        ],
      },
      Array.from({ length: 12 }, (_, i) => `k${i}`)
    );
    assert.ok(heavy <= 512);
    assert.ok(heavy >= twelve);
  });

  it("repair call uses dynamic maxTokens", async () => {
    let seenMax: number | undefined;
    const caller: StatusWidgetExtractCaller = async (_s, _h, opts) => {
      if (opts.requestKind.includes("repair")) {
        seenMax = opts.maxTokens;
        return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(2) };
      }
      return { text: "", usage: usage(1) };
    };
    await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller,
    });
    assert.equal(typeof seenMax, "number");
    assert.ok((seenMax ?? 0) >= 256 && (seenMax ?? 0) <= 512);
  });
});

describe("extract usage merge", () => {
  it("initial success → 1 usage", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller: async () => ({ text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) }),
    });
    assert.equal(result.meta.totalCallCount, 1);
    assert.equal(result.usage?.inputTokens, 11);
  });

  it("initial + repair → 2 usages summed", async () => {
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
    });
    assert.equal(result.meta.totalCallCount, 2);
    assert.equal(result.usage?.inputTokens, 50);
  });

  it("throw without usage → only received usages; no NaN", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller: async (_s, _h, opts) => {
        if (opts.requestKind.includes("repair")) throw new Error("boom");
        return { text: "", usage: usage(7) };
      },
    });
    assert.equal(result.usage?.inputTokens, 17);
    assert.ok(Number.isFinite(result.usage?.inputTokens));
  });

  it("merged usage feeds billing receipt", async () => {
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
            usage: { inputTokens: 800, outputTokens: 40, estimated: false, upstreamCostUsd: 0.001 },
          };
        }
        return {
          text: "",
          usage: { inputTokens: 1000, outputTokens: 50, estimated: false, upstreamCostUsd: 0.002 },
        };
      },
    });
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
      apiCallCount: 1,
    };
    assert.ok(result.meta.billing);
    assert.equal(result.meta.billing!.callCount, 2);
    assert.equal(result.meta.totalCallCount, 2);
    const billed = applyStatusWidgetBillingCharge(
      base,
      result.usage!,
      exchangeRate,
      48,
      result.meta.billing!
    );
    assert.equal(billed.record.statusWidgetExtract?.input, 1800);
    assert.equal(billed.record.statusWidgetExtract?.callCount, 2);
    assert.equal(billed.record.apiCallCount, 3);
    assert.equal(billed.record.stages?.some((s) => s.stage === "상태창 추출"), true);
    assert.ok(billed.widgetCostPoints > 0);
    const merged = mergeStatusWidgetExtractUsages([
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      { inputTokens: Number.NaN, outputTokens: -5, estimated: false },
    ]);
    assert.equal(merged?.inputTokens, 1000);
    assert.equal(merged?.outputTokens, 50);
  });

  it("billingModelId follows primaryModelId (Flash), not main RP", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      primaryModelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      caller: async (_s, _h, opts) => {
        assert.equal(opts.modelId, OPENROUTER_GEMINI_25_FLASH_MODEL);
        return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) };
      },
    });
    assert.equal(result.meta.billingModelId, OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.equal(result.meta.billing?.modelId, OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.equal(result.meta.billing?.callCount, 1);
  });

  it("dual combined both miss + repair → totalCallCount 3", async () => {
    const userWidget: StatusWidget = {
      ...DEFAULT_STATUS_WIDGET,
      name: "유저",
      fields: [
        { id: "기분", label: "기분", instruction: "유저의 현재 감정" },
        { id: "위치", label: "위치", instruction: "유저 위치" },
      ],
    };
    const kinds: string[] = [];
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      primaryModelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      caller: async (system, _h, opts) => {
        kinds.push(opts.requestKind);
        if (opts.requestKind.includes("repair")) {
          if (system.includes("default to [USER]")) {
            return {
              text: JSON.stringify({ 기분: "긴장", 위치: "복도", extracted_facts: [] }),
              usage: { inputTokens: 200, outputTokens: 40, estimated: true },
            };
          }
          return {
            text: jsonForWidget(DEFAULT_STATUS_WIDGET),
            usage: { inputTokens: 200, outputTokens: 40, estimated: true },
          };
        }
        return {
          text: "",
          usage: { inputTokens: 1800, outputTokens: 20, estimated: true },
        };
      },
    });
    assert.equal(result.meta.extractMode, "dual_combined");
    assert.equal(result.meta.character?.callCount, 1);
    assert.equal(result.meta.user?.callCount, 1);
    assert.equal(result.meta.actualCallCount, 3);
    assert.equal(result.meta.totalCallCount, 3);
    assert.equal(result.meta.billing?.callCount, 3);
    assert.equal(result.usage?.inputTokens, 1800 + 200 + 200);
    assert.deepEqual(kinds, [
      "background-status-widget-extract-combined",
      "background-status-widget-extract-repair",
      "background-status-widget-extract-repair",
    ]);
  });
});

describe("dual combined status extract", () => {
  const userWidget: StatusWidget = {
    ...DEFAULT_STATUS_WIDGET,
    name: "유저",
    fields: [
      { id: "기분", label: "기분", instruction: "유저의 현재 감정" },
      { id: "위치", label: "위치", instruction: "유저 위치" },
    ],
  };

  const validFact = {
    category: "location",
    subject: "leon",
    attribute: "met_at",
    value: "cafe",
    importance: "normal",
    fact_text: "레온과 렌은 카페에서 처음 만났다.",
  };

  function combinedOk(): string {
    return JSON.stringify({
      character_values: JSON.parse(jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "14:00", 장소: "카페" })),
      user_values: { 기분: "설렘", 위치: "카페" },
      extracted_facts: [validFact],
    });
  }

  it("1. dual both missing, combined success → 1 call, callCount=1, usage once", async () => {
    let calls = 0;
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: "카페에서 만났다. 14시.",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      primaryModelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      caller: async (_s, _h, opts) => {
        calls += 1;
        assert.equal(opts.requestKind, "background-status-widget-extract-combined");
        return {
          text: combinedOk(),
          usage: { inputTokens: 4000, outputTokens: 180, estimated: false, upstreamCostUsd: 0.002 },
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.meta.extractMode, "dual_combined");
    assert.equal(result.meta.actualCallCount, 1);
    assert.equal(result.meta.billing?.callCount, 1);
    assert.equal(result.meta.billing?.modelId, OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.equal(result.values.character?.["시간"], "14:00");
    assert.equal(result.values.user?.["기분"], "설렘");
    assert.equal(result.usage?.inputTokens, 4000);
    assert.equal(result.usage?.upstreamCostUsd, 0.002);
    assert.ok((result.values.extracted_facts?.length ?? 0) >= 1);
  });

  it("2. combined char ok / user fail → user repair only, callCount=2", async () => {
    const kinds: string[] = [];
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller: async (_s, _h, opts) => {
        kinds.push(opts.requestKind);
        if (opts.requestKind.includes("combined")) {
          return {
            text: JSON.stringify({
              character_values: JSON.parse(jsonForWidget(DEFAULT_STATUS_WIDGET)),
              user_values: { 기분: "유저의 현재 감정" },
              extracted_facts: [validFact],
            }),
            usage: usage(1),
          };
        }
        return {
          text: JSON.stringify({ 기분: "긴장", 위치: "복도", extracted_facts: [] }),
          usage: usage(2),
        };
      },
    });
    assert.deepEqual(kinds, [
      "background-status-widget-extract-combined",
      "background-status-widget-extract-repair",
    ]);
    assert.equal(result.meta.actualCallCount, 2);
    assert.ok(result.values.character);
    assert.equal(result.values.user?.["기분"], "긴장");
    assert.ok(result.values.extracted_facts?.some((f) => f.fact_text.includes("카페")));
  });

  it("3. combined user ok / char fail → character repair only, callCount=2", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller: async (system, _h, opts) => {
        if (opts.requestKind.includes("combined")) {
          return {
            text: JSON.stringify({
              character_values: {},
              user_values: { 기분: "평온", 위치: "방" },
              extracted_facts: [],
            }),
            usage: usage(1),
          };
        }
        assert.ok(system.includes("default to [CHARACTER]"));
        return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(2) };
      },
    });
    assert.equal(result.meta.actualCallCount, 2);
    assert.ok(result.values.character);
    assert.equal(result.values.user?.["기분"], "평온");
  });

  it("4. both fail → each source repair once, callCount=3", async () => {
    const kinds: string[] = [];
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller: async (_s, _h, opts) => {
        kinds.push(opts.requestKind);
        if (opts.requestKind.includes("combined")) {
          return { text: JSON.stringify({ character_values: {}, user_values: {} }), usage: usage(1) };
        }
        if (_s.includes("default to [USER]")) {
          return {
            text: JSON.stringify({ 기분: "긴장", 위치: "복도", extracted_facts: [] }),
            usage: usage(2),
          };
        }
        return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(2) };
      },
    });
    assert.equal(result.meta.actualCallCount, 3);
    assert.equal(kinds.filter((k) => k.includes("repair")).length, 2);
    assert.ok(!kinds.some((k) => k === "background-status-widget-extract"));
    assert.ok(result.values.character);
    assert.ok(result.values.user);
  });

  it("5. combined JSON parse fail → source repairs, callCount<=3", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller: async (_s, _h, opts) => {
        if (opts.requestKind.includes("combined")) {
          return { text: "not-json", usage: usage(1) };
        }
        if (_s.includes("default to [USER]")) {
          return {
            text: JSON.stringify({ 기분: "긴장", 위치: "복도", extracted_facts: [] }),
            usage: usage(2),
          };
        }
        return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(2) };
      },
    });
    assert.equal(result.meta.actualCallCount, 3);
    assert.ok(result.values.character);
    assert.ok(result.values.user);
  });

  it("6. seed character only → no combined; user single extract", async () => {
    const kinds: string[] = [];
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      seedValues: {
        character: { 시간: "10:00", 장소: "학교" },
      },
      caller: async (_s, _h, opts) => {
        kinds.push(opts.requestKind);
        return {
          text: JSON.stringify({ 기분: "긴장", 위치: "복도", extracted_facts: [] }),
          usage: usage(1),
        };
      },
    });
    assert.equal(result.meta.extractMode, "single");
    assert.ok(!kinds.some((k) => k.includes("combined")));
    assert.deepEqual(kinds, ["background-status-widget-extract"]);
    assert.equal(result.values.character?.["시간"], "10:00");
    assert.equal(result.values.user?.["기분"], "긴장");
    assert.equal(result.meta.actualCallCount, 1);
  });

  it("7. seed both → background 0", async () => {
    let calls = 0;
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      seedValues: {
        character: { 시간: "10:00", 장소: "학교" },
        user: { 기분: "평온", 위치: "교실" },
      },
      caller: async () => {
        calls += 1;
        return { text: "", usage: usage(1) };
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.meta.actualCallCount, 0);
    assert.equal(result.meta.billing, null);
    assert.equal(result.values.character?.["시간"], "10:00");
    assert.equal(result.values.user?.["기분"], "평온");
  });

  it("8. temporal unknown dropped; sibling fields kept", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "카페",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller: async () => ({
        text: JSON.stringify({
          character_values: {
            ...JSON.parse(jsonForWidget(DEFAULT_STATUS_WIDGET, { 장소: "카페" })),
            시간: "알 수 없음",
          },
          user_values: { 기분: "설렘", 위치: "카페" },
          extracted_facts: [],
        }),
        usage: usage(1),
      }),
    });
    assert.equal(result.values.character?.["장소"], "카페");
    assert.notEqual(result.values.character?.["시간"], "알 수 없음");
    assert.equal(result.values.user?.["기분"], "설렘");
  });

  it("9. anti-echo drops echoing field only", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller: async () => ({
        text: JSON.stringify({
          character_values: JSON.parse(
            jsonForWidget(DEFAULT_STATUS_WIDGET, { 속마음: "NPC의 속마음", 장소: "옥상" })
          ),
          user_values: { 기분: "긴장", 위치: "옥상" },
          extracted_facts: [],
        }),
        usage: usage(1),
      }),
    });
    assert.equal(result.values.character?.["장소"], "옥상");
    assert.ok(!result.values.character?.["속마음"] || result.values.character?.["속마음"] !== "NPC의 속마음");
    assert.equal(result.values.user?.["기분"], "긴장");
  });

  it("10. regen uses previousValues anchor only (no variant snapshot copy)", async () => {
    let userBlock = "";
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "다시",
      assistantProse: "해변, 19:00.",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      // Simulates loadPrevious(..., { excludeMessageId: regenTarget }) — never the regen variant.
      previousValues: {
        character: { 시간: "09:00", 장소: "학교" },
        user: { 기분: "평온", 위치: "교실" },
      },
      caller: async (_s, history, opts) => {
        if (opts.requestKind.includes("combined")) {
          userBlock = history[0]?.content ?? "";
          return {
            text: JSON.stringify({
              character_values: JSON.parse(
                jsonForWidget(DEFAULT_STATUS_WIDGET, { 시간: "19:00", 장소: "해변" })
              ),
              user_values: { 기분: "설렘", 위치: "해변" },
              extracted_facts: [],
            }),
            usage: usage(1),
          };
        }
        throw new Error("unexpected repair");
      },
    });
    assert.match(userBlock, /PREVIOUS TURN CHARACTER WIDGET VALUES/);
    assert.match(userBlock, /09:00/);
    assert.match(userBlock, /학교/);
    assert.equal(result.values.character?.["장소"], "해변");
    assert.notEqual(result.values.character?.["장소"], "학교");
    assert.equal(result.meta.actualCallCount, 1);
  });

  it("11. facts kept when one source fails", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller: async (_s, _h, opts) => {
        if (opts.requestKind.includes("combined")) {
          return {
            text: JSON.stringify({
              character_values: JSON.parse(jsonForWidget(DEFAULT_STATUS_WIDGET)),
              user_values: {},
              extracted_facts: [validFact],
            }),
            usage: usage(1),
          };
        }
        return {
          text: JSON.stringify({ 기분: "긴장", 위치: "복도", extracted_facts: [] }),
          usage: usage(2),
        };
      },
    });
    assert.ok(result.values.extracted_facts?.some((f) => f.fact_text.includes("카페")));
    assert.ok(result.values.character);
    assert.ok(result.values.user);
  });

  it("12. malformed facts do not wipe status", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      caller: async () => ({
        text: JSON.stringify({
          character_values: JSON.parse(jsonForWidget(DEFAULT_STATUS_WIDGET)),
          user_values: { 기분: "긴장", 위치: "복도" },
          extracted_facts: ["bad", null, { fact: "ok", kind: "event" }, validFact],
        }),
        usage: usage(1),
      }),
    });
    assert.ok(result.values.character);
    assert.ok(result.values.user);
    assert.ok(result.values.extracted_facts?.every((f) => typeof f.fact_text === "string"));
    assert.equal(result.values.extracted_facts?.length, 1);
  });

  it("13. billing callCount 1 and upstream not doubled", async () => {
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
      primaryModelId: OPENROUTER_GEMINI_25_FLASH_MODEL,
      caller: async () => ({
        text: combinedOk(),
        usage: {
          inputTokens: 5000,
          outputTokens: 200,
          estimated: false,
          upstreamCostUsd: 0.003,
        },
      }),
    });
    assert.equal(result.meta.billing?.callCount, 1);
    assert.equal(result.meta.billing?.modelId, OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.equal(result.usage?.upstreamCostUsd, 0.003);
    assert.equal(result.usage?.inputTokens, 5000);
    const rate = resolveBillingExchangeRateSnapshot();
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
      apiCallCount: 1,
    };
    const billed = applyStatusWidgetBillingCharge(
      base,
      result.usage!,
      rate,
      48,
      result.meta.billing!
    );
    assert.equal(billed.record.statusWidgetExtract?.callCount, 1);
    assert.equal(billed.record.statusWidgetExtract?.model, OPENROUTER_GEMINI_25_FLASH_MODEL);
    assert.equal(billed.record.apiCallCount, 2);
    assert.equal(billed.record.statusWidgetExtract?.input, 5000);
  });

  it("14. inactive → no combined / no extract", async () => {
    let calls = 0;
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: {
        ...bothResolved(DEFAULT_STATUS_WIDGET, userWidget),
        active: false,
      },
      caller: async () => {
        calls += 1;
        return { text: combinedOk(), usage: usage(1) };
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.meta.actualCallCount, 0);
    assert.equal(result.meta.billing, null);
  });

  it("15. character-only unchanged (no combined)", async () => {
    const kinds: string[] = [];
    const result = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "x",
      assistantProse: "장면",
      resolved: characterResolved(),
      caller: async (_s, _h, opts) => {
        kinds.push(opts.requestKind);
        return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) };
      },
    });
    assert.deepEqual(kinds, ["background-status-widget-extract"]);
    assert.equal(result.meta.extractMode, "single");
    assert.equal(result.meta.actualCallCount, 1);
  });
});
