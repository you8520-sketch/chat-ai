import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertNoTrpgForkRequest, rejectTrpgFork } from "./timeline";
import { TRPG_ALLOW_FORK, TRPG_FORK_FORBIDDEN_MESSAGE } from "./types";

describe("TRPG timeline", () => {
  it("forbids chat-style campaign forks", () => {
    assert.equal(TRPG_ALLOW_FORK, false);
    assert.throws(rejectTrpgFork, (e: unknown) => e instanceof Error && e.message === TRPG_FORK_FORBIDDEN_MESSAGE);
    assert.throws(
      () => assertNoTrpgForkRequest({ parentCampaignId: 9, characterId: 2 }),
      (e: unknown) => e instanceof Error && e.message === TRPG_FORK_FORBIDDEN_MESSAGE
    );
    assert.throws(() => assertNoTrpgForkRequest({ forkFromRound: 3 }));
    assert.doesNotThrow(() => assertNoTrpgForkRequest({ characterId: 2 }));
  });
});
