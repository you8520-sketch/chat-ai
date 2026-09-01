import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGlobalAssistantPostTurnRefreshCoordinator } from "@/lib/streamRouterRefreshGate";
import {
  addVisualRevealPendingId,
  clearVisualRevealPendingIds,
  removeVisualRevealPendingId,
} from "@/lib/visualRevealPendingOwner";

function makeStore() {
  return { ids: new Set<string>() };
}

describe("visualRevealPendingOwner", () => {
  it("duplicate add keeps count=1", () => {
    const store = makeStore();
    assert.equal(addVisualRevealPendingId(store, "A"), 1);
    assert.equal(addVisualRevealPendingId(store, "A"), null);
    assert.equal(store.ids.size, 1);
  });

  it("unknown remove keeps count unchanged", () => {
    const store = makeStore();
    addVisualRevealPendingId(store, "A");
    assert.equal(removeVisualRevealPendingId(store, "B"), null);
    assert.equal(store.ids.size, 1);
  });

  it("final remove with pending refresh flushes coalesced refresh once", () => {
    const store = makeStore();
    let count = 0;
    let refreshed = 0;
    const coord = createGlobalAssistantPostTurnRefreshCoordinator({
      refresh: () => {
        refreshed += 1;
      },
      getVisualRevealPendingCount: () => count,
    });

    addVisualRevealPendingId(store, "A");
    count = store.ids.size;
    coord.schedule();

    const next = removeVisualRevealPendingId(store, "A");
    assert.equal(next, 0);
    count = next;
    coord.onVisualRevealPendingCountChanged(count);
    assert.equal(refreshed, 1);
    assert.equal(coord.refreshCount(), 1);
  });

  it("two reveals — first remove does not refresh, second remove refreshes once", () => {
    const store = makeStore();
    let count = 0;
    let refreshed = 0;
    const coord = createGlobalAssistantPostTurnRefreshCoordinator({
      refresh: () => {
        refreshed += 1;
      },
      getVisualRevealPendingCount: () => count,
    });

    addVisualRevealPendingId(store, "A");
    addVisualRevealPendingId(store, "B");
    count = store.ids.size;
    coord.schedule();
    assert.equal(refreshed, 0);

    count = removeVisualRevealPendingId(store, "A")!;
    coord.onVisualRevealPendingCountChanged(count);
    assert.equal(refreshed, 0);
    assert.equal(store.ids.size, 1);

    count = removeVisualRevealPendingId(store, "B")!;
    coord.onVisualRevealPendingCountChanged(count);
    assert.equal(refreshed, 1);
  });

  it("clear empties ref ids and allows coalesced refresh", () => {
    const store = makeStore();
    let count = 0;
    let refreshed = 0;
    const coord = createGlobalAssistantPostTurnRefreshCoordinator({
      refresh: () => {
        refreshed += 1;
      },
      getVisualRevealPendingCount: () => count,
    });

    addVisualRevealPendingId(store, "A");
    addVisualRevealPendingId(store, "B");
    count = store.ids.size;
    coord.schedule();

    count = clearVisualRevealPendingIds(store);
    coord.onVisualRevealPendingCountChanged(count);
    assert.equal(store.ids.size, 0);
    assert.equal(refreshed, 1);
  });
});
