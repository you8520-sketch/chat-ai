import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CharacterChunk } from "@/types";
import {
  detectAppearancePolicyConflict,
  extractMainCharacterAppearanceBody,
  extractVisualAppearancePolicyFromChunks,
  buildCanonicalFactsBlock,
  extractCanonicalAppearanceDetails,
  sanitizeVisualAppearance,
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

  it("extractVisualAppearancePolicyFromChunks infers blonde from English golden hair body", () => {
    const chunks = [
      chunk(
        `[Appearance]
An overwhelming physique of 192cm. Messy, brilliant golden hair, and usually gentle, puppy-like blue eyes.`,
        "abilities"
      ),
    ];
    const policy = extractVisualAppearancePolicyFromChunks(chunks, "Leon");
    assert.equal(policy.hair, "blonde");
  });

  it("sanitizeVisualAppearance fixes poetic 은발 drift for blonde Leon lines", () => {
    const policy = {
      hair: "blonde" as const,
      hairLabel: "금발 (blonde)",
      eyes: "blue" as const,
      eyesLabel: "푸른 눈",
      body: null,
    };
    const text =
      "남은 것은 달빛 아래 은은히 빛나는 은발과, 차가운 밤공기만 남았다. \"제자리에서 흔들리는 은발의 기사가 달빛 아래 빛났다.\"";
    const out = sanitizeVisualAppearance(text, policy);
    assert.doesNotMatch(out, /은발/);
    assert.match(out, /금발/);
  });

  it("buildCanonicalFactsBlock declares immutable hair/eye from Character Identity", () => {
    const chunks = [
      chunk(
        `[외형] 키 175cm, 마른 체형, 은발, 푸른 눈

[Enemy:전투시스템]
외형:단순거대괴수`
      ),
    ];
    const policy = extractVisualAppearancePolicyFromChunks(chunks, "에쉬");
    const block = buildCanonicalFactsBlock("에쉬", policy);
    assert.ok(block);
    assert.match(block!, /\[CANONICAL FACTS\]/);
    assert.match(block!, /\[CANONICAL APPEARANCE\]/);
    assert.match(block!, /Hair[\s\S]*은발/);
    assert.match(block!, /This never changes/);
    assert.match(block!, /Height[\s\S]*175cm/);
    assert.match(block!, /Body type[\s\S]*slender build/);
    assert.doesNotMatch(block!, /APPEARANCE LOCK/);
    assert.doesNotMatch(block!, /은발.*금지|never.*silver/i);
  });

  it("extractCanonicalAppearanceDetails parses height and body type from English body", () => {
    const details = extractCanonicalAppearanceDetails(
      "An overwhelming physique of 192cm. Messy, brilliant golden hair."
    );
    assert.equal(details.height, "192cm");
    assert.equal(details.bodyType, "large build");
  });

  it("buildCanonicalFactsBlock infers 금안 from body when eyes tag missing", () => {
    const policy = {
      hair: "silver" as const,
      hairLabel: "은발 (silver/platinum)",
      eyes: null,
      eyesLabel: null,
      body: "영롱한 금안이 특징이다.",
    };
    const block = buildCanonicalFactsBlock("캐릭터", policy);
    assert.ok(block);
    assert.match(block!, /Eyes[\s\S]*금안/);
    assert.match(block!, /canonical facts always win/i);
  });

  it("ignores NPC black hair when protagonist profile says blonde", () => {
    const chunks = [
      chunk(
        `데미안 데 엘프레다: 황태자. 레온의 소꿉친구. 칠흑 같은 흑발에 보라빛 눈.`,
        "personality"
      ),
      chunk(
        `[외형]
192cm. 헝클어진 찬란한 금발. 푸른 눈. 칠흑 같은 검은색 제복.`,
        "abilities"
      ),
    ];
    const policy = extractVisualAppearancePolicyFromChunks(chunks, "레온");
    assert.equal(policy.hair, "blonde");
    assert.equal(policy.eyes, "blue");
    const body = extractMainCharacterAppearanceBody(chunks, "레온");
    assert.match(body ?? "", /금발/);
    assert.doesNotMatch(body ?? "", /흑발/);
  });

  it("sanitizeVisualAppearance replaces 은발 inside HTML for blonde policy", () => {
    const policy = {
      hair: "blonde" as const,
      hairLabel: "금발 (blonde)",
      eyes: "blue" as const,
      eyesLabel: "푸른 눈",
      body: null,
    };
    const html = `\`\`\`html\n<p>192cm 거구, 은발, 푸른눈</p><span>#은발거구</span>\n\`\`\``;
    const out = sanitizeVisualAppearance(html, policy);
    assert.match(out, /금발/);
    assert.doesNotMatch(out, /은발/);
  });

  it("detectAppearancePolicyConflict flags wrong hair color", () => {
    const policy = {
      hair: "blonde" as const,
      hairLabel: "금발",
      eyes: null,
      eyesLabel: null,
      body: null,
    };
    assert.equal(
      detectAppearancePolicyConflict("은발 포마드, 군청색 제복", policy),
      true
    );
    assert.equal(detectAppearancePolicyConflict("금발 단발", policy), false);
  });
});
