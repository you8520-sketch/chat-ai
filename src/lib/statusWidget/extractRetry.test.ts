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
  });

  it("character success / user fail → only user repairs", async () => {
    const caller: StatusWidgetExtractCaller = async (system, _h, opts) => {
      if (opts.requestKind === "background-status-widget-extract") {
        if (system.includes("default to [CHARACTER]")) {
          return { text: jsonForWidget(DEFAULT_STATUS_WIDGET), usage: usage(1) };
        }
        return { text: "", usage: usage(1) };
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
    assert.equal(result.meta.character?.callCount, 1);
    assert.equal(result.meta.user?.callCount, 2);
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
    };
    const billed = applyStatusWidgetBillingCharge(base, result.usage!, exchangeRate, 48);
    assert.equal(billed.record.statusWidgetExtract?.input, 1800);
    assert.ok(billed.widgetCostPoints > 0);
    const merged = mergeStatusWidgetExtractUsages([
      { inputTokens: 1000, outputTokens: 50, estimated: false },
      { inputTokens: Number.NaN, outputTokens: -5, estimated: false },
    ]);
    assert.equal(merged?.inputTokens, 1000);
    assert.equal(merged?.outputTokens, 50);
  });
});
