import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRPG_SCENARIO_BUNDLE_LIMIT,
  countScenarioBundleChars,
  remainingScenarioFieldMax,
  scenarioBundleLimitError,
} from "./scenarioTypes";

describe("TRPG scenario bundle character limit", () => {
  it("counts linked world, scenario prose, hidden notes, and NPC cards together", () => {
    assert.equal(
      countScenarioBundleChars({
        worldSummary: "눈 덮인 공국",
        worldContent: "얼음 마법",
        summary: "탐험",
        content: "폐역",
        secretContent: "유령",
        npcs: [
          {
            name: "역무원",
            description: "안내원",
            greeting: "표",
            systemPrompt: "공손",
          },
        ],
      }),
      "눈 덮인 공국".length +
        "얼음 마법".length +
        "탐험".length +
        "폐역".length +
        "유령".length +
        "역무원".length +
        "안내원".length +
        "표".length +
        "공손".length
    );
  });

  it("ignores unnamed NPC cards and trims fields", () => {
    assert.equal(
      countScenarioBundleChars({
        content: "  본문  ",
        npcs: [{ name: "  ", description: "안 셈", systemPrompt: "안 셈" }],
      }),
      "본문".length
    );
  });

  it("caps a field by the remaining shared 10,000-character budget", () => {
    assert.equal(remainingScenarioFieldMax(9000, 1000, 10000), 2000);
    assert.equal(remainingScenarioFieldMax(10000, 4000, 10000), 4000);
    assert.equal(remainingScenarioFieldMax(11000, 500, 8000), 0);
    assert.equal(TRPG_SCENARIO_BUNDLE_LIMIT, 10000);
    assert.match(scenarioBundleLimitError(12000), /지금 .+자입니다/);
  });
});
