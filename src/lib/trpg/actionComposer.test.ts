import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { trpgActionComposerForRound } from "./actionComposer";
import { resolveTrpgActionInitialBody, trpgActionDraftKey } from "../userInputDraft";
import type { TrpgActionType } from "./actionTypes";

/**
 * Room apply() handoff: composer reset for the new round, then
 * server-locked body over the local draft stored under the new round key.
 * A null result means the round did not change, so the composer is left alone.
 */
function roundHandoffBody(
  previousRound: number | null,
  nextRound: number,
  serverDraft: { body?: string | null; actionType?: TrpgActionType | null } | null,
  localBody: string | null
): string | null {
  const reset = trpgActionComposerForRound(previousRound, nextRound, serverDraft);
  if (!reset) return null;
  return resolveTrpgActionInitialBody(reset.body, localBody);
}

describe("TRPG next-round action composer", () => {
  it("does not reset while staying on the same round or before the first snapshot", () => {
    assert.equal(trpgActionComposerForRound(null, 3, { body: "이전 턴" }), null);
    assert.equal(trpgActionComposerForRound(3, 3, { body: "이전 턴" }), null);
  });

  it("clears the previous turn body when the round advances", () => {
    assert.deepEqual(trpgActionComposerForRound(2, 3, { body: "" }), {
      body: "",
      actionType: "free",
    });
    assert.deepEqual(trpgActionComposerForRound(2, 3, null), {
      body: "",
      actionType: "free",
    });
    assert.deepEqual(trpgActionComposerForRound(2, 3, { body: "   " }), {
      body: "",
      actionType: "free",
    });
  });

  it("keeps a draft that already belongs to the new round", () => {
    assert.deepEqual(
      trpgActionComposerForRound(2, 3, { body: "새 라운드 초안", actionType: "talk" }),
      { body: "새 라운드 초안", actionType: "talk" }
    );
  });

  it("hands a new round to server lock, then the new-round local draft", () => {
    assert.equal(roundHandoffBody(3, 3, { body: "같은 라운드 서버" }, "로컬"), null);
    assert.equal(roundHandoffBody(null, 3, { body: "첫 스냅샷" }, "로컬"), null);

    assert.equal(
      roundHandoffBody(2, 3, { body: "서버 잠금", actionType: "investigate" }, "로컬 초안"),
      "서버 잠금"
    );
    assert.equal(roundHandoffBody(2, 3, { body: "   " }, "새 라운드 로컬"), "새 라운드 로컬");
    assert.equal(roundHandoffBody(2, 3, null, null), "");
    assert.notEqual(trpgActionDraftKey(7, 2), trpgActionDraftKey(7, 3));

    const source = fs.readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    const applyStart = source.indexOf("const apply = useCallback");
    const applyEnd = source.indexOf("}, []);", applyStart);
    assert.ok(applyStart >= 0 && applyEnd > applyStart, "apply() must own the round handoff");
    const apply = source.slice(applyStart, applyEnd);
    assert.match(apply, /appliedRoundRef/);
    assert.match(
      apply,
      /trpgActionComposerForRound\(appliedRoundRef\.current, next\.round\.number, next\.myDraft\)/
    );
    assert.match(apply, /trpgActionDraftKey\(next\.id, next\.round\.number\)/);
    assert.match(apply, /resolveTrpgActionInitialBody\(reset\.body, local\?\.body\)/);
    assert.match(apply, /setActionBody\(body\)/);
    assert.doesNotMatch(apply, /setActionBody\(reset\.body\)/);

    const serverBranch = apply.slice(
      apply.indexOf("if (reset.body.trim())"),
      apply.indexOf("} else if (local?.body?.trim())")
    );
    assert.match(serverBranch, /setInputOrigin\("manual"\)/);
    assert.doesNotMatch(serverBranch, /local\.inputOrigin/);
    assert.match(apply, /local\.inputOrigin === "reply_suggestion" \|\| local\.inputOrigin === "manual"/);
    assert.match(apply, /else if \(next\.myDraft\?\.body\)/);
    assert.match(source, /suggestionRound !== snap\.round\.number/);
    const suggestionStart = source.indexOf("if (suggestionRound !== snap.round.number)");
    const suggestionEnd = source.indexOf(
      "}, [snap.id, snap.myDraft, snap.round.number, suggestionRound]);",
      suggestionStart
    );
    const suggestion = source.slice(suggestionStart, suggestionEnd);
    assert.doesNotMatch(suggestion, /setActionBody\(/);
    assert.doesNotMatch(suggestion, /setInputOrigin\(/);
  });
});
