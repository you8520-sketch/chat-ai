import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  buildOfficialAssetPrompts,
  OFFICIAL_DETAIL_RESTRAINT_CLAUSE,
  OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE,
  OFFICIAL_STYLE_USE_CLAUSE,
  type OfficialReferenceRoleLayout,
} from "@/lib/officialSupply/imagePrompt";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import {
  OFFICIAL_SLOT_SHOT_PLAN,
  renderOfficialShotResponsibility,
  resolveOfficialSlotShot,
} from "@/lib/officialSupply/shotPlan";
import {
  ANCHOR_QA_KEYS,
  COMPOSITION_QA_KEY,
  isCompletePassingAnchorQa,
  VARIATION_QA_KEYS,
} from "@/lib/officialSupply/store";
import type { OfficialAssetPlan } from "@/lib/officialSupply/types";
import { buildClusterBRofanStyleSeed } from "@/lib/officialSupply/userOwnedRofanStyleRefs";

const PILOT_JSON = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-03.json");
const COMPOSITION_TERMS = ["gaze", "head angle", "camera", "crop", "silhouette"] as const;
const OVER_DETAIL_PHRASES = [/material detail/i, /overall polish/i, /ultra[- ]detailed/i, /intricate/i] as const;

function pilotPrompts(slotKey: string, layout: OfficialReferenceRoleLayout) {
  const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
  const plan = (JSON.parse(fs.readFileSync(PILOT_JSON, "utf8")) as { assetPlan: OfficialAssetPlan }).assetPlan;
  const slot = plan.slots.find((candidate) => candidate.slotKey === slotKey)!;
  const prompts = buildOfficialAssetPrompts({
    draft: lucian.draft,
    appearance: lucian.appearanceLock,
    style: testStyleCandidate("c1").dna,
    styleSeed: buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" } as unknown as NodeJS.ProcessEnv),
    slot,
    referenceRoleLayout: layout,
  });
  return { prompts, slot, draftKey: lucian.draft.draftKey };
}

describe("official style reference role", () => {
  const layouts: Array<[string, OfficialReferenceRoleLayout]> = [
    ["rep", "slot_default"],
    ["sig4", "identity_then_style"],
    ["sig4", "identity_and_style"],
    ["scene1", "identity_and_style"],
  ];

  for (const [slotKey, layout] of layouts) {
    it(`${slotKey}/${layout}: style image carries rendering only, never composition, and caps detail`, () => {
      const { prompts } = pilotPrompts(slotKey, layout);
      for (const prompt of [prompts.primaryPrompt, prompts.strictFallbackPrompt]) {
        assert.ok(prompt.includes(OFFICIAL_DETAIL_RESTRAINT_CLAUSE), `${slotKey}/${layout} lacks the detail ceiling`);
        for (const phrase of OVER_DETAIL_PHRASES) {
          assert.doesNotMatch(prompt, phrase);
        }
      }
      for (const term of COMPOSITION_TERMS) {
        assert.ok(prompts.primaryPrompt.includes(term), `${slotKey}/${layout} does not ban copying ${term}`);
      }
    });
  }

  it("style-only layouts ban composition through the single shared copy-ban", () => {
    for (const [slotKey, layout] of [
      ["rep", "slot_default"],
      ["sig4", "identity_then_style"],
    ] as const) {
      const { prompts } = pilotPrompts(slotKey, layout);
      assert.equal(prompts.primaryPrompt.split(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE).length - 1, 1);
      assert.equal(prompts.strictFallbackPrompt.split(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE).length - 1, 1);
      assert.equal(prompts.primaryPrompt.split(OFFICIAL_DETAIL_RESTRAINT_CLAUSE).length - 1, 1);
    }
    for (const term of COMPOSITION_TERMS) {
      assert.ok(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE.includes(term), term);
    }
    assert.match(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE, /independently of the reference/);
    assert.ok(OFFICIAL_STYLE_USE_CLAUSE.includes(OFFICIAL_DETAIL_RESTRAINT_CLAUSE));
  });

  it("the shot table asks environment and scene slots for a readable but simple background", () => {
    const withBackground = Object.values(OFFICIAL_SLOT_SHOT_PLAN).filter((shot) => shot.background !== "simple");
    assert.ok(withBackground.length >= 6);
    for (const shot of withBackground) {
      const rendered = renderOfficialShotResponsibility(shot);
      assert.match(rendered, /large simple shapes/, shot.slotKey);
      assert.doesNotMatch(rendered, /must be readable, not a portrait backdrop\./, shot.slotKey);
    }
    const { prompts, slot, draftKey } = pilotPrompts("scene1", "identity_and_style");
    assert.ok(prompts.primaryPrompt.includes(renderOfficialShotResponsibility(resolveOfficialSlotShot(slot, draftKey))));
  });

  it("review keeps legacy 10/4-key reports valid but blocks a recorded composition failure", () => {
    const pass = { ok: true };
    const legacy = Object.fromEntries(ANCHOR_QA_KEYS.map((key) => [key, pass]));
    assert.equal(isCompletePassingAnchorQa(legacy), true);
    assert.equal(isCompletePassingAnchorQa({ ...legacy, [COMPOSITION_QA_KEY]: pass }), true);
    assert.equal(isCompletePassingAnchorQa({ ...legacy, [COMPOSITION_QA_KEY]: { ok: false, note: "cloned gaze" } }), false);
    assert.equal(isCompletePassingAnchorQa(Object.fromEntries(VARIATION_QA_KEYS.map((key) => [key, pass]))), false);
  });
});
