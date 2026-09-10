import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS,
  CHAT_ROOM_IMAGE_GENERATION_POINTS,
  resolveImageGenerationRequiredPoints,
} from "@/lib/chatImagePricing";
import { buildPartyIllustrationReferencePlan } from "@/lib/chatImageVisualIdentity";
import {
  applyTrpgCastImagePicks,
  type TrpgIllustrationCastMember,
} from "./illustrationCast";

function member(
  participantId: number,
  name: string,
  imageUrl: string | null,
  gallery: string[] = imageUrl ? [imageUrl] : []
): TrpgIllustrationCastMember {
  return {
    participantId,
    characterId: participantId,
    kind: "ai_character",
    name,
    aliases: [name],
    gender: "male",
    role: "companion character",
    imageUrl,
    images: gallery.map((url) => ({ url, tag: "선택" })),
    appearanceNote: "",
  };
}

function partyPlan(members: TrpgIllustrationCastMember[]) {
  return buildPartyIllustrationReferencePlan(members);
}

describe("TRPG participant identity-reference pricing regression (shared canonical owner)", () => {
  it("TRPG-1 1 participant + selected asset -> exact selected asset reaches the grounded reference", () => {
    const plan = partyPlan([
      member(1, "권태현", "/uploads/taehyun.webp", ["/uploads/taehyun.webp"]),
    ]);
    assert.equal(plan.canGenerate, true);
    assert.deepEqual(plan.referenceUrls, ["/uploads/taehyun.webp"]);
    assert.equal(plan.subjects[0]?.referenceIndex, 1);
    assert.equal(plan.subjects[0]?.referenceImageUrl, "/uploads/taehyun.webp");
    assert.equal(
      resolveImageGenerationRequiredPoints(plan.referenceUrls.length),
      CHAT_ROOM_IMAGE_GENERATION_POINTS
    );
  });

  it("TRPG-2 2 participants + distinct selected assets -> both references preserved in order", () => {
    const plan = partyPlan([
      member(1, "권태현", "/uploads/a.webp"),
      member(2, "강이현", "/uploads/b.webp"),
    ]);
    assert.deepEqual(plan.referenceUrls, ["/uploads/a.webp", "/uploads/b.webp"]);
    assert.deepEqual(
      plan.subjects.map((subject) => subject.referenceIndex),
      [1, 2]
    );
    assert.equal(plan.referenceUrls.length, 2);
    assert.equal(
      resolveImageGenerationRequiredPoints(plan.referenceUrls.length),
      CHAT_ROOM_IMAGE_GENERATION_POINTS
    );
  });

  it("TRPG-3 3 participants -> all validated references preserved (base + 1 surcharge)", () => {
    const plan = partyPlan([
      member(1, "권태현", "/uploads/a.webp"),
      member(2, "강이현", "/uploads/b.webp"),
      member(3, "솔", "/uploads/c.webp"),
    ]);
    assert.deepEqual(plan.referenceUrls, ["/uploads/a.webp", "/uploads/b.webp", "/uploads/c.webp"]);
    assert.equal(
      resolveImageGenerationRequiredPoints(plan.referenceUrls.length),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("TRPG-4 4 participants -> existing current behavior preserved (all 4 refs, base + 2 surcharge)", () => {
    const plan = partyPlan([
      member(1, "권태현", "/uploads/a.webp"),
      member(2, "강이현", "/uploads/b.webp"),
      member(3, "솔", "/uploads/c.webp"),
      member(4, "로코", "/uploads/d.webp"),
    ]);
    assert.deepEqual(plan.referenceUrls, [
      "/uploads/a.webp",
      "/uploads/b.webp",
      "/uploads/c.webp",
      "/uploads/d.webp",
    ]);
    assert.equal(plan.referenceUrls.length, 4);
    assert.equal(
      resolveImageGenerationRequiredPoints(plan.referenceUrls.length),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("TRPG-5 pricing input is grounded attachment count, NOT participantCount", () => {
    // 4 participants selected, but one has no validated image (appearance-only).
    const plan = partyPlan([
      member(1, "권태현", "/uploads/a.webp"),
      member(2, "강이현", "/uploads/b.webp"),
      member(3, "솔", "/uploads/c.webp"),
      member(4, "로코", null),
    ]);
    assert.equal(plan.referenceUrls.length, 3);
    assert.equal(
      resolveImageGenerationRequiredPoints(plan.referenceUrls.length),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("TRPG-6 wrong-owner asset pick is rejected by the participant allowlist", () => {
    const next = applyTrpgCastImagePicks(
      [
        member(1, "권태현", "/uploads/a.webp", ["/uploads/a.webp", "/uploads/a2.webp"]),
        member(2, "강이현", "/uploads/b.webp", ["/uploads/b.webp"]),
      ],
      [{ participantId: 1, imageUrl: "/uploads/b.webp" }]
    );
    assert.equal(next[0]?.imageUrl, "/uploads/a.webp");
    const plan = partyPlan(next);
    assert.deepEqual(plan.referenceUrls, ["/uploads/a.webp", "/uploads/b.webp"]);
  });

  it("TRPG-7 hidden / unavailable asset pick is rejected", () => {
    const next = applyTrpgCastImagePicks(
      [member(1, "권태현", "/uploads/a.webp", ["/uploads/a.webp"])],
      [{ participantId: 1, imageUrl: "/uploads/secret.webp" }]
    );
    assert.equal(next[0]?.imageUrl, "/uploads/a.webp");
  });

  it("TRPG-8 stale client asset is revalidated against the server gallery", () => {
    const next = applyTrpgCastImagePicks(
      [member(1, "권태현", "/uploads/a.webp", ["/uploads/a.webp"])],
      [{ participantId: 1, imageUrl: "/uploads/old.webp" }]
    );
    assert.equal(next[0]?.imageUrl, "/uploads/a.webp");
  });

  it("TRPG-9 same final reference count -> same surcharge rule as general illustration/comic", () => {
    const route = readFileSync(
      new URL("../../app/api/chat/comic-generation/route.ts", import.meta.url),
      "utf8"
    );
    // TRPG party illustration flows through the SAME canonical pricing owner as
    // regular illustration: grounded referenceUrls -> resolveImageGenerationRequiredPoints.
    assert.match(route, /const identityReferenceCount = referenceUrls\.length;/);
    assert.match(
      route,
      /resolveImageGenerationRequiredPoints\(\s*identityReferenceCount,\s*resolveChatLdIllustrationPrice\(\)\s*\)/
    );
    // No TRPG-specific surcharge helper exists anywhere.
    assert.doesNotMatch(route, /participantSurcharge|partySurcharge|trpgSurcharge/i);
    // Uniform: a 4-identity-ref TRPG party costs the same as any 4-ref request.
    assert.equal(
      resolveImageGenerationRequiredPoints(4),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });
});