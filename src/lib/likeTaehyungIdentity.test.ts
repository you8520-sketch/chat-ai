import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRODUCTION_LIKE_CHARACTER_ID,
  PRODUCTION_LIKE_DISPLAY_NAME,
  isProductionLikeTaehyungRecord,
  preferKnownLikeId,
} from "@/lib/likeTaehyungIdentity";

describe("production 라이크 identity", () => {
  it("accepts id 18 named 라이크 with 조태형 in settings", () => {
    assert.equal(
      isProductionLikeTaehyungRecord({
        id: PRODUCTION_LIKE_CHARACTER_ID,
        name: PRODUCTION_LIKE_DISPLAY_NAME,
        system_prompt: "본명 조태형. 에이지스 센티넬.",
      }),
      true
    );
  });

  it("rejects a 조태형 display name even if settings mention 라이크", () => {
    assert.equal(
      isProductionLikeTaehyungRecord({
        id: 18,
        name: "조태형",
        description: "라이크",
      }),
      false
    );
  });

  it("rejects 라이크 without 조태형 in settings", () => {
    assert.equal(
      isProductionLikeTaehyungRecord({
        id: 99,
        name: "라이크",
        description: "다른 캐릭터",
      }),
      false
    );
  });

  it("prefers known production id when multiple 라이크 rows exist", () => {
    const picked = preferKnownLikeId([
      { id: 99, name: "라이크", system_prompt: "조태형 언급" },
      { id: 18, name: "라이크", system_prompt: "본명 조태형" },
    ]);
    assert.equal(picked?.id, 18);
  });
});
