import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK,
  buildCharacterCanonBlock,
  buildStructuredCharacterCanonBlock,
  classifySettingSectionKnowledge,
} from "@/lib/characterKnowledgeBoundary";

const LEON_MIXED_WORLDVIEW = `[Worldview]
"My favorite character died again."

렌 was an ordinary modern person obsessed with Leon. Waking up, 렌 found themselves reborn as royalty in Serentia.

Two failures already. Each time, Leon fought the dark lord and died heroically. And the moment Leon died, 렌 regressed two weeks back.

This is the third regression. This time, they won't hold back.

Leon, due to 렌's regression, feels déjà vu and is unnervingly drawn to them.`;

const SYSTEM_BLOCK = `[System Command: Time & Event Management]
**Bad End Conditions (Loop Trigger)**
If either occurs: Display "Loop restarting."
[System Reset]: Regression to D-14, retaining all memories.`;

describe("characterKnowledgeBoundary", () => {
  it("boundary block forbids scenario-to-character knowledge transfer", () => {
    assert.match(CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK, /Knowledge is character-specific/);
    assert.match(CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK, /Scenario canon is not character memory/);
    assert.match(CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK, /Only \[B\] retains player-only secrets/);
    assert.match(CHARACTER_KNOWLEDGE_BOUNDARY_BLOCK, /Shared prompt context does not imply shared memories/);
  });

  it("splits regression paragraphs into PLAYER CANON", () => {
    const classified = classifySettingSectionKnowledge({
      title: "[Worldview]",
      body: LEON_MIXED_WORLDVIEW.replace(/^\[Worldview\]\n/, ""),
    });
    const player = classified.filter((c) => c.bucket === "player");
    const character = classified.filter((c) => c.bucket === "character");
    assert.ok(player.length >= 1);
    assert.ok(player.some((c) => /third regression/i.test(c.body)));
    assert.ok(character.some((c) => /d[ée]j[àa]\s*vu/i.test(c.body)));
  });

  it("routes system commands to SCENARIO META", () => {
    const classified = classifySettingSectionKnowledge({
      title: "[System Command: Time & Event Management]",
      body: SYSTEM_BLOCK.replace(/^\[System Command[^\n]*\n/, ""),
    });
    assert.equal(classified[0]?.bucket, "scenario_meta");
  });

  it("buildStructuredCharacterCanonBlock emits separated headers", () => {
    const sample = `${LEON_MIXED_WORLDVIEW}

[Name]
Leon von Eckhart

${SYSTEM_BLOCK}`;

    const block = buildStructuredCharacterCanonBlock(sample, "Leon");
    assert.match(block, /\[CHARACTER CANON — Leon MAY KNOW/);
    assert.match(block, /\[PLAYER CANON — Leon DOES NOT KNOW\]/);
    assert.match(block, /\[SCENARIO META — CREATOR /);
    assert.match(block, /Only \[B\] knows this/);
    assert.doesNotMatch(block, /^\[CORE IDENTITY\]/m);
    assert.ok(block.indexOf("[PLAYER CANON") < block.indexOf("third regression") || block.includes("third regression"));
  });

  it("buildCharacterCanonBlock delegates to structured builder", () => {
    const block = buildCharacterCanonBlock("[Name]\nHero\n[Personality]\nBrave.", "Hero");
    assert.match(block, /\[CHARACTER CANON — Hero MAY KNOW/);
    assert.ok(block.includes("Brave."));
  });
});
