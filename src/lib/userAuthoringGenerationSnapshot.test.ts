import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
  type CurrentTurnAuthoringDelegation,
} from "@/lib/currentTurnUserAuthoringDelegation";
import {
  buildGenerationContextJson,
  computePromptHash,
} from "@/lib/feedback/snapshot";

const routeSource = readFileSync("src/app/api/chat/route.ts", "utf8");

function contextFor(userAuthoring: CurrentTurnAuthoringDelegation): string {
  return buildGenerationContextJson({
    writingStyle: "unified",
    completedTurns: 3,
    targetResponseChars: 2500,
    userAuthoring,
    model: "fixture-model",
    provider: "fixture-provider",
    route: "safe",
    nsfw: false,
  });
}

describe("generation snapshot canonical authoring provenance", () => {
  it("Main RP snapshots the canonical current-turn delegation, not legacy persona/user-note impersonation", () => {
    assert.doesNotMatch(routeSource, /resolveUserImpersonationAllowance/);
    assert.doesNotMatch(routeSource, /\buserImpersonation\b/);
    assert.match(
      routeSource,
      /userAuthoring:\s*currentTurnDelegationForTurn/
    );
  });

  it("stores canonical authoring provenance and removes the retired legacy boolean", () => {
    const contextJson = contextFor(INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION);
    const parsed = JSON.parse(contextJson) as Record<string, unknown>;

    assert.deepEqual(
      parsed.userAuthoring,
      INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(parsed, "userImpersonation"),
      false
    );
  });

  it("changes prompt grouping hash when the actual canonical authoring state changes", () => {
    const allowDialogue: CurrentTurnAuthoringDelegation = {
      active: true,
      allowDialogue: true,
      allowMajorActions: false,
      allowInnerPov: false,
      allowIrreversibleFate: false,
      allowAiCastIrreversibleExpansion: false,
      source: "chat_setting",
      duration: "persistent",
    };

    const limitedJson = contextFor(INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION);
    const dialogueJson = contextFor(allowDialogue);

    assert.notEqual(limitedJson, dialogueJson);
    assert.notEqual(
      computePromptHash(limitedJson),
      computePromptHash(dialogueJson)
    );
  });

  it("is deterministic for the same canonical authoring state", () => {
    const a = contextFor(INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION);
    const b = contextFor({ ...INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION });
    assert.equal(a, b);
    assert.equal(computePromptHash(a), computePromptHash(b));
  });
});
