import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrpgBotAction } from "./botActionParse";
import { resolveTrpgCanonicalAttempt } from "./canonicalAttempt";
import { isTrpgActionType } from "./actionTypes";

describe("TRPG action_type canonical owner", () => {
  it("bot accept write path: persisted action_type equals parse(body).actionType", () => {
    const body = [
      "권태현은 앞을 본다.",
      "<<<ACTION_TYPE>>>",
      "defend",
      "<<<INTENT>>>",
      "권태현은 전방을 경계하려 했다.",
    ].join("\n");
    const persisted = parseTrpgBotAction(body).actionType;
    assert.equal(persisted, "defend");
    assert.ok(isTrpgActionType(persisted));
  });

  it("accepted AI submission: downstream resolver uses persisted action_type", () => {
    const body = [
      "강이현은 패드를 든다.",
      "<<<ACTION_TYPE>>>",
      "investigate",
      "<<<INTENT>>>",
      "강이현은 주변을 조사하려 했다.",
    ].join("\n");
    const persisted = "investigate";
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: body,
      actionType: persisted,
    });
    assert.equal(resolved.actionType, persisted);
  });

  it("persisted action_type wins over body marker after accept", () => {
    const body = [
      "prose",
      "<<<ACTION_TYPE>>>",
      "attack",
      "<<<INTENT>>>",
      "attempt",
    ].join("\n");
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: body,
      actionType: "defend",
    });
    assert.equal(resolved.actionType, "defend");
    assert.notEqual(parseTrpgBotAction(body).actionType, resolved.actionType);
  });

  it("missing body marker: valid persisted action_type is still canonical", () => {
    const body = "prose only without markers";
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: body,
      actionType: "stealth",
    });
    assert.equal(resolved.actionType, "stealth");
    assert.equal(parseTrpgBotAction(body).actionType, "free");
  });

  it("human action_type owner: persisted column only, body never bot-parsed", () => {
    const body = "앞으로 간다.\n<<<ACTION_TYPE>>>\nattack";
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "human",
      submissionBody: body,
      actionType: "free",
    });
    assert.equal(resolved.actionType, "free");
    assert.equal(resolved.canonicalAttempt, body);
  });
});
