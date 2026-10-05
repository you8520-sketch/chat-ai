import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import {
  OFFICIAL_FOREGROUND_CAST_MARKER,
  OFFICIAL_LEGACY_ONE_PERSON_SENTENCE,
  OFFICIAL_REQUIRED_PARTNER_FOREGROUND_CLAUSE,
  OFFICIAL_SOLO_FOREGROUND_CLAUSE,
  officialImageSubjectRuleForSlot,
  resolveOfficialImageSubjects,
} from "@/lib/officialSupply/imageSubjects";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import type { OfficialAssetPlan, OfficialAssetSlotPlan } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters");

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

function promptsFor(slot: OfficialAssetSlotPlan, referenceRoleLayout: "slot_default" | "identity_then_style" = "slot_default") {
  const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
  return buildOfficialAssetPrompts({
    draft: lucian.draft,
    appearance: lucian.appearanceLock,
    style: testStyleCandidate("c1").dna,
    slot,
    referenceRoleLayout,
  });
}

function participantLine(prompt: string): string {
  const line = prompt.split("\n").find((row) => row.includes(OFFICIAL_FOREGROUND_CAST_MARKER));
  assert.ok(line, `missing ${OFFICIAL_FOREGROUND_CAST_MARKER}`);
  return line;
}

describe("official image subject owner (#participant-count)", () => {
  it("representative / signature solo keep one foreground person", () => {
    for (const slotKey of ["rep", "sig3"] as const) {
      const slot = lucianSlot(slotKey);
      const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot);
      const subjects = resolveOfficialImageSubjects(slot);
      assert.equal(subjects.foreground, "solo_character");
      assert.match(primaryPrompt, new RegExp(OFFICIAL_SOLO_FOREGROUND_CLAUSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_REQUIRED_PARTNER_FOREGROUND_CLAUSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(participantLine(primaryPrompt), participantLine(strictFallbackPrompt));
      assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
      assert.doesNotMatch(strictFallbackPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
    }
  });

  it("sig3 keeps shot/pose/expression owners and stays solo", () => {
    const slot = lucianSlot("sig3");
    const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot);
    assert.match(primaryPrompt, /head turned right three-quarter view/);
    assert.match(primaryPrompt, /low-angle camera looking slightly up/);
    assert.match(primaryPrompt, /knee-up or full-body shot/);
    assert.match(primaryPrompt, new RegExp(`Expression: ${slot.expression}`));
    assert.match(primaryPrompt, new RegExp(`Pose: ${slot.pose}`));
    assert.equal(resolveOfficialImageSubjects(slot).foreground, "solo_character");
    assert.equal(participantLine(primaryPrompt), officialImageSubjectRuleForSlot(slot));
    assert.equal(participantLine(strictFallbackPrompt), officialImageSubjectRuleForSlot(slot));
  });

  it("scene1 requires a foreground partner and does not also force one person", () => {
    const slot = lucianSlot("scene1");
    const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot);
    assert.equal(resolveOfficialImageSubjects(slot).foreground, "character_plus_required_partner");
    assert.match(primaryPrompt, new RegExp(OFFICIAL_REQUIRED_PARTNER_FOREGROUND_CLAUSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_SOLO_FOREGROUND_CLAUSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
    assert.doesNotMatch(strictFallbackPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
    assert.equal(participantLine(primaryPrompt), participantLine(strictFallbackPrompt));
    assert.match(primaryPrompt, new RegExp(`Pose: ${slot.pose}`));
  });

  it("scene3 requires a foreground interaction partner with matching fallback semantics", () => {
    const slot = lucianSlot("scene3");
    const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot);
    assert.equal(resolveOfficialImageSubjects(slot).foreground, "character_plus_required_partner");
    assert.match(primaryPrompt, new RegExp(OFFICIAL_REQUIRED_PARTNER_FOREGROUND_CLAUSE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(participantLine(primaryPrompt), participantLine(strictFallbackPrompt));
    assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
  });

  it("reference-role selection does not control participant count", () => {
    const scene1 = lucianSlot("scene1");
    const sig3 = lucianSlot("sig3");
    for (const slot of [scene1, sig3]) {
      const identity = promptsFor(slot, "slot_default");
      const dual = promptsFor(slot, "identity_then_style");
      assert.equal(participantLine(identity.primaryPrompt), participantLine(dual.primaryPrompt));
      assert.equal(participantLine(identity.strictFallbackPrompt), participantLine(dual.strictFallbackPrompt));
      assert.equal(participantLine(identity.primaryPrompt), participantLine(identity.strictFallbackPrompt));
    }
    assert.match(promptsFor(sig3, "identity_then_style").primaryPrompt, /Image 1 IDENTITY ONLY/);
    assert.match(promptsFor(scene1, "slot_default").primaryPrompt, /IDENTITY ANCHOR ONLY/);
  });

  it("every official slot declares a valid imageSubjects contract", () => {
    const dir = path.join(process.cwd(), "src/lib/officialSupply/pilot/characters");
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
        draftKey: string;
        assetPlan: OfficialAssetPlan;
      };
      for (const slot of data.assetPlan.slots) {
        const subjects = resolveOfficialImageSubjects(slot);
        assert.ok(slot.imageSubjects, `${data.draftKey}/${slot.slotKey}`);
        assert.deepEqual(slot.imageSubjects, subjects);
        if (slot.kind !== "scene") {
          assert.equal(subjects.foreground, "solo_character", `${data.draftKey}/${slot.slotKey}`);
          assert.equal(subjects.backgroundExtras, "none", `${data.draftKey}/${slot.slotKey}`);
        }
      }
    }
    assert.equal(resolveOfficialImageSubjects(lucianSlot("scene1")).foreground, "character_plus_required_partner");
    assert.equal(resolveOfficialImageSubjects(lucianSlot("scene2")).foreground, "solo_character");
    assert.equal(resolveOfficialImageSubjects(lucianSlot("scene3")).foreground, "character_plus_required_partner");
  });

  it("prompt assembly does not special-case scene1 or Korean partner keywords", () => {
    const promptSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imagePrompt.ts"), "utf8");
    const ownerSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imageSubjects.ts"), "utf8");
    assert.match(promptSource, /officialImageSubjectRuleForSlot/);
    assert.doesNotMatch(promptSource, /slotKey === ["']scene1["']/);
    assert.doesNotMatch(promptSource, /침입자/);
    assert.doesNotMatch(promptSource, /당신에게/);
    assert.doesNotMatch(ownerSource, /slotKey ===/);
    assert.doesNotMatch(ownerSource, /침입자/);
    assert.doesNotMatch(promptSource, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
  });
});
