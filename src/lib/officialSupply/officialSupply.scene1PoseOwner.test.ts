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
const IMAGE_PROMPT_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imagePrompt.ts"), "utf8");
const IMAGE_SUBJECTS_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imageSubjects.ts"), "utf8");
const SHOT_PLAN_SOURCE = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/shotPlan.ts"), "utf8");

const LEGACY_SCENE1_POSE = "침입자의 손목을 잡아 지하 금고의 좁은 도주로로 이끈다";
const SCENE1_POSE =
  "한 손으로 침입자의 손목을 옆에서 감싸 쥔 채 한 걸음 앞서 좁은 도주로를 향하고, 침입자는 뒤에서 따라온다";
const SCENE1_EXPRESSION = "추격을 의식하면서도 침입자의 대답을 살피는 날 선 표정";
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

describe("official Lucian scene1 pose owner (#wrist-lead)", () => {
  it("replaces only the canonical scene1 pose with explicit contact geometry", () => {
    const slot = lucianSlot("scene1");
    assert.equal(slot.pose, SCENE1_POSE);
    assert.notEqual(slot.pose, LEGACY_SCENE1_POSE);
    assert.equal(count(slot.pose, "손목"), 1);
    assert.match(slot.pose, /옆에서 감싸 쥔/);
    assert.match(slot.pose, /한 걸음 앞서/);
    assert.match(slot.pose, /뒤에서 따라온다/);
    assert.match(slot.pose, /좁은 도주로/);
    assert.doesNotMatch(slot.pose, /handshake|손을 잡지 않|잡지 않는다/i);
    assert.equal(slot.expression, SCENE1_EXPRESSION);
  });

  it("keeps participant, faceDirection, camera, and distance owners unchanged", () => {
    const slot = lucianSlot("scene1");
    const shot = resolveOfficialSlotShot(slot, "pilot-rf-03");
    assert.equal(resolveOfficialImageSubjects(slot).foreground, "character_plus_required_partner");
    assert.equal(shot.faceDirection, "right_three_quarter");
    assert.equal(shot.cameraAngle, "high_angle");
    assert.equal(shot.distance, "knee_or_full");
    assert.equal(OFFICIAL_FACE_PROMPT.right_three_quarter, "head turned right three-quarter view");
    assert.equal(OFFICIAL_CAMERA_PROMPT.high_angle, "high-angle camera looking slightly down");
  });

  it("emits the updated Pose line exactly once on primary and fallback", () => {
    const slot = lucianSlot("scene1");
    const poseLine = `Pose: ${SCENE1_POSE}`;
    for (const layout of ["slot_default", "identity_then_style"] as const) {
      const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot, layout);
      assert.equal(count(primaryPrompt, poseLine), 1, layout);
      assert.equal(count(strictFallbackPrompt, poseLine), 1, layout);
      assert.doesNotMatch(primaryPrompt, new RegExp(LEGACY_SCENE1_POSE));
      assert.doesNotMatch(strictFallbackPrompt, new RegExp(LEGACY_SCENE1_POSE));
      assert.match(primaryPrompt, new RegExp(`Expression: ${SCENE1_EXPRESSION}`));
      assert.equal(count(primaryPrompt, OFFICIAL_FACE_PROMPT.right_three_quarter), 1);
      assert.equal(count(primaryPrompt, OFFICIAL_CAMERA_PROMPT.high_angle), 1);
      assert.equal(count(primaryPrompt, DISTANCE_KNEE), 1);
      assert.match(primaryPrompt, new RegExp(officialImageSubjectRuleForSlot(slot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("does not add a relation section, scene1 slotKey fork, or global hand rule", () => {
    assert.match(IMAGE_PROMPT_SOURCE, /slot\.pose\.trim\(\) \? `Pose: \$\{slot\.pose\}\.` : ""/);
    assert.doesNotMatch(IMAGE_PROMPT_SOURCE, /slotKey === ["']scene1["']/);
    assert.doesNotMatch(IMAGE_PROMPT_SOURCE, /RELATION|contact point|wrist-grab|five fingers|correct hands|no extra limbs/i);
    assert.doesNotMatch(IMAGE_SUBJECTS_SOURCE, /slotKey ===/);
    assert.doesNotMatch(IMAGE_SUBJECTS_SOURCE, /손목/);
    assert.doesNotMatch(SHOT_PLAN_SOURCE, /손목을 옆에서 감싸/);
    const { primaryPrompt } = promptsFor(lucianSlot("scene1"), "identity_then_style");
    assert.doesNotMatch(primaryPrompt, /RELATION CONTRACT|CONTACT POINT|RELATIONAL ACTION/i);
    assert.match(primaryPrompt, /Image 1 is IDENTITY ONLY/);
    assert.match(primaryPrompt, /Image 2 is STYLE ONLY/);
  });
});
