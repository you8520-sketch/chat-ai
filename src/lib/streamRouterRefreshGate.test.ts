import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDeferredRouterRefreshGate,
  shouldDeferAssistantRouterRefresh,
} from "@/lib/streamRouterRefreshGate";

describe("streamRouterRefreshGate", () => {
  it("defers refresh while reveal pending and coalesces multiple schedules", async () => {
    let idle = false;
    let refreshed = 0;
    const gate = createDeferredRouterRefreshGate({
      refresh: () => {
        refreshed += 1;
      },
      isRevealIdle: () => idle,
      streamIntervalMs: () => 30,
      waitUntilRevealIdle: async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
    });

    assert.equal(shouldDeferAssistantRouterRefresh({ streamIntervalMs: 30, revealIdle: false }), true);
    gate.schedule();
    gate.schedule();
    gate.schedule();
    assert.equal(refreshed, 0);
    assert.equal(gate.hasPendingDeferredRefresh(), true);

    idle = true;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(refreshed, 1);
    assert.equal(gate.refreshCount(), 1);
  });

  it("refreshes immediately when reveal idle", () => {
    let refreshed = 0;
    const gate = createDeferredRouterRefreshGate({
      refresh: () => {
        refreshed += 1;
      },
      isRevealIdle: () => true,
      streamIntervalMs: () => 30,
      waitUntilRevealIdle: async () => {},
    });
    gate.schedule();
    assert.equal(refreshed, 1);
  });

  it("done + reveal pending + suggested replies schedule coalesces to one refresh after idle", async () => {
    let idle = false;
    let refreshed = 0;
    const gate = createDeferredRouterRefreshGate({
      refresh: () => {
        refreshed += 1;
      },
      isRevealIdle: () => idle,
      streamIntervalMs: () => 30,
      waitUntilRevealIdle: async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
    });

    gate.schedule();
    gate.schedule();
    assert.equal(refreshed, 0);

    idle = true;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(refreshed, 1);
  });

  it("instant stream interval never defers", () => {
    assert.equal(
      shouldDeferAssistantRouterRefresh({ streamIntervalMs: 0, revealIdle: false }),
      false
    );
  });
});
