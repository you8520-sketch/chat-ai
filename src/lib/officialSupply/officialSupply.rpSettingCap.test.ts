import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AI_LEARNING_LIMIT, CHARACTER_SETTING_SOURCE_LIMIT } from "@/lib/characterFormLimits";
import {
  evaluateOfficialStagedSaveLength,
  officialRpSettingOverflowChars,
  officialSubstantiveCharCount,
} from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const PILOT_KEYS = Array.from({ length: 10 }, (_, index) => `pilot-rf-${String(index + 1).padStart(2, "0")}`);

describe("official RP setting injection cap (staged save gate)", () => {
  it("loses no character of any pilot draft on the real RP wire", () => {
    for (const key of PILOT_KEYS) {
      const source = loadCompiledOfficialCharacterSource(key);
      assert.equal(officialRpSettingOverflowChars(source.draft, source.appearanceBlock), 0, `${key} RP setting is cut`);
      assert.equal(evaluateOfficialStagedSaveLength(source.draft, source.appearanceBlock).ok, true, key);
    }
  });

  it("keeps a draft padded to the canonical save limit lossless and blocks one past it", () => {
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const withCore = (extraChars: number): OfficialCharacterDraft => ({
      ...source.draft,
      sections: {
        ...source.draft.sections,
        characterCore: `${source.draft.sections.characterCore}\n${"가".repeat(extraChars)}`,
      },
    });
    const base = officialSubstantiveCharCount(source.draft, source.appearanceBlock);
    const atLimit = withCore(AI_LEARNING_LIMIT - base - 1);
    assert.ok(officialSubstantiveCharCount(atLimit, source.appearanceBlock) <= AI_LEARNING_LIMIT);
    assert.equal(officialRpSettingOverflowChars(atLimit, source.appearanceBlock), 0);
    assert.equal(evaluateOfficialStagedSaveLength(atLimit, source.appearanceBlock).ok, true);

    const pastLimit = withCore(AI_LEARNING_LIMIT - base + 500);
    const blocked = evaluateOfficialStagedSaveLength(pastLimit, source.appearanceBlock);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0]?.code, "text_exceeds_canonical_ceiling");
  });

  it("reports a positive overflow once the joined setting passes the canonical cap", () => {
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const huge: OfficialCharacterDraft = {
      ...source.draft,
      sections: {
        ...source.draft.sections,
        characterCore: `${source.draft.sections.characterCore}\n${"가".repeat(CHARACTER_SETTING_SOURCE_LIMIT)}`,
      },
    };
    assert.ok(officialRpSettingOverflowChars(huge, source.appearanceBlock) > 0);
  });
});
