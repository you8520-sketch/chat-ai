import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  buildOfficialAssetPrompts,
  OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE,
  OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN,
  OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE,
} from "@/lib/officialSupply/imagePrompt";
import { officialSlotGenerationReferences } from "@/lib/officialSupply/runner";
import { resolveOfficialSlotShot } from "@/lib/officialSupply/shotPlan";
import { buildClusterBRofanStyleSeed } from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import {
  HWANG_VOCAB,
  testAppearance,
  testAssetPlan,
  testDraft,
  testStyleCandidate,
} from "@/lib/officialSupply/officialSupply.fixtures";
import type { OfficialAssetPlan, OfficialAssetSlotPlan } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters");
const FACE = {
  front: "face toward camera, near-frontal",
  left_three_quarter: "head turned left three-quarter view",
  right_three_quarter: "head turned right three-quarter view",
  profile: "clear profile / side-face view",
} as const;

function readPilot(draftKey: string): { assetPlan: OfficialAssetPlan } {
  return JSON.parse(fs.readFileSync(path.join(PILOT_DIR, `${draftKey}.json`), "utf8")) as {
    assetPlan: OfficialAssetPlan;
  };
}

function markerCount(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

function promptInventoryRow(
  draftKey: string,
  slot: OfficialAssetSlotPlan,
  primaryPrompt: string,
  strictFallbackPrompt: string
) {
  const shot = resolveOfficialSlotShot(slot, draftKey);
  return {
    slotKey: slot.slotKey,
    kind: slot.kind,
    faceDirection: shot.faceDirection,
    cameraAngle: shot.cameraAngle,
    distance: shot.distance,
    poseFamily: shot.poseFamily,
    expressionFamily: shot.expressionFamily,
    slotExpression: slot.expression,
    slotPose: slot.pose,
    referenceRole: slot.kind === "representative" ? "style_only" : "identity_anchor",
    primaryHasShotDirection: primaryPrompt.includes(FACE[shot.faceDirection]),
    primaryHasShotAngle: primaryPrompt.includes(
      shot.cameraAngle === "eye_level"
        ? "eye-level camera"
        : shot.cameraAngle === "high_angle"
          ? "high-angle camera looking slightly down"
          : "low-angle camera looking slightly up"
    ),
    primaryHasShotDistance: primaryPrompt.includes(
      shot.distance === "close_up"
        ? "close-up (face and shoulders)"
        : shot.distance === "bust"
          ? "bust / upper-body card crop"
          : shot.distance === "medium"
            ? "medium shot (waist-up or mid-thigh)"
            : "knee-up or full-body shot with space around the figure"
    ),
    primaryHasSlotExpression: primaryPrompt.includes(`Expression: ${slot.expression}`),
    fallbackHasSameReference: strictFallbackPrompt.includes(
      slot.kind === "representative" ? "STYLE ONLY" : "IDENTITY ANCHOR ONLY"
    ),
    fallbackHasSlotExpression: strictFallbackPrompt.includes(`Expression: ${slot.expression}`),
    fallbackHasSlotPose: !slot.pose.trim() || strictFallbackPrompt.includes(`Pose: ${slot.pose}`),
    shotResponsibilityCount: markerCount(primaryPrompt, "SHOT RESPONSIBILITY ("),
    fallbackShotCount: markerCount(strictFallbackPrompt, "SHOT RESPONSIBILITY ("),
    hasDnaFramingField: /framing:/.test(primaryPrompt),
    hasLegacyCompositionCarry: /only expression, pose, outfit variant and setting change/.test(
      primaryPrompt
    ),
    hasPoseFamilyPrompt: primaryPrompt.includes("Pose family:"),
    hasExpressionRegister: primaryPrompt.includes("Expression register:"),
    primarySectionCount:
      markerCount(primaryPrompt, "SHOT RESPONSIBILITY (") +
      markerCount(primaryPrompt, "REFERENCE IMAGE") +
      markerCount(primaryPrompt, "IDENTITY LOCK —") +
      markerCount(primaryPrompt, "ART STYLE (structured") +
      markerCount(primaryPrompt, "Expression:"),
    fallbackSectionCount:
      markerCount(strictFallbackPrompt, "SHOT RESPONSIBILITY (") +
      markerCount(strictFallbackPrompt, "REFERENCE IMAGE") +
      markerCount(strictFallbackPrompt, "IDENTITY LOCK —") +
      markerCount(strictFallbackPrompt, "Expression:"),
  };
}

describe("official image-generation owners (#1376)", () => {
  it("maps Lucian slots to a single owner each and keeps fallback on the same owners", () => {
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const { assetPlan } = readPilot("pilot-rf-03");
    const style = testStyleCandidate("c1").dna;
    const rows = assetPlan.slots.map((slot) => {
      const prompts = buildOfficialAssetPrompts({
        draft: lucian.draft,
        appearance: lucian.appearanceLock,
        style,
        slot,
      });
      return promptInventoryRow("pilot-rf-03", slot, prompts.primaryPrompt, prompts.strictFallbackPrompt);
    });

    assert.equal(rows.length, 14);
    const rep = rows.find((row) => row.slotKey === "rep")!;
    assert.equal(rep.referenceRole, "style_only");
    assert.equal(rep.faceDirection, "front");
    assert.equal(rep.distance, "bust");

    for (const row of rows) {
      assert.equal(row.primaryHasShotDirection, true, row.slotKey);
      assert.equal(row.primaryHasShotAngle, true, row.slotKey);
      assert.equal(row.primaryHasShotDistance, true, row.slotKey);
      assert.equal(row.primaryHasSlotExpression, true, row.slotKey);
      assert.equal(row.fallbackHasSameReference, true, row.slotKey);
      assert.equal(row.fallbackHasSlotExpression, true, row.slotKey);
      assert.equal(row.fallbackHasSlotPose, true, row.slotKey);
      assert.equal(row.shotResponsibilityCount, 1, row.slotKey);
      assert.equal(row.fallbackShotCount, 1, row.slotKey);
      assert.equal(row.hasDnaFramingField, false, row.slotKey);
      assert.equal(row.hasLegacyCompositionCarry, false, row.slotKey);
      assert.equal(row.hasPoseFamilyPrompt, false, row.slotKey);
      assert.equal(row.hasExpressionRegister, false, row.slotKey);
      assert.equal(row.primarySectionCount, 5, row.slotKey);
      assert.equal(row.fallbackSectionCount, 4, row.slotKey);
    }

    const nonRep = rows.filter((row) => row.kind !== "representative");
    assert.ok(new Set(nonRep.map((row) => row.slotExpression)).size >= 10);
    assert.ok(new Set(nonRep.map((row) => `${row.faceDirection}|${row.cameraAngle}|${row.distance}`)).size >= 8);
  });

  it("keeps the representative image as an identity URL and forbids composition copy in prompt text", () => {
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const { assetPlan } = readPilot("pilot-rf-03");
    const sig4 = assetPlan.slots.find((slot) => slot.slotKey === "sig4")!;
    const scene2 = assetPlan.slots.find((slot) => slot.slotKey === "scene2")!;
    const style = testStyleCandidate("c1").dna;
    const sig4Prompt = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style,
      slot: sig4,
    });
    const scene2Prompt = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style,
      slot: scene2,
    });

    for (const prompts of [sig4Prompt, scene2Prompt]) {
      assert.equal(prompts.primaryPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), true);
      assert.equal(prompts.strictFallbackPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), true);
      assert.match(prompts.primaryPrompt, /Do not copy the reference camera/);
      assert.doesNotMatch(prompts.primaryPrompt, /Keep the exact same person; only expression/);
    }

    const shot = resolveOfficialSlotShot(sig4, "pilot-rf-03");
    assert.match(sig4Prompt.primaryPrompt, new RegExp(FACE[shot.faceDirection].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(sig4Prompt.primaryPrompt, new RegExp(`Expression: ${sig4.expression}`));
    assert.match(sig4Prompt.primaryPrompt, new RegExp(`Pose: ${sig4.pose}`));

    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "signature",
        styleSeed: { url: "/uploads/style.webp", provenance: "platform_owned", note: "seed" },
        representativeUrl: "/uploads/official-rep.webp",
      }),
      ["/uploads/official-rep.webp"]
    );
    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "representative",
        styleSeed: { url: "/uploads/style.webp", provenance: "platform_owned", note: "seed" },
        representativeUrl: "/uploads/official-rep.webp",
      }),
      ["/uploads/style.webp"]
    );
  });

  it("omits Cluster B card framing from non-representative DNA and keeps style grammar", () => {
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const { assetPlan } = readPilot("pilot-rf-03");
    const sig1 = assetPlan.slots.find((slot) => slot.slotKey === "sig1")!;
    const clusterSeed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://example.test" });
    const { primaryPrompt } = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style: testStyleCandidate("c1").dna,
      slot: sig1,
      styleSeed: clusterSeed,
    });
    assert.match(primaryPrompt, /rendering: cel/);
    assert.doesNotMatch(primaryPrompt, /2:3 카드 상단 1\/3 얼굴 우선/);
    assert.doesNotMatch(primaryPrompt, /framing:/);
    assert.match(primaryPrompt, /ART STYLE describes rendering language, color, and illustration grammar only/);
  });

  it("does not break the shared fixture or another official character path", () => {
    const hwang = testDraft({ draftKey: "hwang", name: "레온하르트", vocabulary: HWANG_VOCAB });
    const appearance = testAppearance();
    const style = testStyleCandidate("c1").dna;
    const wolfgang = loadCompiledOfficialCharacterSource("pilot-rf-02");
    const wolfgangPlan = readPilot("pilot-rf-02").assetPlan;

    for (const slot of testAssetPlan().slots) {
      const { primaryPrompt, strictFallbackPrompt } = buildOfficialAssetPrompts({
        draft: hwang,
        appearance,
        style,
        slot,
      });
      if (slot.kind === "representative") {
        assert.match(primaryPrompt, /STYLE ONLY/i);
        assert.match(primaryPrompt, /character card portrait/);
        assert.doesNotMatch(primaryPrompt, /Image 2 STYLE ONLY/);
      } else {
        assert.match(primaryPrompt, /IDENTITY ANCHOR ONLY/);
        assert.match(strictFallbackPrompt, /IDENTITY ANCHOR ONLY/);
      }
      assert.equal(markerCount(primaryPrompt, "SHOT RESPONSIBILITY ("), 1);
      assert.equal(markerCount(strictFallbackPrompt, "SHOT RESPONSIBILITY ("), 1);
    }

    const wolfgangScene = wolfgangPlan.slots.find((slot) => slot.slotKey === "scene2")!;
    const { primaryPrompt } = buildOfficialAssetPrompts({
      draft: wolfgang.draft,
      appearance: wolfgang.appearanceLock,
      style,
      slot: wolfgangScene,
    });
    assert.match(primaryPrompt, /IDENTITY ANCHOR ONLY/);
    assert.match(primaryPrompt, new RegExp(`Expression: ${wolfgangScene.expression}`));
    assert.doesNotMatch(primaryPrompt, /Pose family:/);
  });

  it("runner and prompt assembly stay the only reference owners", () => {
    const runner = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/runner.ts"), "utf8");
    const prompt = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imagePrompt.ts"), "utf8");
    const adapters = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/productionAdapters.ts"), "utf8");
    assert.match(runner, /officialSlotGenerationReferences/);
    assert.match(prompt, /OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE/);
    assert.match(prompt, /officialIdentityThenStyleReferenceRule/);
    assert.match(prompt, /OFFICIAL_IDENTITY_KEEP_CLAUSE/);
    assert.match(prompt, /OFFICIAL_STYLE_USE_CLAUSE/);
    assert.match(adapters, /callOpenAiImageEditWithSafetyFallback/);
    assert.match(adapters, /prepareOfficialImageReferences/);
    assert.doesNotMatch(runner, /identity_then_style/);
  });

  it("identity_then_style is opt-in and does not change the default official slot path", () => {
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const { assetPlan } = readPilot("pilot-rf-03");
    const sig4 = assetPlan.slots.find((slot) => slot.slotKey === "sig4")!;
    const style = testStyleCandidate("c1").dna;
    const defaultPrompts = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style,
      slot: sig4,
    });
    const dual = buildOfficialAssetPrompts({
      draft: lucian.draft,
      appearance: lucian.appearanceLock,
      style,
      slot: sig4,
      referenceRoleLayout: "identity_then_style",
    });
    assert.equal(defaultPrompts.primaryPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), true);
    assert.doesNotMatch(defaultPrompts.primaryPrompt, /Image 1 IDENTITY ONLY/);
    assert.match(dual.primaryPrompt, /Image 1 IDENTITY ONLY/);
    assert.match(dual.primaryPrompt, /Image 2 STYLE ONLY/);
    assert.match(dual.strictFallbackPrompt, /Image 1 IDENTITY ONLY/);
    assert.match(dual.strictFallbackPrompt, /Image 2 STYLE ONLY/);
    assert.equal(dual.primaryPrompt.includes(OFFICIAL_IDENTITY_ANCHOR_REFERENCE_RULE), false);
    assert.equal(dual.primaryPrompt.includes(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE), true);
    assert.equal(dual.strictFallbackPrompt.includes(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE), true);
    assert.equal(dual.primaryPrompt.split(OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE).length - 1, 1);
    assert.equal(dual.primaryPrompt.includes(OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN), true);
    assert.doesNotMatch(
      OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN,
      /hairstyle|hair color|eye color|outfit design|jewelry|pose|background/
    );
    assert.deepEqual(
      officialSlotGenerationReferences({
        kind: "signature",
        styleSeed: { url: "/uploads/style.webp", provenance: "platform_owned", note: "seed" },
        representativeUrl: "/uploads/official-rep.webp",
      }),
      ["/uploads/official-rep.webp"]
    );
  });
});
