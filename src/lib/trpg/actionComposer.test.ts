import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import { trpgActionComposerForRound } from "./actionComposer";

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

  it("resets the room composer when the snapshot round number changes", () => {
    const source = fs.readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.match(source, /trpgActionComposerForRound/);
    assert.match(source, /appliedRoundRef/);
    assert.match(source, /setActionBody\(reset\.body\)/);
    assert.match(source, /suggestionRound !== snap\.round\.number/);
  });
});
