import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADMIN_IMAGELESS_PRIVATE_DRAFT_CHIP,
  isAdminImagelessPrivateCharacterDraft,
  studioWorkModerationChipLabel,
} from "@/lib/studioWorkStatusLabel";
import { moderationLabel } from "@/lib/characterVisibility";

const base = {
  ownerIsAdmin: true,
  isSimulation: false,
  official: 0,
  visibility: "private" as const,
  moderation: "approved" as const,
  assets: "[]",
  images: "[]",
};

describe("studioWorkModerationChipLabel", () => {
  it("shows draft copy for admin private character drafts without images", () => {
    assert.equal(studioWorkModerationChipLabel(base), ADMIN_IMAGELESS_PRIVATE_DRAFT_CHIP);
    assert.ok(isAdminImagelessPrivateCharacterDraft(base));
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
