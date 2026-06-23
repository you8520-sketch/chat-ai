import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USER_NOTE_FOCUS_MAX } from "@/lib/persona";
import { extractFocusZoneNote } from "@/lib/userNoteStatusWindow";
import {
  resolveUserImpersonationAllowance,
  resolveUserImpersonationFromNote,
} from "@/lib/userImpersonationPolicy";

describe("resolveUserImpersonationAllowance", () => {
  it("defaults to false with no OOC", () => {
    assert.equal(
      resolveUserImpersonationAllowance({
        personaDescription: "차갑고 무뚝뚝한 성격",
        userNote: "세계관: 현대 판타지",
      }),
      false
    );
  });

  it("enables on explicit allow in focus-zone userNote OOC", () => {
    assert.equal(
      resolveUserImpersonationFromNote("(OOC: 유저 사칭 허용)"),
      true
    );
    assert.equal(
      resolveUserImpersonationAllowance({ userNote: "(OOC: 유저 사칭 허용)" }),
      true
    );
    assert.equal(
      resolveUserImpersonationAllowance({ userNote: "OOC: 사칭 허용" }),
      true
    );
    assert.equal(
      resolveUserImpersonationAllowance({ userNote: "(OOC: co-narration on)" }),
      true
    );
  });

  it("deny OOC overrides prior allow", () => {
    assert.equal(
      resolveUserImpersonationAllowance({
        userNote: "(OOC: 유저 사칭 허용)\n(OOC: 사칭 금지)",
      }),
      false
    );
    assert.equal(
      resolveUserImpersonationAllowance({
        personaDescription: "(OOC: 유저 사칭 허용)",
        userNote: "(OOC: 사칭 금지)",
      }),
      false
    );
  });

  it("does not enable from reference-zone OOC only", () => {
    const focusPad = "a".repeat(USER_NOTE_FOCUS_MAX);
    const referenceOnly = `${focusPad}\n(OOC: 유저 사칭 허용)`;
    assert.equal(
      resolveUserImpersonationAllowance({
        userNote: extractFocusZoneNote(referenceOnly),
      }),
      false
    );
  });

  it("does not enable on broad style phrases without explicit allow", () => {
    assert.equal(
      resolveUserImpersonationAllowance({ userNote: "(OOC: 3인칭 소설로 써줘)" }),
      false
    );
    assert.equal(
      resolveUserImpersonationAllowance({ userNote: "(OOC: 공동 서술 톤)" }),
      false
    );
    assert.equal(
      resolveUserImpersonationAllowance({
        personaDescription: "(OOC: 내 대사도 작성해줘)",
      }),
      false
    );
  });

  it("still enables from persona description OOC", () => {
    assert.equal(
      resolveUserImpersonationAllowance({
        personaDescription: "(OOC: 유저 조종 허용)",
      }),
      true
    );
  });
});
