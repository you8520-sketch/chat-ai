import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import net from "node:net";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import {
  isOwnedGroupAlive,
  isPidAlive,
  signalOwnedProcessGroup,
  spawnOwnedDetachedChild,
  stopOwnedChildProcess,
} from "./ownedChildProcess";

function listenFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("no port"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return predicate();
}

function spawnTermIgnoringListenGroup(port: number) {
  const grandchildSrc = `
process.on("SIGTERM", () => {});
const s = require("node:net").createServer();
s.listen(${port}, "127.0.0.1", () => process.stdout.write("listen-ready\\n"));
setInterval(() => {}, 1000);
`;
  const parentSrc = `
const { spawn } = require("node:child_process");
process.on("SIGTERM", () => process.exit(0));
const gc = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildSrc)}], {
  stdio: ["ignore", "inherit", "inherit"],
});
if (!gc.pid) process.exit(2);
process.stdout.write("parent-ready " + gc.pid + "\\n");
setInterval(() => {}, 1000);
`;
  const child = spawnOwnedDetachedChild(process.execPath, ["-e", parentSrc], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  return child;
}

async function waitGroupReady(
  child: ReturnType<typeof spawnOwnedDetachedChild>,
  port: number
): Promise<{ leaderPid: number; grandchildPid: number }> {
  const leaderPid = child.pid;
  assert.ok(leaderPid);
  const grandchildPid = await new Promise<number>((resolve, reject) => {
    let buf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += String(chunk);
      const match = buf.match(/parent-ready (\d+)/);
      if (match) resolve(Number(match[1]));
    });
    child.once("exit", () => reject(new Error("leader exited before ready")));
    setTimeout(() => reject(new Error("timeout waiting parent-ready")), 8_000);
  });
  assert.equal(
    await waitUntil(() => isPortListening(port), 8_000),
    true,
    `grandchild ${grandchildPid} never listened`
  );
  return { leaderPid, grandchildPid };
}

async function reapOwnedGroup(pgid: number | null | undefined): Promise<void> {
  if (pgid == null) return;
  signalOwnedProcessGroup(pgid, "SIGKILL");
  await waitUntil(() => !isOwnedGroupAlive(pgid), 2_000);
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

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
    assert.equal(isOwnedGroupAlive(pid), false);
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
    assert.equal(isOwnedGroupAlive(pid), false);
  });

  it("leader SIGTERM-exit does not hide a TERM-ignoring grandchild LISTEN server", async () => {
    const port = await listenFreePort();
    assert.notEqual(port, 3000);
    const child = spawnTermIgnoringListenGroup(port);
    const leaderPid = child.pid;
    let grandchildPid = 0;
    try {
      ({ grandchildPid } = await waitGroupReady(child, port));
      const result = await stopOwnedChildProcess(child, { waitMs: 800 });
      assert.equal(result.exited, true, "group leftover must not be reported as a clean exit");
      assert.equal(result.usedKill, true);
      assert.equal(isPidAlive(leaderPid!), false);
      assert.equal(isPidAlive(grandchildPid), false);
      assert.equal(await isPortListening(port), false);
      assert.equal(isOwnedGroupAlive(leaderPid!), false);
    } finally {
      await reapOwnedGroup(leaderPid);
    }
  });

  it("leader-exited-first still keeps the owned group alive until leftovers are reaped", async () => {
    const port = await listenFreePort();
    assert.notEqual(port, 3000);
    const child = spawnTermIgnoringListenGroup(port);
    const leaderPid = child.pid;
    let grandchildPid = 0;
    try {
      ({ grandchildPid } = await waitGroupReady(child, port));
      process.kill(leaderPid!, "SIGTERM");
      assert.equal(await waitUntil(() => !isPidAlive(leaderPid!), 2_000), true);
      assert.equal(isPidAlive(grandchildPid), true);
      assert.equal(await isPortListening(port), true);
      assert.equal(
        isOwnedGroupAlive(leaderPid!),
        true,
        "leader-dead + leftover member must not look like group absence"
      );

      const result = await stopOwnedChildProcess(child, { waitMs: 800 });
      assert.equal(result.exited, true);
      assert.equal(result.usedKill, true);
      assert.equal(isPidAlive(grandchildPid), false);
      assert.equal(await isPortListening(port), false);
      assert.equal(isOwnedGroupAlive(leaderPid!), false);
    } finally {
      await reapOwnedGroup(leaderPid);
    }
  });

  it("ESRCH is the only probe result treated as group absence", () => {
    assert.equal(
      isOwnedGroupAlive(4242, () => {
        throw errno("ESRCH");
      }),
      false
    );
    assert.equal(
      isOwnedGroupAlive(4242, () => {
        throw errno("EPERM");
      }),
      true,
      "permission errors must not look like the group is gone"
    );
    assert.equal(
      isOwnedGroupAlive(4242, () => {
        throw new Error("query failed");
      }),
      true,
      "unclassified query errors must not look like the group is gone"
    );
  });

  it("stopOwnedChildProcess does not treat a group probe error as a clean exit", async () => {
    const result = await stopOwnedChildProcess({ pid: 4242 } as ChildProcess, {
      waitMs: 80,
      probeGroup: () => {
        throw errno("EPERM");
      },
    });
    assert.equal(result.pid, 4242);
    assert.equal(result.exited, false);
    assert.equal(result.usedKill, true);
  });
});
