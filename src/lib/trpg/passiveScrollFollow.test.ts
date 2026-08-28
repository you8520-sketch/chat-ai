import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideLiveFollowOnGrowth,
  decidePassiveScrollFollowUpdate,
  shouldDetachLiveFollowOnUserIntent,
} from "./followLatest";

describe("POST-705 passive scroll follow ownership", () => {
  it("PASSIVE_SCROLL_DOES_NOT_DETACH while following and not manually detached", () => {
    for (let i = 0; i < 5; i += 1) {
      const growth = decideLiveFollowOnGrowth({ following: true });
      assert.equal(growth.autoFollow, true, `growth ${i} AUTO_FOLLOW`);
      const passive = decidePassiveScrollFollowUpdate({
        manualDetached: false,
        following: true,
        nearFollowOwner: false,
        hasLeftFollowZoneSinceDetach: false,
      });
      assert.equal(passive.following, true, `passive ${i} FOLLOWING`);
      assert.equal(passive.rejoin, false);
      assert.equal(passive.unseenLatest, false);
    }
  });

  it("USER_INTENT_SCROLL_DETACHES and growth stops auto-follow", () => {
    assert.equal(shouldDetachLiveFollowOnUserIntent(), true);
    const detachedGrowth = decideLiveFollowOnGrowth({ following: false });
    assert.equal(detachedGrowth.autoFollow, false);
    assert.equal(detachedGrowth.unseenLatest, true);
    const passiveWhileDetached = decidePassiveScrollFollowUpdate({
      manualDetached: true,
      following: false,
      nearFollowOwner: false,
      hasLeftFollowZoneSinceDetach: true,
    });
    assert.equal(passiveWhileDetached.following, false);
    assert.equal(passiveWhileDetached.unseenLatest, true);
  });

  it("explicit rejoin restores follow after manual detach", () => {
    const rejoin = decidePassiveScrollFollowUpdate({
      manualDetached: true,
      following: false,
      nearFollowOwner: true,
      hasLeftFollowZoneSinceDetach: true,
    });
    assert.equal(rejoin.rejoin, true);
    assert.equal(rejoin.following, true);
    assert.equal(rejoin.unseenLatest, false);
  });
});
