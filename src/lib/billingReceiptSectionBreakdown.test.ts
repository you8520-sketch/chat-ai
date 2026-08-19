import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEstimatedReceiptSectionBreakdown } from "@/lib/billingReceiptSectionBreakdown";

describe("billing receipt section breakdown runtime", () => {
  it("renders character label using splitChars before map (no TDZ)", () => {
    const splitChars = {
      characterSettingsBlock: "x".repeat(12_345),
      systemRulesBlock: "rules",
      dynamicBlock: "dynamic",
    };

    assert.doesNotThrow(() => {
      const breakdown = buildEstimatedReceiptSectionBreakdown({
        sectionEsts: [
          { key: "raw", est: 1000 },
          { key: "character", est: 500 },
          { key: "system", est: 200 },
        ],
        draftInput: 10_000,
        splitChars,
        charPromptEst: 999,
        rawHistoryChars: 4321,
        rawCompleteExchanges: 4,
      });

      const character = breakdown.find((row) => row.label.includes("캐릭터 프롬프트"));
      assert.ok(character);
      assert.match(character!.label, /12,345 chars/);
      assert.match(character!.label, /토큰 배분/);

      const raw = breakdown.find((row) => row.label.includes("최근 RAW"));
      assert.ok(raw);
      assert.match(raw!.label, /4 exchanges/);
      assert.match(raw!.label, /4,321 chars/);

      const totalTokens = breakdown.reduce((sum, row) => sum + row.tokens, 0);
      assert.ok(totalTokens >= 9990 && totalTokens <= 10_000);
    });
  });
});
