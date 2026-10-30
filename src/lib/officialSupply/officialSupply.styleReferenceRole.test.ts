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
import { ROFAN_CLUSTER_B_GRAPHIC_STYLE_DIRECTION, ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
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
const STYLE_SPECIFIC_SIMPLIFICATION = [
  /smooth skin/i,
  /shading planes/i,
  /simplified/i,
  /no busier/i,
  /big masses/i,
  /cel[- ]shad/i,
] as const;

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

  it("the common detail rule follows the reference and carries no style-specific simplification", () => {
    assert.match(OFFICIAL_DETAIL_RESTRAINT_CLAUSE, /own line weight, coloring, and detail density/);
    assert.match(OFFICIAL_DETAIL_RESTRAINT_CLAUSE, /no finer lines, noise, grain/i);
    assert.match(OFFICIAL_DETAIL_RESTRAINT_CLAUSE, /keep the same level of ornament, embroidery, and background/i);
    for (const pattern of STYLE_SPECIFIC_SIMPLIFICATION) {
      assert.doesNotMatch(OFFICIAL_STYLE_USE_CLAUSE, pattern);
      assert.doesNotMatch(OFFICIAL_DETAIL_RESTRAINT_CLAUSE, pattern);
    }
    assert.doesNotMatch(OFFICIAL_STYLE_USE_CLAUSE, /wolfgang|볼프강|black|검은|fur|모피/i);
  });

  it("style-specific cel/skin rules stay in Cluster B style data and follow the reference density", () => {
    assert.equal(ROFAN_CLUSTER_B_VISUAL_STYLE_DNA.rendering, "cel");
    assert.match(ROFAN_CLUSTER_B_VISUAL_STYLE_DNA.skinRendering, /매끈한 피부/);
    assert.doesNotMatch(ROFAN_CLUSTER_B_VISUAL_STYLE_DNA.hairRendering, /낱가닥 묘사 없음/);
    assert.match(ROFAN_CLUSTER_B_VISUAL_STYLE_DNA.hairRendering, /참고 이미지가 보이는 만큼/);
    assert.match(ROFAN_CLUSTER_B_GRAPHIC_STYLE_DIRECTION, /graphic cel-shading over painterly/);
    for (const duplicated of [/stronger saturation/i, /Sharper youthful/i, /Ornament and metal/i, /heavy mature realism/i]) {
      assert.doesNotMatch(ROFAN_CLUSTER_B_GRAPHIC_STYLE_DIRECTION, duplicated);
    }
  });

  it("a non-Cluster-B seed gets the common rule without any Cluster B simplification", () => {
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const plan = (JSON.parse(fs.readFileSync(PILOT_JSON, "utf8")) as { assetPlan: OfficialAssetPlan }).assetPlan;
    const { primaryPrompt } = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style: testStyleCandidate("c1").dna,
      styleSeed: { url: "/uploads/own-style.webp", provenance: "platform_owned", note: "own" },
      slot: plan.slots.find((slot) => slot.slotKey === "rep")!,
    });
    assert.ok(primaryPrompt.includes(OFFICIAL_DETAIL_RESTRAINT_CLAUSE));
    assert.doesNotMatch(primaryPrompt, /graphic cel-shading|clear graphic shapes/);
  });

  it("background wording defers density to the style image instead of dictating it", () => {
    const withBackground = Object.values(OFFICIAL_SLOT_SHOT_PLAN).filter((shot) => shot.background !== "simple");
    assert.ok(withBackground.length >= 6);
    for (const shot of withBackground) {
      const rendered = renderOfficialShotResponsibility(shot);
      assert.match(rendered, /style image's own background density/, shot.slotKey);
      assert.doesNotMatch(rendered, /no busier|large simple shapes|few large/, shot.slotKey);
    }
  });

  it("the representative head direction comes from character identity and is not read from references", () => {
    const withSeed = (url: string) => {
      const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
      const plan = (JSON.parse(fs.readFileSync(PILOT_JSON, "utf8")) as { assetPlan: OfficialAssetPlan }).assetPlan;
      return buildOfficialAssetPrompts({
        draft: lucian.draft,
        appearance: lucian.appearanceLock,
        style: testStyleCandidate("c1").dna,
        styleSeed: { url, provenance: "platform_owned", note: "seed" },
        slot: plan.slots.find((slot) => slot.slotKey === "rep")!,
      }).primaryPrompt;
    };
    const shotLine = (prompt: string) => /SHOT RESPONSIBILITY[^\n]*?(?=\nREFERENCE)/.exec(prompt)?.[0];
    assert.equal(shotLine(withSeed("/uploads/a.webp")), shotLine(withSeed("/uploads/b.webp")));
    assert.match(shotLine(withSeed("/uploads/a.webp"))!, /Do not inherit any reference image's camera, head angle, gaze/);
    const heads = new Set(
      ["pilot-rf-01", "pilot-rf-03", "pilot-rf-05", "pilot-rf-07"].map(
        (key) => resolveOfficialSlotShot({ slotKey: "rep", kind: "representative" }, key).faceDirection
      )
    );
    assert.ok(heads.size >= 2);
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
