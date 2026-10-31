import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { briefRelationPremiseErrors } from "@/lib/officialSupply/adminAuthorDraft";
import type { PortfolioBriefInput } from "@/lib/officialSupply/authorPrompts";
import type { OfficialUserRelationType } from "@/lib/officialSupply/userRelationStart";

/** Minimal brief: only the fields the canonical premise validator reads. */
function brief(
  texts: { rpHook?: string; userRelationship?: string; oneLineConflict?: string; differentiationTwist?: string },
  type: OfficialUserRelationType = "free"
): PortfolioBriefInput {
  return {
    rpHook: texts.rpHook ?? "",
    marketFit: {
      userRelationship: texts.userRelationship ?? "",
      oneLineConflict: texts.oneLineConflict ?? "",
      differentiationTwist: texts.differentiationTwist ?? "",
    },
    userRelation: { type, fixed: "" },
  } as unknown as PortfolioBriefInput;
}

const ROLE_TEXT = "당신은 이 사건의 의뢰인입니다";

describe("G5-3Y early FREE premise gate", () => {
  it("passes a clean FREE brief (no forced role or shared past)", () => {
    assert.deepEqual(briefRelationPremiseErrors(brief({ rpHook: "시장에서 낯선 사람과 마주친다" })), []);
  });

  it("rejects a FREE brief whose rpHook forces a user role", () => {
    const errors = briefRelationPremiseErrors(brief({ rpHook: ROLE_TEXT }));
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /bible_user_rel_free_premise/);
  });

  it("scans the marketFit premise fields, not just the hook", () => {
    for (const field of ["userRelationship", "oneLineConflict", "differentiationTwist"] as const) {
      const errors = briefRelationPremiseErrors(brief({ [field]: ROLE_TEXT }));
      assert.equal(errors.length, 1, field);
      assert.match(errors[0]!, /bible_user_rel_free_premise/);
    }
  });

  it("keeps a declared ROLE_BOUND or RELATIONSHIP_BOUND premise legal", () => {
    assert.deepEqual(briefRelationPremiseErrors(brief({ rpHook: ROLE_TEXT }, "role_bound")), []);
    assert.deepEqual(briefRelationPremiseErrors(brief({ rpHook: ROLE_TEXT }, "relationship_bound")), []);
  });

  it("treats a missing userRelation as FREE, matching the bible-entry gate", () => {
    const noRelation = {
      rpHook: ROLE_TEXT,
      marketFit: { userRelationship: "", oneLineConflict: "", differentiationTwist: "" },
    } as unknown as PortfolioBriefInput;
    const errors = briefRelationPremiseErrors(noRelation);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /bible_user_rel_free_premise/);
  });
});
