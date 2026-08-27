import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import {
  creatorTriggerValuesFromPayload,
  shouldEvaluateCreatorStatusTriggers,
} from "./creatorTriggerEvaluation";

const creatorValues = { character: { affection: "85" }, user: null };
const userOnlyValues = { character: null, user: { my_note: "메모" } };
const mixedNoCreator = { character: { time: "—" }, user: { my_note: "메모" } };

describe("creator status trigger evaluation predicate", () => {
  it("character_only + canonical + usable creator values → eligible", () => {
    assert.equal(
      shouldEvaluateCreatorStatusTriggers({
        derivedStateAllowed: true,
        needsCharacterValues: true,
        statusValues: creatorValues,
      }),
      true
    );
  });

  it("both + canonical + usable creator values → eligible", () => {
    assert.equal(
      shouldEvaluateCreatorStatusTriggers({
        derivedStateAllowed: true,
        needsCharacterValues: true,
        statusValues: { character: { affection: "85" }, user: { my_note: "x" } },
      }),
      true
    );
  });

  it("user_only → never eligible even with usable user values", () => {
    assert.equal(
      shouldEvaluateCreatorStatusTriggers({
        derivedStateAllowed: true,
        needsCharacterValues: false,
        statusValues: userOnlyValues,
      }),
      false
    );
  });

  it("off → never eligible", () => {
    assert.equal(
      shouldEvaluateCreatorStatusTriggers({
        derivedStateAllowed: true,
        needsCharacterValues: false,
        statusValues: creatorValues,
      }),
      false
    );
  });

  it("character_only + only user values / no usable creator values → not eligible", () => {
    assert.equal(
      shouldEvaluateCreatorStatusTriggers({
        derivedStateAllowed: true,
        needsCharacterValues: true,
        statusValues: userOnlyValues,
      }),
      false
    );
    assert.equal(
      shouldEvaluateCreatorStatusTriggers({
        derivedStateAllowed: true,
        needsCharacterValues: true,
        statusValues: mixedNoCreator,
      }),
      false
    );
  });

  it("non-canonical finalize → not eligible", () => {
    assert.equal(
      shouldEvaluateCreatorStatusTriggers({
        derivedStateAllowed: false,
        needsCharacterValues: true,
        statusValues: creatorValues,
      }),
      false
    );
  });

  it("creatorTriggerValuesFromPayload strips user source", () => {
    assert.deepEqual(
      creatorTriggerValuesFromPayload({
        character: { affection: "1" },
        user: { my_note: "x" },
      }),
      { character: { affection: "1" }, user: null }
    );
  });

  it("chat route uses one predicate for telemetry and runtime", () => {
    const route = readFileSync(
      new URL("../../app/api/chat/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(route, /const shouldEvaluateCreatorTriggers = shouldEvaluateCreatorStatusTriggers\(/);
    assert.match(route, /status_trigger_evaluated:\s*shouldEvaluateCreatorTriggers/);
    assert.match(route, /if \(shouldEvaluateCreatorTriggers\)/);
    assert.doesNotMatch(
      route,
      /status_trigger_evaluated:\s*Boolean\(\s*\n\s*statusWidgetActive/
    );
  });
});
