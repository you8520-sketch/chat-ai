import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canImportCharacterIntoSimulation,
  canUseCharacterInTrpg,
  type CharacterAccessRow,
} from "./characterVisibility";

function row(partial: Partial<CharacterAccessRow> & Pick<CharacterAccessRow, "id">): CharacterAccessRow {
  return {
    creator_id: 2,
    visibility: "public",
    moderation_status: "approved",
    share_slug: null,
    official: 0,
    trpg_reuse_allowed: 0,
    ...partial,
  };
}

describe("canUseCharacterInTrpg", () => {
  it("always allows the owner, including private characters with reuse off", () => {
    assert.equal(
      canUseCharacterInTrpg(
        row({ id: 1, creator_id: 1, visibility: "private", moderation_status: "pending", trpg_reuse_allowed: 0 }),
        1
      ),
      true
    );
  });

  it("always allows official characters without opt-in", () => {
    assert.equal(
      canUseCharacterInTrpg(row({ id: 1, creator_id: null, official: 1, trpg_reuse_allowed: 0 }), 9),
      true
    );
  });

  it("blocks another user's public character until TRPG reuse is on", () => {
    assert.equal(canUseCharacterInTrpg(row({ id: 1, trpg_reuse_allowed: 0 }), 1), false);
    assert.equal(canUseCharacterInTrpg(row({ id: 1, trpg_reuse_allowed: 1 }), 1), true);
  });

  it("does not treat link-only characters as reusable by others", () => {
    assert.equal(
      canUseCharacterInTrpg(
        row({ id: 1, visibility: "link", trpg_reuse_allowed: 1 }),
        1
      ),
      false
    );
  });
});

describe("canImportCharacterIntoSimulation", () => {
  it("allows the simulation author to import their own characters", () => {
    assert.equal(canImportCharacterIntoSimulation(7, 7), true);
  });

  it("blocks importing another creator's character into a simulation", () => {
    assert.equal(canImportCharacterIntoSimulation(2, 7), false);
    assert.equal(canImportCharacterIntoSimulation(null, 7), false);
  });
});
