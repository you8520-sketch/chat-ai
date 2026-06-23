import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CharacterChunk } from "@/types";
import {
  extractMainCharacterAppearanceBody,
  extractVisualAppearancePolicyFromChunks,
  buildVisualAnchorReminder,
} from "@/lib/visualAnchor";

function chunk(content: string, category: CharacterChunk["category"] = "identity"): CharacterChunk {
  return {
    id: "test-1",
    characterId: "c1",
    content,
    category,
    importance: "CRITICAL",
    tokenCount: 100,
    keywords: [],
  };
}

describe("extractMainCharacterAppearanceBody", () => {
  it("uses first character 외형 and ignores [Enemy] lore blocks", () => {
    const chunks = [
      chunk(`[이름]
에쉬

[외형] 키 175cm, 마른 체형, 은발, 푸른 눈

[Enemy:전투시스템]
외형:단순거대괴수가아닌코즈믹호러기괴한신체`),
    ];

    const body = extractMainCharacterAppearanceBody(chunks, "에쉬");
    assert.equal(body, "키 175cm, 마른 체형, 은발, 푸른 눈");
  });

  it("extractVisualAppearancePolicyFromChunks sets body from main profile", () => {
    const chunks = [
      chunk(`[외형] 검은 머리, 날카로운 눈매, 178cm

[NPC:경비]
외형:거대한 괴물`),
    ];

    const policy = extractVisualAppearancePolicyFromChunks(chunks, "백하율");
    assert.match(policy.body ?? "", /178cm/);
    assert.doesNotMatch(policy.body ?? "", /괴물/);
  });

  it("buildVisualAnchorReminder is hair/eye only — no body restatement", () => {
    const chunks = [
      chunk(
        `[외형] 키 175cm, 마른 체형, 은발, 푸른 눈

[Enemy:전투시스템]
외형:단순거대괴수`
      ),
    ];
    const policy = extractVisualAppearancePolicyFromChunks(chunks, "에쉬");
    const anchor = buildVisualAnchorReminder(policy);
    assert.ok(anchor);
    assert.match(anchor!, /Hair:.*은발/);
    assert.doesNotMatch(anchor!, /175cm/);
    assert.doesNotMatch(anchor!, /Body\/build/);
  });

  it("buildVisualAnchorReminder infers 금안 from body when eyes tag missing", () => {
    const policy = {
      hair: "silver" as const,
      hairLabel: "은발 (silver/platinum)",
      eyes: null,
      eyesLabel: null,
      body: "영롱한 금안이 특징이다.",
    };
    const anchor = buildVisualAnchorReminder(policy);
    assert.ok(anchor);
    assert.match(anchor!, /금안/);
  });
});
