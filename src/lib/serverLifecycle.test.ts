import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, get } from "node:http";
import { once } from "node:events";
import test from "node:test";
import {
  DRAINING,
  READY_PATH,
  RUNNING,
  createServerLifecycle,
} from "./serverLifecycle.js";

type Fixture = {
  baseUrl: string;
  exits: number[];
  lifecycle: ReturnType<typeof createServerLifecycle>;
  close: () => Promise<void>;
};

function request(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

async function fixture(opts?: { holdMs?: number; drainDeadlineMs?: number }): Promise<Fixture> {
  const processRef = new EventEmitter() as NodeJS.Process;
  const exits: number[] = [];
  let lifecycle: ReturnType<typeof createServerLifecycle>;
  const server = createServer((req, res) => {
    if (lifecycle.handleReadiness(req, res)) return;
    if (!lifecycle.isRunning()) {
      lifecycle.rejectDrainingRequest(res);
      return;
    }
    lifecycle.markRequestActive(res);
    if (req.url === "/hold") {
      setTimeout(() => res.end("held\n"), opts?.holdMs ?? 40);
      return;
    }
    res.end("ok\n");
  });
  lifecycle = createServerLifecycle({
    server,
    processRef,
    drainDeadlineMs: opts?.drainDeadlineMs ?? 200,
    exit: (code) => exits.push(code),
    log: { info() {}, warn() {}, error() {} },
  });
  lifecycle.installSignalHandlers();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    exits,
    lifecycle,
    close: async () => {
      if (!server.listening) return;
      server.close();
      await once(server, "close");
    },
  };
}

test("readiness is 200 while running and never enters application request accounting", async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.equal(f.lifecycle.state(), RUNNING);
  assert.deepEqual(await request(`${f.baseUrl}${READY_PATH}`), { status: 200, body: "ready\n" });
  assert.equal(f.lifecycle.activeRequestCount(), 0);
});

test("SIGTERM drains active work, stops accepts, and exits cleanly once work finishes", async (t) => {
  const f = await fixture({ holdMs: 70 });
  t.after(f.close);
  const active = request(`${f.baseUrl}/hold`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.lifecycle.activeRequestCount(), 1);

  const shutdown = f.lifecycle.beginShutdown("SIGTERM");
  assert.equal(f.lifecycle.state(), DRAINING);
  assert.deepEqual(await active, { status: 200, body: "held\n" });
  assert.equal(await shutdown, 0);
  assert.deepEqual(f.exits, [0]);
  await assert.rejects(request(`${f.baseUrl}/`));
});

test("duplicate signals share one shutdown sequence", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const first = f.lifecycle.beginShutdown("SIGTERM");
  const second = f.lifecycle.beginShutdown("SIGINT");
  assert.equal(first, second);
  assert.equal(await first, 0);
  assert.deepEqual(f.exits, [0]);
});

test("bounded deadline force-closes a stuck active request exactly once", async (t) => {
  const f = await fixture({ holdMs: 1_000, drainDeadlineMs: 20 });
  t.after(f.close);
  const active = request(`${f.baseUrl}/hold`).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.lifecycle.activeRequestCount(), 1);
  assert.equal(await f.lifecycle.beginShutdown("SIGTERM"), 1);
  await active;
  assert.deepEqual(f.exits, [1]);
});
