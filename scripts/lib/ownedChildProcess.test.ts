import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPidAlive,
  spawnOwnedDetachedChild,
  stopOwnedChildProcess,
} from "./ownedChildProcess";

describe("owned child process group cleanup", { concurrency: 1 }, () => {
  it("SIGTERM stops a cooperative owned child without SIGKILL", async () => {
    const child = spawnOwnedDetachedChild(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const pid = child.pid;
    assert.ok(pid);
    assert.equal(isPidAlive(pid), true);
    const result = await stopOwnedChildProcess(child, { waitMs: 2_000 });
    assert.equal(result.usedKill, false);
    assert.equal(result.exited, true);
    assert.equal(isPidAlive(pid), false);
  });

  it("after TERM wait, SIGKILL reaps an ignoring owned child only", async () => {
    const child = spawnOwnedDetachedChild(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)",
      ],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    const pid = child.pid;
    assert.ok(pid);
    await new Promise<void>((resolve, reject) => {
      child.stdout?.once("data", () => resolve());
      child.once("exit", () => reject(new Error("child exited before ready")));
    });
    const result = await stopOwnedChildProcess(child, { waitMs: 250 });
    assert.equal(result.usedKill, true);
    assert.equal(result.exited, true);
    assert.equal(isPidAlive(pid), false);
  });
});
