import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADMIN_IMAGELESS_PRIVATE_DRAFT_CHIP,
  isAdminImagelessPrivateCharacterDraft,
  studioWorkModerationChipLabel,
} from "@/lib/studioWorkStatusLabel";
import { moderationLabel } from "@/lib/characterVisibility";
import { isAdminUser } from "@/lib/isAdminUser";

const base = {
  ownerIsAdmin: true,
  isSimulation: false,
  official: 0,
  visibility: "private" as const,
  moderation: "approved" as const,
  assets: "[]",
  images: "[]",
};

describe("isAdminUser (studio card gate)", () => {
  it("honors ADMIN_EMAILS and excludes portone reviewer even when is_admin=1", () => {
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "ops@example.com";
    try {
      assert.equal(isAdminUser({ email: "ops@example.com", is_admin: 0 }), true);
      assert.equal(isAdminUser({ email: "other@example.com", is_admin: 0 }), false);
      assert.equal(
        isAdminUser({ email: "ops@example.com", is_admin: 1, account_kind: "portone_reviewer" }),
        false,
      );
    } finally {
      if (prev === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prev;
    }
  });
});

describe("studioWorkModerationChipLabel", () => {
  it("shows draft copy for admin private character drafts without images when moderation is approved", () => {
    assert.equal(studioWorkModerationChipLabel(base), ADMIN_IMAGELESS_PRIVATE_DRAFT_CHIP);
    assert.ok(isAdminImagelessPrivateCharacterDraft(base));
  });

  it("keeps pending and rejected moderation labels on image-less admin private drafts", () => {
    for (const moderation of ["pending", "rejected"] as const) {
      assert.equal(
        studioWorkModerationChipLabel({ ...base, moderation }),
        moderationLabel(moderation),
      );
      assert.equal(isAdminImagelessPrivateCharacterDraft({ ...base, moderation }), false);
    }
  });

  it("keeps canonical moderation labels for everyone else", () => {
    const withImage = {
      ...base,
      assets: JSON.stringify([{ url: "/uploads/sample.webp", tag: "대표", representativeRank: 1 }]),
    };
    for (const moderation of ["approved", "pending", "rejected"] as const) {
      assert.equal(
        studioWorkModerationChipLabel({ ...base, ownerIsAdmin: false, moderation }),
        moderationLabel(moderation),
      );
      assert.equal(
        studioWorkModerationChipLabel({ ...withImage, moderation }),
        moderationLabel(moderation),
      );
      assert.equal(
        studioWorkModerationChipLabel({ ...base, moderation, visibility: "public" }),
        moderationLabel(moderation),
      );
      assert.equal(
        studioWorkModerationChipLabel({ ...base, moderation, official: 1 }),
        moderationLabel(moderation),
      );
      assert.equal(
        studioWorkModerationChipLabel({ ...base, moderation, isSimulation: true }),
        moderationLabel(moderation),
      );
    }
  });
});
