import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import { officialImageSubjectRuleForSlot, resolveOfficialImageSubjects } from "@/lib/officialSupply/imageSubjects";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import {
  OFFICIAL_CAMERA_PROMPT,
  OFFICIAL_FACE_PROMPT,
  OFFICIAL_LEGACY_LOW_ANGLE_CAMERA_CLAUSE,
  resolveOfficialSlotShot,
} from "@/lib/officialSupply/shotPlan";
import type { OfficialAssetPlan, OfficialAssetSlotPlan, StyleReference } from "@/lib/officialSupply/types";

const CLUSTER_B_SEED: StyleReference = {
  url: "/official-supply/style-seeds/romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform.webp",
  provenance: "platform_owned",
  note: "cluster-b fixture",
  styleCluster: "cluster_b_graphic",
};

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters");
const SHOT_PLAN_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/shotPlan.ts"), "utf8");
const IMAGE_PROMPT_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imagePrompt.ts"), "utf8");

const HIGH_ANGLE_CLAUSE = "high-angle camera looking slightly down";
const FACE_RIGHT = "head turned right three-quarter view";
const FACE_PROFILE = OFFICIAL_FACE_PROMPT.profile;
const DISTANCE_KNEE = "knee-up or full-body shot with space around the figure";

function readPilot(draftKey: string): { assetPlan: OfficialAssetPlan } {
  return JSON.parse(fs.readFileSync(path.join(PILOT_DIR, `${draftKey}.json`), "utf8")) as {
    assetPlan: OfficialAssetPlan;
  };
}

function lucianSlot(slotKey: string): OfficialAssetSlotPlan {
  const slot = readPilot("pilot-rf-03").assetPlan.slots.find((item) => item.slotKey === slotKey);
  assert.ok(slot, slotKey);
  return slot;
}

