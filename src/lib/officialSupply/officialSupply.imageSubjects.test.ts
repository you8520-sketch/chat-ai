import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { generateOfficialAssetPlan, type OfficialAuthorTransport } from "@/lib/officialSupply/author";
import { evaluateAssetPlan } from "@/lib/officialSupply/assetPlan";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import {
  OFFICIAL_FOREGROUND_CAST_MARKER,
  OFFICIAL_LEGACY_ONE_PERSON_SENTENCE,
  OFFICIAL_REQUIRED_PARTNER_COUNT_MARKER,
  OFFICIAL_SOLO_FOREGROUND_CLAUSE,
  OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE,
  officialImageSubjectRuleForSlot,
  resolveOfficialImageSubjects,
} from "@/lib/officialSupply/imageSubjects";
import { testAssetPlan, testDraft, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import type { OfficialAssetPlan, OfficialAssetSlotPlan, OfficialImageSubjects } from "@/lib/officialSupply/types";

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

function promptsFor(
  slot: OfficialAssetSlotPlan,
  referenceRoleLayout: "slot_default" | "identity_then_style" = "slot_default",
  draftKey = "pilot-rf-03"
) {
  const compiled = loadCompiledOfficialCharacterSource(draftKey);
  return buildOfficialAssetPrompts({
    draft: compiled.draft,
    appearance: compiled.appearanceLock,
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

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const USER_PARTNER_SUBJECTS = {
  foreground: "character_plus_required_partner",
  partnerRole: "user",
  backgroundExtras: "optional_unnamed",
} as const;

const POSE_PRESERVATION_CASES = [
  {
    draftKey: "pilot-rf-09",
    slotKey: "scene1",
    pose: "제단 뒤에서 쓰러져 플레이어의 품에 안긴다",
  },
  {
    draftKey: "pilot-rf-05",
    slotKey: "scene1",
    pose: "플레이어의 목에 단검을 겨누면서도 치명적인 힘을 주지 않고, 탈출로를 살핀다.",
  },
  {
    draftKey: "pilot-rf-07",
    slotKey: "scene2",
    pose: "상대와 나란히 서서 감춰 온 고장 기록을 군중 앞에 펼치고, 직접 계기 수치를 증언할지 선택을 맡긴다",
  },
  {
    draftKey: "pilot-rf-09",
    slotKey: "scene2",
    pose: "유리온실의 그늘에서 플레이어와 마주 앉아 기록을 펼친다",
  },
] as const;

function qaDraft() {
  return testDraft({ draftKey: "subjects-qa", name: "레온", vocabulary: ["궁정", "기사", "맹세", "성벽"] });
}

function stripImageSubjects(slot: OfficialAssetSlotPlan): OfficialAssetSlotPlan {
  const next = { ...slot };
  delete (next as { imageSubjects?: OfficialImageSubjects }).imageSubjects;
  return next;
}

function fakeAssetPlanTransport(slots: unknown[]): OfficialAuthorTransport {
  return {
    label: "fake-asset-plan",
    async completeJson() {
      return {
        text: JSON.stringify({ slots }),
        model: "fake-author-model",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        providerRequestId: null,
      };
    },
  };
}

const AUTHOR_PLAN_INPUT = {
  name: "레온",
  adult: false,
  defaultOutfit: "검은 예복",
  scene: {
    name: "레온",
    occupation: "기사",
    faction: "",
    socialPosition: "",
    ranked: [] as [],
    hooks: {
      immediateHook: "",
      repeatable: [],
      mediumConflict: "",
      longTermChange: "",
      personalSituation: "",
      backstoryResidue: [],
      userInitialView: "",
      relationshipCues: [],
    },
    anchors: [],
  },
  avoid: { combos: [], overusedMotifs: [] },
};

function authorSlot(imageSubjects?: OfficialImageSubjects | Record<string, string>) {
  return {
    slotKey: "sig1",
    kind: "signature",
    tag: "무표정",
    expression: "무표정",
    pose: "서서 내려다본다",
    outfit: "default",
    location: null,
    situation: null,
    characterPresence: "required",
    ...(imageSubjects ? { imageSubjects } : {}),
    depiction: "standard",
    personTag: null,
  };
}

describe("official image subject owner (#participant-count)", () => {
  it("representative / signature / emotion solo keep one foreground person", () => {
    for (const slotKey of ["rep", "sig3", "emo1"] as const) {
      const slot = lucianSlot(slotKey);
      const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot);
      const subjects = resolveOfficialImageSubjects(slot);
      assert.equal(subjects.foreground, "solo_character");
      assert.match(primaryPrompt, new RegExp(escapeRe(OFFICIAL_SOLO_FOREGROUND_CLAUSE)));
      assert.doesNotMatch(primaryPrompt, new RegExp(escapeRe(OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE)));
      assert.equal(participantLine(primaryPrompt), participantLine(strictFallbackPrompt));
      assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
      assert.doesNotMatch(strictFallbackPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
    }
  });

  it("sig3 keeps shot/pose/expression owners and stays solo", () => {
    const slot = lucianSlot("sig3");
    const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot);
    assert.match(primaryPrompt, /head turned right three-quarter view/);
    assert.match(primaryPrompt, /low-angle camera placed below the subject looking up/);
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
    assert.deepEqual(resolveOfficialImageSubjects(slot), USER_PARTNER_SUBJECTS);
    assert.equal(count(participantLine(primaryPrompt), OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE), 1);
    assert.match(primaryPrompt, new RegExp(escapeRe(OFFICIAL_REQUIRED_PARTNER_COUNT_MARKER)));
    assert.doesNotMatch(primaryPrompt, new RegExp(escapeRe(OFFICIAL_SOLO_FOREGROUND_CLAUSE)));
    assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
    assert.doesNotMatch(strictFallbackPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
    assert.equal(participantLine(primaryPrompt), participantLine(strictFallbackPrompt));
    assert.match(primaryPrompt, new RegExp(`Pose: ${slot.pose}`));
  });

  it("scene2 stays solo and does not grant a partner", () => {
    const slot = lucianSlot("scene2");
    const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot);
    assert.equal(resolveOfficialImageSubjects(slot).foreground, "solo_character");
    assert.match(primaryPrompt, new RegExp(escapeRe(OFFICIAL_SOLO_FOREGROUND_CLAUSE)));
    assert.doesNotMatch(primaryPrompt, new RegExp(escapeRe(OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE)));
    assert.equal(participantLine(primaryPrompt), participantLine(strictFallbackPrompt));
    assert.doesNotMatch(primaryPrompt, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
  });

  it("scene3 requires a foreground interaction partner with matching fallback semantics", () => {
    const slot = lucianSlot("scene3");
    const { primaryPrompt, strictFallbackPrompt } = promptsFor(slot);
    assert.deepEqual(resolveOfficialImageSubjects(slot), USER_PARTNER_SUBJECTS);
    assert.equal(count(participantLine(primaryPrompt), OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE), 1);
    assert.match(primaryPrompt, new RegExp(escapeRe(OFFICIAL_REQUIRED_PARTNER_COUNT_MARKER)));
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
    assert.equal(
      count(participantLine(promptsFor(scene1, "slot_default").primaryPrompt), OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE),
      1
    );
    assert.equal(
      count(participantLine(promptsFor(scene1, "identity_then_style").primaryPrompt), OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE),
      1
    );
  });

  it("every official slot declares a valid imageSubjects contract", () => {
    for (const file of fs.readdirSync(PILOT_DIR).filter((name) => name.endsWith(".json"))) {
      const data = JSON.parse(fs.readFileSync(path.join(PILOT_DIR, file), "utf8")) as {
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
        if (subjects.foreground === "character_plus_required_partner") {
          assert.equal(subjects.partnerRole, "user", `${data.draftKey}/${slot.slotKey}`);
          assert.equal("partnerDepiction" in subjects, false, `${data.draftKey}/${slot.slotKey}`);
        } else {
          assert.equal("partnerRole" in subjects, false, `${data.draftKey}/${slot.slotKey}`);
        }
      }
    }
    assert.deepEqual(resolveOfficialImageSubjects(lucianSlot("scene1")), USER_PARTNER_SUBJECTS);
    assert.equal(resolveOfficialImageSubjects(lucianSlot("scene2")).foreground, "solo_character");
    assert.deepEqual(resolveOfficialImageSubjects(lucianSlot("scene3")), USER_PARTNER_SUBJECTS);
  });

  it("keeps all current required-partner pilots as explicit user-role contracts", () => {
    const partnerSlots: string[] = [];
    for (const file of fs.readdirSync(PILOT_DIR).filter((name) => name.endsWith(".json"))) {
      const data = JSON.parse(fs.readFileSync(path.join(PILOT_DIR, file), "utf8")) as {
        draftKey: string;
        assetPlan: OfficialAssetPlan;
      };
      for (const slot of data.assetPlan.slots) {
        if (slot.imageSubjects.foreground !== "character_plus_required_partner") continue;
        partnerSlots.push(`${data.draftKey}/${slot.slotKey}`);
        assert.deepEqual(slot.imageSubjects, {
          foreground: "character_plus_required_partner",
          partnerRole: "user",
          backgroundExtras: slot.imageSubjects.backgroundExtras,
        });
      }
    }
    assert.equal(partnerSlots.length, 24);
  });

  it("user-role contract keeps interaction poses and allows a pose-needed partial fragment", () => {
    assert.match(OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE, /smallest identity-neutral cropped body fragment/);
    assert.match(OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE, /hand, wrist, or forearm when that is enough/);
    assert.match(OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE, /cropped arm, shoulder, or partial torso only when the Pose requires it/);
    assert.doesNotMatch(
      OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE,
      /represented only as a cropped hand, wrist, or forearm entering naturally from the frame edge/
    );
    for (const example of POSE_PRESERVATION_CASES) {
      const slot = readPilot(example.draftKey).assetPlan.slots.find((item) => item.slotKey === example.slotKey);
      assert.ok(slot, `${example.draftKey}/${example.slotKey}`);
      assert.equal(slot.pose, example.pose);
      assert.deepEqual(slot.imageSubjects, {
        foreground: "character_plus_required_partner",
        partnerRole: "user",
        backgroundExtras: slot.imageSubjects.backgroundExtras,
      });
      const { primaryPrompt } = promptsFor(slot, "slot_default", example.draftKey);
      assert.match(primaryPrompt, new RegExp(`Pose: ${escapeRe(example.pose)}`));
      assert.equal(count(participantLine(primaryPrompt), OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE), 1);
    }
  });

  it("prompt assembly does not special-case scene1 or Korean partner keywords", () => {
    const promptSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imagePrompt.ts"), "utf8");
    const ownerSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/imageSubjects.ts"), "utf8");
    const typeSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/types.ts"), "utf8");
    const authorPromptSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/authorPrompts.ts"), "utf8");
    assert.match(promptSource, /officialImageSubjectRuleForSlot/);
    assert.doesNotMatch(promptSource, /slotKey === ["']scene1["']/);
    assert.doesNotMatch(promptSource, /침입자/);
    assert.doesNotMatch(promptSource, /당신에게/);
    assert.doesNotMatch(ownerSource, /slotKey ===/);
    assert.doesNotMatch(ownerSource, /침입자/);
    assert.doesNotMatch(ownerSource, /당신/);
    assert.doesNotMatch(ownerSource, /유저/);
    assert.doesNotMatch(ownerSource, /플레이어/);
    assert.doesNotMatch(ownerSource, /defaultOfficialImageSubjects/);
    assert.doesNotMatch(ownerSource, /Pose line/);
    assert.doesNotMatch(ownerSource, /named_character/);
    assert.doesNotMatch(ownerSource, /full_explicit_identity/);
    assert.doesNotMatch(ownerSource, /cropped_identity_neutral/);
    assert.doesNotMatch(ownerSource, /OFFICIAL_NAMED_PARTNER/);
    assert.doesNotMatch(typeSource, /named_character/);
    assert.doesNotMatch(typeSource, /full_explicit_identity/);
    assert.doesNotMatch(typeSource, /partnerDepiction/);
    assert.doesNotMatch(authorPromptSource, /named_character|named partner|partnerDepiction|full_explicit_identity/);
    assert.doesNotMatch(promptSource, new RegExp(OFFICIAL_LEGACY_ONE_PERSON_SENTENCE));
  });

  it("plan QA fails closed on missing or malformed imageSubjects", () => {
    const draft = qaDraft();
    const missing = testAssetPlan();
    missing.slots[0] = stripImageSubjects(missing.slots[0]!);
    assert.ok(evaluateAssetPlan(draft, missing).errors.some((issue) => issue.code === "slot_image_subjects_missing"));

    const badForeground = testAssetPlan();
    badForeground.slots[0] = {
      ...badForeground.slots[0]!,
      imageSubjects: { foreground: "two_people", backgroundExtras: "none" } as unknown as OfficialImageSubjects,
    };
    assert.ok(
      evaluateAssetPlan(draft, badForeground).errors.some((issue) => issue.code === "slot_image_subjects_invalid")
    );

    const badExtras = testAssetPlan();
    badExtras.slots[0] = {
      ...badExtras.slots[0]!,
      imageSubjects: { foreground: "solo_character", backgroundExtras: "crowd" } as unknown as OfficialImageSubjects,
    };
    assert.ok(evaluateAssetPlan(draft, badExtras).errors.some((issue) => issue.code === "slot_image_subjects_invalid"));
  });

  it("plan QA accepts explicit solo and user-role partner contracts", () => {
    const draft = qaDraft();
    const solo = testAssetPlan();
    assert.deepEqual(evaluateAssetPlan(draft, solo).errors, []);
    const userPartner = testAssetPlan();
    userPartner.slots[11] = {
      ...userPartner.slots[11]!,
      imageSubjects: USER_PARTNER_SUBJECTS,
    };
    assert.deepEqual(evaluateAssetPlan(draft, userPartner).errors, []);
  });

  it("plan QA fails closed when a required partner is missing or unsupported", () => {
    const draft = qaDraft();
    const incomplete = testAssetPlan();
    incomplete.slots[11] = {
      ...incomplete.slots[11]!,
      imageSubjects: { foreground: "character_plus_required_partner", backgroundExtras: "optional_unnamed" } as unknown as OfficialImageSubjects,
    };
    assert.ok(
      evaluateAssetPlan(draft, incomplete).errors.some((issue) => issue.code === "slot_image_subjects_invalid")
    );

    const named = testAssetPlan();
    named.slots[11] = {
      ...named.slots[11]!,
      imageSubjects: {
        foreground: "character_plus_required_partner",
        partnerRole: "named_character",
        backgroundExtras: "optional_unnamed",
      } as unknown as OfficialImageSubjects,
    };
    assert.ok(evaluateAssetPlan(draft, named).errors.some((issue) => issue.code === "slot_image_subjects_invalid"));

    const leftoverDepiction = testAssetPlan();
    leftoverDepiction.slots[11] = {
      ...leftoverDepiction.slots[11]!,
      imageSubjects: {
        foreground: "character_plus_required_partner",
        partnerRole: "user",
        partnerDepiction: "cropped_identity_neutral",
        backgroundExtras: "optional_unnamed",
      } as unknown as OfficialImageSubjects,
    };
    assert.ok(
      evaluateAssetPlan(draft, leftoverDepiction).errors.some((issue) => issue.code === "slot_image_subjects_invalid")
    );

    const soloWithPartnerFields = testAssetPlan();
    soloWithPartnerFields.slots[0] = {
      ...soloWithPartnerFields.slots[0]!,
      imageSubjects: {
        foreground: "solo_character",
        partnerRole: "user",
        backgroundExtras: "none",
      } as unknown as OfficialImageSubjects,
    };
    assert.ok(
      evaluateAssetPlan(draft, soloWithPartnerFields).errors.some((issue) => issue.code === "slot_image_subjects_invalid")
    );
  });

  it("author parse fails closed on missing or invalid imageSubjects", async () => {
    await assert.rejects(
      () =>
        generateOfficialAssetPlan({
          transport: fakeAssetPlanTransport([authorSlot()]),
          plan: AUTHOR_PLAN_INPUT,
        }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "author_shape_invalid"
    );
    await assert.rejects(
      () =>
        generateOfficialAssetPlan({
          transport: fakeAssetPlanTransport([authorSlot({ foreground: "two_people", backgroundExtras: "none" })]),
          plan: AUTHOR_PLAN_INPUT,
        }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "author_shape_invalid"
    );
    await assert.rejects(
      () =>
        generateOfficialAssetPlan({
          transport: fakeAssetPlanTransport([
            authorSlot({ foreground: "solo_character", backgroundExtras: "crowd" }),
          ]),
          plan: AUTHOR_PLAN_INPUT,
        }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "author_shape_invalid"
    );
  });

  it("author parse keeps explicit solo and user-role partner contracts", async () => {
    const solo = await generateOfficialAssetPlan({
      transport: fakeAssetPlanTransport([
        authorSlot({ foreground: "solo_character", backgroundExtras: "none" }),
      ]),
      plan: AUTHOR_PLAN_INPUT,
    });
    assert.deepEqual(solo.plan.slots[0]?.imageSubjects, { foreground: "solo_character", backgroundExtras: "none" });

    const partner = await generateOfficialAssetPlan({
      transport: fakeAssetPlanTransport([authorSlot(USER_PARTNER_SUBJECTS)]),
      plan: AUTHOR_PLAN_INPUT,
    });
    assert.deepEqual(partner.plan.slots[0]?.imageSubjects, USER_PARTNER_SUBJECTS);
  });

  it("author parse fails closed on a required partner without a user-role contract", async () => {
    await assert.rejects(
      () =>
        generateOfficialAssetPlan({
          transport: fakeAssetPlanTransport([
            authorSlot({ foreground: "character_plus_required_partner", backgroundExtras: "optional_unnamed" }),
          ]),
          plan: AUTHOR_PLAN_INPUT,
        }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "author_shape_invalid"
    );
    await assert.rejects(
      () =>
        generateOfficialAssetPlan({
          transport: fakeAssetPlanTransport([
            authorSlot({
              foreground: "character_plus_required_partner",
              partnerRole: "named_character",
              backgroundExtras: "optional_unnamed",
            }),
          ]),
          plan: AUTHOR_PLAN_INPUT,
        }),
      (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "author_shape_invalid"
    );
  });

  it("prompt assembly refuses a missing participant contract instead of defaulting to solo", () => {
    const slot = stripImageSubjects(lucianSlot("scene1"));
    assert.throws(() => officialImageSubjectRuleForSlot(slot), /imageSubjects must be an explicit/);
    assert.throws(() => promptsFor(slot), /imageSubjects must be an explicit/);
  });
});
