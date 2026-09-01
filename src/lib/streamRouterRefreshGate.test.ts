import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGlobalAssistantPostTurnRefreshCoordinator,
  shouldDeferAssistantPostTurnRefresh,
  shouldDeferResumePostTurnPoll,
} from "@/lib/streamRouterRefreshGate";

describe("global assistant post-turn refresh coordinator", () => {
  it("R3 — immediate refresh when no visual reveal pending", () => {
    let pendingCount = 0;
    let refreshed = 0;
    const coord = createGlobalAssistantPostTurnRefreshCoordinator({
      refresh: () => {
        refreshed += 1;
      },
      getVisualRevealPendingCount: () => pendingCount,
    });

    coord.schedule();
    assert.equal(refreshed, 1);
    assert.equal(coord.hasPendingRefresh(), false);
  });

  it("R4 — multiple completions coalesce to one refresh after reveal idle", () => {
    let pendingCount = 1;
    let refreshed = 0;
    const coord = createGlobalAssistantPostTurnRefreshCoordinator({
      refresh: () => {
        refreshed += 1;
      },
      getVisualRevealPendingCount: () => pendingCount,
    });

    coord.schedule();
    coord.schedule();
    coord.schedule();
    assert.equal(refreshed, 0);
    assert.equal(coord.hasPendingRefresh(), true);

    pendingCount = 0;
    coord.onVisualRevealPendingCountChanged(0);
    assert.equal(refreshed, 1);
    assert.equal(coord.refreshCount(), 1);
  });

  it("R1 — poll completion during next reveal defers until global reveal idle", () => {
    let pendingCount = 0;
    let refreshed = 0;
    const coord = createGlobalAssistantPostTurnRefreshCoordinator({
      refresh: () => {
        refreshed += 1;
      },
      getVisualRevealPendingCount: () => pendingCount,
    });

    assert.equal(shouldDeferResumePostTurnPoll({ visualRevealPendingCount: pendingCount }), false);

    pendingCount = 1;
    coord.schedule();
    assert.equal(refreshed, 0);
    assert.equal(coord.hasPendingRefresh(), true);

    pendingCount = 0;
    coord.onVisualRevealPendingCountChanged(0);
    assert.equal(refreshed, 1);
  });

  it("R2 — turn A deferred refresh does not fire while turn B reveal pending", () => {
    let pendingCount = 1;
    let refreshed = 0;
    const coord = createGlobalAssistantPostTurnRefreshCoordinator({
      refresh: () => {
        refreshed += 1;
      },
      getVisualRevealPendingCount: () => pendingCount,
    });

    coord.schedule();
    assert.equal(refreshed, 0);
    assert.equal(coord.hasPendingRefresh(), true);

    pendingCount = 2;
    coord.onVisualRevealPendingCountChanged(2);
    assert.equal(refreshed, 0);

    pendingCount = 1;
    coord.onVisualRevealPendingCountChanged(1);
    assert.equal(refreshed, 0);
    assert.equal(coord.hasPendingRefresh(), true);

    pendingCount = 0;
    coord.onVisualRevealPendingCountChanged(0);
    assert.equal(refreshed, 1);
    assert.equal(coord.refreshCount(), 1);
  });

  it("shouldDeferAssistantPostTurnRefresh mirrors global reveal count", () => {
    assert.equal(shouldDeferAssistantPostTurnRefresh({ visualRevealPendingCount: 0 }), false);
    assert.equal(shouldDeferAssistantPostTurnRefresh({ visualRevealPendingCount: 2 }), true);
  });
});
