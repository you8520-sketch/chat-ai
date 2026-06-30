import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCharacterCanonBlock,
  collectCharacterSettingText,
} from "@/lib/bodyHairRules";
import type { CharacterChunk } from "@/types";

describe("character profile canon (bodyHairRules)", () => {
  it("buildCharacterCanonBlock wraps profile in structured canon headers", () => {
    const text = "이름: 히어로\n성별: 남\n[외형] 금발";
    const block = buildCharacterCanonBlock(text, "히어로");
    assert.match(block, /\[CHARACTER CANON — 히어로 MAY KNOW/);
    assert.ok(block.includes("히어로"));
    assert.ok(block.includes("금발"));
  });

  it("routes plot/system sections to PLAYER or SCENARIO buckets", () => {
    const identity = "이름: 레온\n성별: 남";
    const appearance = "[외형]\n192cm, 찬란한 금발, 푸른 눈";
    const speech = "[말투]\n해요체";
    const plot = `[시스템 명령]\n${"{{user}}는 소설 속으로 빙의했다. D-Day 루프. ".repeat(180)}`;
    const full = `${identity}\n\n${appearance}\n\n${speech}\n\n${plot}`;
    const block = buildCharacterCanonBlock(full, "레온");
    assert.ok(block.includes("금발"));
    assert.ok(block.includes("해요체"));
    assert.match(block, /\[SCENARIO META — CREATOR /);
    assert.doesNotMatch(block, /^\[CORE IDENTITY\]/m);
  });

  it("collectCharacterSettingText joins all chunks once", () => {
    const chunks: CharacterChunk[] = [
      {
        id: "a",
        characterId: "1",
        content: "[Identity]\nHero",
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 1,
        keywords: [],
      },
      {
        id: "b",
        characterId: "1",
        content: "[World]\nLore",
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 1,
        keywords: [],
      },
    ];
    const combined = collectCharacterSettingText(chunks);
    assert.ok(combined.includes("[Identity]"));
    assert.ok(combined.includes("[World]"));
    assert.equal(buildCharacterCanonBlock(combined, "Hero").split("[CHARACTER CANON").length - 1, 1);
  });

  it("returns empty string for blank input", () => {
    assert.equal(buildCharacterCanonBlock(""), "");
    assert.equal(buildCharacterCanonBlock("   "), "");
  });
});