function promptsFor(
  slot: OfficialAssetSlotPlan,
  referenceRoleLayout: "slot_default" | "identity_then_style" = "slot_default"
) {
  const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
  return buildOfficialAssetPrompts({
    draft: lucian.draft,
    appearance: lucian.appearanceLock,
    style: testStyleCandidate("c1").dna,
    slot,
    styleSeed: CLUSTER_B_SEED,
    referenceRoleLayout,
  });
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("official camera owner (#low-angle)", () => {
  it("keeps one canonical low_angle clause and does not revive the slightly-up label", () => {
    assert.equal(
      OFFICIAL_CAMERA_PROMPT.low_angle,
      "low-angle camera placed below the subject looking up, with visible upward perspective"
    );
    assert.equal(OFFICIAL_CAMERA_PROMPT.high_angle, HIGH_ANGLE_CLAUSE);
    assert.equal(OFFICIAL_CAMERA_PROMPT.eye_level, "eye-level camera");
    assert.equal(count(SHOT_PLAN_SOURCE, "low_angle:"), 1);
    assert.doesNotMatch(IMAGE_PROMPT_SOURCE, /low-angle camera/);
  });

  it("applies the low_angle owner once on Lucian sig3 and scene2, primary and fallback", () => {
    for (const slotKey of ["sig3", "scene2"] as const) {
      const slot = lucianSlot(slotKey);
      assert.equal(resolveOfficialSlotShot(slot, "pilot-rf-03").cameraAngle, "low_angle");
      for (const layout of ["slot_default", "identity_then_style"] as const) {
        const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot, layout);
        assert.equal(count(primaryPrompt, OFFICIAL_CAMERA_PROMPT.low_angle), 1, `${slotKey}/${layout}`);
        assert.equal(count(strictFallbackPrompt, OFFICIAL_CAMERA_PROMPT.low_angle), 1, `${slotKey}/${layout}`);
        assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_LEGACY_LOW_ANGLE_CAMERA_CLAUSE));
        assert.doesNotMatch(strictFallbackPrompt, new RegExp(OFFICIAL_LEGACY_LOW_ANGLE_CAMERA_CLAUSE));
        assert.equal(
          count(primaryPrompt, OFFICIAL_CAMERA_PROMPT.low_angle),
          count(strictFallbackPrompt, OFFICIAL_CAMERA_PROMPT.low_angle)
        );
      }
    }
  });

  it("keeps high_angle, faceDirection, and distance owners unchanged", () => {
    const sig4 = lucianSlot("sig4");
    const scene1 = lucianSlot("scene1");
    const sig3 = lucianSlot("sig3");
    const scene2 = lucianSlot("scene2");
    assert.equal(resolveOfficialSlotShot(sig4, "pilot-rf-03").cameraAngle, "high_angle");
    assert.equal(resolveOfficialSlotShot(scene1, "pilot-rf-03").cameraAngle, "high_angle");
    const sig4Prompt = promptsFor(sig4).primaryPrompt;
    const scene1Prompt = promptsFor(scene1).primaryPrompt;
    assert.equal(count(sig4Prompt, HIGH_ANGLE_CLAUSE), 1);
    assert.equal(count(scene1Prompt, HIGH_ANGLE_CLAUSE), 1);
    assert.doesNotMatch(sig4Prompt, /low-angle camera/);
    assert.doesNotMatch(scene1Prompt, /low-angle camera/);

    const sig3Prompt = promptsFor(sig3).primaryPrompt;
    const scene2Prompt = promptsFor(scene2).primaryPrompt;
    assert.match(sig3Prompt, new RegExp(FACE_RIGHT));
    assert.match(scene2Prompt, new RegExp(FACE_PROFILE));
    assert.match(sig3Prompt, new RegExp(DISTANCE_KNEE));
    assert.match(scene2Prompt, new RegExp(DISTANCE_KNEE));
    assert.equal(count(sig3Prompt, FACE_RIGHT), 1);
    assert.equal(count(scene2Prompt, FACE_PROFILE), 1);
  });

  it("uses the same shot owner for identity-only and identity_then_style", () => {
    for (const slotKey of ["sig3", "scene2"] as const) {
      const slot = lucianSlot(slotKey);
      const identity = promptsFor(slot, "slot_default");
      const dual = promptsFor(slot, "identity_then_style");
      const shot = resolveOfficialSlotShot(slot, "pilot-rf-03");
      assert.equal(shot.cameraAngle, "low_angle");
      assert.equal(count(identity.primaryPrompt, OFFICIAL_CAMERA_PROMPT.low_angle), 1);
      assert.equal(count(dual.primaryPrompt, OFFICIAL_CAMERA_PROMPT.low_angle), 1);
      assert.ok(identity.primaryPrompt.includes(OFFICIAL_CAMERA_PROMPT[shot.cameraAngle]));
      assert.ok(dual.primaryPrompt.includes(OFFICIAL_CAMERA_PROMPT[shot.cameraAngle]));
    }
  });

  it("does not let style DNA reintroduce a framing owner", () => {
    const { primaryPrompt, strictFallbackPrompt } = promptsFor(lucianSlot("sig3"), "identity_then_style");
    assert.doesNotMatch(primaryPrompt, /(?:^|\n)framing:/);
    assert.doesNotMatch(strictFallbackPrompt, /(?:^|\n)framing:/);
    assert.match(primaryPrompt, /ART STYLE describes rendering language, color, and illustration grammar only/);
  });

  it("leaves participant imageSubjects unchanged", () => {
    assert.deepEqual(resolveOfficialImageSubjects(lucianSlot("scene1")), {
      foreground: "character_plus_required_partner",
      partnerRole: "user",
      partnerDepiction: "cropped_identity_neutral",
      backgroundExtras: "optional_unnamed",
    });
    assert.equal(resolveOfficialImageSubjects(lucianSlot("scene2")).foreground, "solo_character");
    assert.deepEqual(resolveOfficialImageSubjects(lucianSlot("scene3")), {
      foreground: "character_plus_required_partner",
      partnerRole: "user",
      partnerDepiction: "cropped_identity_neutral",
      backgroundExtras: "optional_unnamed",
    });
    const scene2 = promptsFor(lucianSlot("scene2"));
    assert.equal(officialImageSubjectRuleForSlot(lucianSlot("scene2")), scene2.primaryPrompt.split("\n").find((row) => row.includes("FOREGROUND CAST:")));
    assert.match(scene2.primaryPrompt, /exactly one foreground person/);
    assert.doesNotMatch(scene2.primaryPrompt, /required foreground interaction partner/);
  });
});
