import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listOpenTurnTailWork,
  trackTurnTailWork,
  waitForTurnTailWork,
} from "./turnTailWork";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("turn tail memory barrier", () => {
  it("waits for the same chat's memory-critical tail", async () => {
    const d = deferred();
    trackTurnTailWork(d.promise, { chatId: 101, memoryCritical: true });
    let settled = false;
    const wait = waitForTurnTailWork(101, { timeoutMs: 1_000 }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, false, "must not resolve before the tail settles");
    d.resolve();
    const result = await wait;
    assert.deepEqual(result, { waited: true, timedOut: false });
  });

  it("ignores another chat's tail", async () => {
    const d = deferred();
    trackTurnTailWork(d.promise, { chatId: 202, memoryCritical: true });
    const result = await waitForTurnTailWork(203, { timeoutMs: 1_000 });
    assert.deepEqual(result, { waited: false, timedOut: false });
    d.resolve();
  });

  it("ignores a non-memory tail by default", async () => {
    const d = deferred();
    trackTurnTailWork(d.promise, { chatId: 303, memoryCritical: false });
    const result = await waitForTurnTailWork(303, { timeoutMs: 1_000 });
    assert.deepEqual(result, { waited: false, timedOut: false });
    d.resolve();
  });

  it("returns a bounded timeout instead of blocking forever", async () => {
    const d = deferred();
    trackTurnTailWork(d.promise, { chatId: 404, memoryCritical: true });
    const started = Date.now();
    const result = await waitForTurnTailWork(404, { timeoutMs: 25 });
    assert.deepEqual(result, { waited: true, timedOut: true });
    assert.ok(Date.now() - started < 1_000);
    d.resolve();
  });

  it("keeps the existing live-measure list API", () => {
    const d = deferred();
    trackTurnTailWork(d.promise, { chatId: 505, memoryCritical: true });
    assert.ok(listOpenTurnTailWork().includes(d.promise));
    d.resolve();
  });
});
