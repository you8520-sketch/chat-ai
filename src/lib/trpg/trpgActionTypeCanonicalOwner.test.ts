import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrpgBotAction } from "./botActionParse";
import { resolveTrpgCanonicalAttempt } from "./canonicalAttempt";
import { isTrpgActionType } from "./actionTypes";

/** Audit-only: documents action_type canonical owner without changing production. */
describe("TRPG action_type canonical owner audit", () => {
  it("bot accept write path: persisted action_type equals parse(body).actionType", () => {
    const body = [
      "권태현은 앞을 본다.",
      "<<<ACTION_TYPE>>>",
      "defend",
      "<<<INTENT>>>",
      "권태현은 전방을 경계하려 했다.",
    ].join("\n");
    const parsed = parseTrpgBotAction(body);
    const persisted = parsed.actionType;
    assert.equal(persisted, "defend");
    assert.ok(isTrpgActionType(persisted));
  });

  it("normal AI read path: resolver re-parse matches persisted value at accept time", () => {
    const body = [
      "강이현은 패드를 든다.",
      "<<<ACTION_TYPE>>>",
      "investigate",
      "<<<INTENT>>>",
      "강이현은 주변을 조사하려 했다.",
    ].join("\n");
    const persisted = parseTrpgBotAction(body).actionType;
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: body,
      actionType: persisted,
    });
    assert.equal(resolved.actionType, persisted);
    assert.equal(resolved.actionType, "investigate");
  });

  it("mismatch fixture: body marker vs persisted DB value diverge only under artificial insert", () => {
    const body = [
      "prose",
      "<<<ACTION_TYPE>>>",
      "attack",
      "<<<INTENT>>>",
      "attempt",
    ].join("\n");
    const persistedMismatch = "defend";
    const resolved = resolveTrpgCanonicalAttempt({
      participantKind: "ai_character",
      submissionBody: body,
      actionType: persistedMismatch,
    });
    assert.equal(resolved.actionType, "attack");
    assert.notEqual(resolved.actionType, persistedMismatch);
    // mechanicsRound reads DB; adjudication resolver re-parses body — split only if writer breaks invariant
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
