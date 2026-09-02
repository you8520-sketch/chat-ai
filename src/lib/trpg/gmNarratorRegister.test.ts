import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildTrpgGmUserBlock, TRPG_GM_SYSTEM } from "./gmPrompt";

const NARRATOR_REGISTER_MARKER = "[NARRATOR REGISTER]";

function countNarratorRegisterOwners(corpus: string): number {
  return (corpus.match(/\[NARRATOR REGISTER\]/g) ?? []).length;
}

describe("TRPG GM narrator register contract", () => {
  it("R1: canonical narrator register owner count = 1", () => {
    assert.equal(countNarratorRegisterOwners(TRPG_GM_SYSTEM), 1);
    assert.equal(countNarratorRegisterOwners(buildTrpgGmUserBlock({
      worldBrief: "폐허",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: true,
      actions: [],
    })), 0);
    assert.equal(countNarratorRegisterOwners(buildTrpgGmUserBlock({
      worldBrief: "폐허",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      regenerate: true,
      actions: [],
    })), 0);

    const filesToScan = [
      "src/lib/trpg/gmCall.ts",
      "src/lib/trpg/engineAdvance.ts",
      "src/lib/trpg/botActions.ts",
      "src/lib/trpg/worldBlueprintGeneration.ts",
    ];
    for (const file of filesToScan) {
      const src = readFileSync(file, "utf8");
      assert.equal(
        countNarratorRegisterOwners(src),
        0,
        `${file} must not define a duplicate [NARRATOR REGISTER] owner`
      );
    }
  });

  it("R2: literary plain narration required; formal polite narration forbidden", () => {
    const section = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf(NARRATOR_REGISTER_MARKER),
      TRPG_GM_SYSTEM.indexOf("[SPEECH FORMAT]")
    );
    assert.match(section, /literary plain style/i);
    assert.match(section, /formal polite report prose/i);
    assert.match(section, /했습니다|입니다|합니다/);
    assert.match(section, /했다|였다|있었다/);
    assert.match(section, /short present beats/i);
    assert.doesNotMatch(section, /every sentence must end with/i);
  });

  it("R3: dialogue register preserved; GM closing aside follows narrator register", () => {
    const section = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf(NARRATOR_REGISTER_MARKER),
      TRPG_GM_SYSTEM.indexOf("[SPEECH FORMAT]")
    );
    assert.match(section, /Spoken dialogue keeps each character's speech level/i);
    assert.match(section, /narration and the GM closing aside/i);
    assert.match(section, /Quoted in-world text/i);
    assert.match(TRPG_GM_SYSTEM, /Closing GM beat/);
  });

  it("R4: opening, normal, and reroll GM paths share TRPG_GM_SYSTEM owner", () => {
    const advance = readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.match(advance, /async function runGmForRound/);
    assert.match(advance, /system:\s*TRPG_GM_SYSTEM/);
    assert.doesNotMatch(advance, /opening[\s\S]{0,400}TRPG_GM_OPENING_SYSTEM/);
    assert.doesNotMatch(advance, /regenerate[\s\S]{0,400}TRPG_GM_REROLL_SYSTEM/);

    const openingUser = buildTrpgGmUserBlock({
      worldBrief: "시작",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: true,
      actions: [],
    });
    const normalUser = buildTrpgGmUserBlock({
      worldBrief: "진행",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      actions: [],
    });
    const rerollUser = buildTrpgGmUserBlock({
      worldBrief: "재생성",
      memoryBlock: "[TRPG STRUCTURED STATE]",
      opening: false,
      regenerate: true,
      actions: [],
    });
    for (const user of [openingUser, normalUser, rerollUser]) {
      assert.doesNotMatch(user, /\[NARRATOR REGISTER\]/);
      assert.doesNotMatch(user, /literary plain|formal polite|narrator register/i);
    }
  });

  it("R5: no runtime style postprocessor added for narrator register", () => {
    const trpgFiles = [
      "src/lib/trpg/gmPrompt.ts",
      "src/lib/trpg/gmCall.ts",
      "src/lib/trpg/engineAdvance.ts",
      "src/lib/trpg/gmCompletionIntegrity.ts",
    ];
    const bannedPatterns = [
      /replace\s*\(\s*["']했습니다["']/,
      /replace\s*\(\s*["']입니다["']/,
      /NARRATOR_REGISTER_POSTPROCESS/i,
      /honorificStrip/i,
      /sentenceEndingConverter/i,
      /trpgNarratorAdapter/i,
      /gmStyleAdapter/i,
    ];
    for (const file of trpgFiles) {
      const src = readFileSync(file, "utf8");
      for (const pattern of bannedPatterns) {
        assert.doesNotMatch(src, pattern, `${file} must not add narrator style postprocessing`);
      }
    }
  });

  it("injected plan/blueprint data is not narrator register owner", () => {
    const section = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf(NARRATOR_REGISTER_MARKER),
      TRPG_GM_SYSTEM.indexOf("[SPEECH FORMAT]")
    );
    assert.match(section, /Do not mimic injected plan or blueprint register/i);
  });
});
