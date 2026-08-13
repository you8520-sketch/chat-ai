import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyTrpgCastImagePicks, type TrpgIllustrationCastMember } from "./illustrationCast";

function member(
  opts: Partial<TrpgIllustrationCastMember> & Pick<TrpgIllustrationCastMember, "participantId" | "name">
): TrpgIllustrationCastMember {
  return {
    characterId: 2,
    kind: "ai_character",
    aliases: [],
    gender: "male",
    role: "companion character",
    imageUrl: "/uploads/a.webp",
    images: [
      { url: "/uploads/a.webp", tag: "대표" },
      { url: "/uploads/b.webp", tag: "전투" },
    ],
    ...opts,
  };
}

describe("TRPG illustration cast image picks", () => {
  it("applies a selectable image to the matching participant only", () => {
    const next = applyTrpgCastImagePicks(
      [
        member({ participantId: 1, name: "권태현" }),
        member({ participantId: 2, name: "강이현", imageUrl: "/uploads/c.webp", images: [{ url: "/uploads/c.webp", tag: "대표" }] }),
      ],
      [{ participantId: 1, imageUrl: "/uploads/b.webp" }]
    );
    assert.equal(next[0]?.imageUrl, "/uploads/b.webp");
    assert.equal(next[1]?.imageUrl, "/uploads/c.webp");
  });

  it("ignores images that are not in that member's gallery", () => {
    const next = applyTrpgCastImagePicks(
      [member({ participantId: 1, name: "권태현" })],
      [{ participantId: 1, imageUrl: "/uploads/hack.webp" }]
    );
    assert.equal(next[0]?.imageUrl, "/uploads/a.webp");
  });
});
