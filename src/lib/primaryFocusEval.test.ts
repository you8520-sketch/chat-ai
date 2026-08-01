import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { evaluatePrimaryFocus } from "@/lib/primaryFocusEval";

describe("primaryFocusEval — production smoke re-score", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "data/world-motion-v1_1-main-home-smoke-turns.json"),
      "utf8"
    )
  ) as {
    primaryCharacter: string;
    knownSupportingNames: string[];
    turns: string[];
  };

  it("turn1: primary focus diluted when primary exits for supporting NPC call", () => {
    const r = evaluatePrimaryFocus({
      prose: fixture.turns[0],
      primaryCharacter: fixture.primaryCharacter,
      knownSupportingNames: fixture.knownSupportingNames,
    });
    assert.equal(r.primaryFocusDiluted, true);
    assert.ok(r.reasonCodes.includes("PRIMARY_EXIT_FOR_SUPPORTING_NPC"));
  });

  it("turn2: records supporting NPC dialogue pressure", () => {
    const r = evaluatePrimaryFocus({
      prose: fixture.turns[1],
      primaryCharacter: fixture.primaryCharacter,
      knownSupportingNames: fixture.knownSupportingNames,
    });
    assert.ok(r.supportingNpcDialogueBlocks >= 1);
  });

  it("turn3: detects grounded NPC fanout and focus dilution", () => {
    const r = evaluatePrimaryFocus({
      prose: fixture.turns[2],
      primaryCharacter: fixture.primaryCharacter,
      knownSupportingNames: fixture.knownSupportingNames,
    });
    assert.ok(r.supportingSpeakingNpcCount > 1);
    assert.equal(r.npcFanoutDetected, true);
    assert.equal(r.primaryFocusDiluted, true);
  });

  it("evaluator must not mark all three production smoke turns as PASS", () => {
    const results = fixture.turns.map((prose) =>
      evaluatePrimaryFocus({
        prose,
        primaryCharacter: fixture.primaryCharacter,
        knownSupportingNames: fixture.knownSupportingNames,
      })
    );
    const allPass = results.every((r) => !r.primaryFocusDiluted && !r.npcFanoutDetected);
    assert.equal(allPass, false);
  });
});
