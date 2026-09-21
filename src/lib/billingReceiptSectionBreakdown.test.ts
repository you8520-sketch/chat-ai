import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEstimatedReceiptSectionBreakdown,
  CHARACTER_RECEIPT_CHAR_SCOPE,
  sumCharacterReceiptContextChars,
} from "@/lib/billingReceiptSectionBreakdown";

/** User-reported Admin Receipt v3 fixture (draftInput = sum of section estimates). */
const REPORTED_FIXTURE = {
  draftInput: 28_649,
  sectionEsts: [
    { key: "raw" as const, est: 8642 },
    { key: "character" as const, est: 14_203 },
    { key: "system" as const, est: 4203 },
    { key: "memory" as const, est: 1225 },
    { key: "persona" as const, est: 376 },
  ],
  expectedTokens: {
    raw: 8642,
    character: 14_203,
    system: 4203,
    memory: 1225,
    persona: 376,
  },
};

function findBreakdownRowByLabelPrefix(
  breakdown: { label: string; tokens: number; pct: number }[],
  prefix: string
) {
  return breakdown.find((row) => row.label.startsWith(prefix));
}

describe("billing receipt section breakdown", () => {
  it("A. reported fixture — allocation sum equals draftInput", () => {
    const breakdown = buildEstimatedReceiptSectionBreakdown({
      sectionEsts: REPORTED_FIXTURE.sectionEsts,
      draftInput: REPORTED_FIXTURE.draftInput,
      characterContextChars: 12_000,
      rawHistoryChars: 18_347,
      rawCompleteExchanges: 4,
    });

    const totalTokens = breakdown.reduce((sum, row) => sum + row.tokens, 0);
    assert.equal(totalTokens, REPORTED_FIXTURE.draftInput);

    assert.equal(
      findBreakdownRowByLabelPrefix(breakdown, "최근 RAW")?.tokens,
      REPORTED_FIXTURE.expectedTokens.raw
    );
    assert.equal(
      findBreakdownRowByLabelPrefix(breakdown, "캐릭터 컨텍스트")?.tokens,
      REPORTED_FIXTURE.expectedTokens.character
    );
    assert.equal(
      findBreakdownRowByLabelPrefix(breakdown, "시스템 프롬프트")?.tokens,
      REPORTED_FIXTURE.expectedTokens.system
    );
    assert.equal(
      findBreakdownRowByLabelPrefix(breakdown, "장기기억")?.tokens,
      REPORTED_FIXTURE.expectedTokens.memory
    );
    assert.equal(
      findBreakdownRowByLabelPrefix(breakdown, "페르소나")?.tokens,
      REPORTED_FIXTURE.expectedTokens.persona
    );

    const raw = findBreakdownRowByLabelPrefix(breakdown, "최근 RAW");
    assert.match(raw!.label, /18,347 chars/);
    assert.match(raw!.label, /4 exchanges/);
  });

  it("B. character chars match allocation semantic scope (not characterSettingsBlock)", () => {
    const proseOnlyBlock = "x".repeat(2676);
    const trackedSections = [
      {
        id: "character-core-identity",
        category: "characterSetting" as const,
        text: "y".repeat(8000),
      },
      {
        id: "world-lore",
        category: "worldLore" as const,
        text: "z".repeat(3000),
      },
      {
        id: "dialogue-examples",
        category: "dialogueExamples" as const,
        text: "w".repeat(1500),
      },
    ];
    const characterContextChars = sumCharacterReceiptContextChars(trackedSections);
    assert.equal(characterContextChars, 12_500);
    assert.notEqual(proseOnlyBlock.length, characterContextChars);

    const breakdown = buildEstimatedReceiptSectionBreakdown({
      sectionEsts: [
        { key: "raw", est: 1000 },
        { key: "character", est: 5000 },
        { key: "system", est: 2000 },
      ],
      draftInput: 10_000,
      characterContextChars,
      rawHistoryChars: 4321,
      rawCompleteExchanges: 4,
    });

    const character = findBreakdownRowByLabelPrefix(breakdown, "캐릭터 컨텍스트");
    assert.ok(character);
    assert.match(character!.label, /12,500 chars/);
    assert.doesNotMatch(character!.label, /2,676 chars/);
    assert.match(character!.label, /입력 토큰 추정 배분/);
    assert.deepEqual(Object.keys(character!).sort(), ["label", "pct", "tokens"]);
  });

  it("C. characterContextChars absent — token estimate never shown as chars", () => {
    const breakdown = buildEstimatedReceiptSectionBreakdown({
      sectionEsts: [
        { key: "raw", est: 1000 },
        { key: "character", est: 5000 },
        { key: "system", est: 2000 },
      ],
      draftInput: 10_000,
      characterContextChars: null,
      rawHistoryChars: 4321,
      rawCompleteExchanges: 4,
    });

    const character = findBreakdownRowByLabelPrefix(breakdown, "캐릭터 컨텍스트");
    assert.ok(character);
    assert.doesNotMatch(character!.label, /chars/);
  });

  it("D. keyword lore present — no double count in character chars", () => {
    const trackedSections = [
      {
        id: "character-core-identity",
        category: "characterSetting" as const,
        text: "a".repeat(1000),
      },
      {
        id: "keyword-lorebook",
        category: "worldLore" as const,
        text: "b".repeat(500),
      },
    ];

    const withKeyword = sumCharacterReceiptContextChars(trackedSections);
    const withoutKeyword = sumCharacterReceiptContextChars(trackedSections, {
      excludeKeywordLorebook: true,
    });
    assert.equal(withKeyword, 1500);
    assert.equal(withoutKeyword, 1000);
  });

  it("E. world lore + dialogue examples — chars align with token allocation scope", () => {
    const trackedSections = [
      {
        id: "character-core-identity",
        category: "characterSetting" as const,
        text: "c".repeat(2000),
      },
      {
        id: "world-lore",
        category: "worldLore" as const,
        text: "d".repeat(3000),
      },
      {
        id: "dialogue-examples",
        category: "dialogueExamples" as const,
        text: "e".repeat(1000),
      },
    ];
    const characterContextChars = sumCharacterReceiptContextChars(trackedSections);
    assert.equal(characterContextChars, 6000);

    const breakdown = buildEstimatedReceiptSectionBreakdown({
      sectionEsts: [{ key: "character", est: 6000 }],
      draftInput: 6000,
      characterContextChars,
      rawHistoryChars: 0,
      rawCompleteExchanges: 0,
    });
    const character = findBreakdownRowByLabelPrefix(breakdown, "캐릭터 컨텍스트");
    assert.match(character!.label, /6,000 chars/);
  });

  it("F. zero/empty optional sections — no divide-by-zero or NaN", () => {
    const breakdown = buildEstimatedReceiptSectionBreakdown({
      sectionEsts: [],
      draftInput: 0,
      characterContextChars: null,
      rawHistoryChars: 0,
      rawCompleteExchanges: 0,
    });
    assert.deepEqual(breakdown, []);

    const single = buildEstimatedReceiptSectionBreakdown({
      sectionEsts: [{ key: "persona", est: 0 }],
      draftInput: 100,
      characterContextChars: null,
      rawHistoryChars: 0,
      rawCompleteExchanges: 0,
    });
    assert.deepEqual(single, []);
    for (const row of single) {
      assert.ok(Number.isFinite(row.tokens));
      assert.ok(Number.isFinite(row.pct));
    }
  });

  it("documents BEFORE scope mismatch — characterSettingsBlock ≠ charPromptEst scope", () => {
    const characterSettingsBlockChars = 2676;
    const trackedSections = [
      {
        id: "character-core-identity",
        category: "characterSetting" as const,
        text: "f".repeat(10_000),
      },
      {
        id: "world-lore",
        category: "worldLore" as const,
        text: "g".repeat(3000),
      },
    ];
    const characterContextChars = sumCharacterReceiptContextChars(trackedSections);
    assert.equal(characterSettingsBlockChars, 2676);
    assert.equal(characterContextChars, 13_000);
    assert.notEqual(characterSettingsBlockChars, characterContextChars);
  });

  it("G. persisted rows stay label,tokens,pct only — allocation provenance is top-level", () => {
    const breakdown = buildEstimatedReceiptSectionBreakdown({
      sectionEsts: [
        { key: "raw", est: 100 },
        { key: "character", est: 200 },
      ],
      draftInput: 300,
      characterContextChars: 42,
      rawHistoryChars: 10,
      rawCompleteExchanges: 1,
    });
    for (const row of breakdown) {
      assert.deepEqual(Object.keys(row).sort(), ["label", "pct", "tokens"]);
    }
    assert.equal(CHARACTER_RECEIPT_CHAR_SCOPE, "characterSetting+worldLore+dialogueExamples");
  });
});
