import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trackTurnTailWork } from "@/lib/turnTailWork";
import { waitForOwnedChatMemory } from "./ownedChatMemoryBarrier";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("owned chat memory barrier", () => {
  it("waits for an owned chat's pending memory tail and returns the reloaded row", async () => {
    const gate = deferred();
    trackTurnTailWork(gate.promise, { chatId: 1101, memoryCritical: true });
    let reloadCalled = false;
    let settled = false;
    const wait = waitForOwnedChatMemory(
      { id: 1101, memory_meta: "stale" },
      {
        memoryEnabled: true,
        timeoutMs: 1_000,
        reload: () => {
          reloadCalled = true;
          return { id: 1101, memory_meta: "fresh" };
        },
      }
    ).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, false);
    assert.equal(reloadCalled, false);
    gate.resolve();
    const result = await wait;
    assert.equal(result.waited, true);
    assert.equal(result.timedOut, false);
    assert.equal(reloadCalled, true);
    assert.equal(result.chat?.memory_meta, "fresh");
  });

  it("does not wait for a missing or foreign chat (undefined ownership row)", async () => {
    let reloadCalled = false;
    const result = await waitForOwnedChatMemory<{ id: number }>(undefined, {
      memoryEnabled: true,
      reload: () => {
        reloadCalled = true;
        return { id: 1 };
      },
    });
    assert.deepEqual(result, { chat: undefined, waited: false, timedOut: false });
    assert.equal(reloadCalled, false);
  });

  it("does not wait when memory is disabled", async () => {
    let reloadCalled = false;
    const original = { id: 1202, memory_meta: "stale" };
    const result = await waitForOwnedChatMemory(original, {
      memoryEnabled: false,
      reload: () => {
        reloadCalled = true;
        return { id: 1202, memory_meta: "fresh" };
      },
    });
    assert.equal(result.chat, original);
    assert.equal(result.waited, false);
    assert.equal(reloadCalled, false);
  });

  it("returns the reloaded row even when the wait times out", async () => {
    const gate = deferred();
    trackTurnTailWork(gate.promise, { chatId: 1303, memoryCritical: true });
    const result = await waitForOwnedChatMemory(
      { id: 1303, memory_meta: "stale" },
      {
        memoryEnabled: true,
        timeoutMs: 25,
        reload: () => ({ id: 1303, memory_meta: "fresh" }),
      }
    );
    assert.equal(result.waited, true);
    assert.equal(result.timedOut, true);
    assert.equal(result.chat?.memory_meta, "fresh");
    gate.resolve();
  });

  it("returns undefined when the row disappears during the wait", async () => {
    const gate = deferred();
    trackTurnTailWork(gate.promise, { chatId: 1404, memoryCritical: true });
    const wait = waitForOwnedChatMemory(
      { id: 1404, memory_meta: "stale" },
      {
        memoryEnabled: true,
        timeoutMs: 1_000,
        reload: () => undefined,
      }
    );
    gate.resolve();
    const result = await wait;
    assert.equal(result.waited, true);
    assert.equal(result.chat, undefined);
  });
});
