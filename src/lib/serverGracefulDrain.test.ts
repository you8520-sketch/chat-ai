import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  getTrackedGracefulTaskCount,
  installGracefulHttpDrain,
  resolveGracefulShutdownForceMs,
  trackGracefulTask,
} = require("./serverGracefulDrain.js") as {
  getTrackedGracefulTaskCount: () => number;
  installGracefulHttpDrain: (
    server: { close: (cb: (err?: Error) => void) => void },
    opts: {
      processRef: EventEmitter & {
        env: Record<string, string | undefined>;
        exit: (code: number) => void;
      };
      logger: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
      setTimeoutFn: (fn: () => void, ms: number) => { unref: () => void };
      clearTimeoutFn: (timer: unknown) => void;
    }
  ) => { begin: (signal: string) => void };
  resolveGracefulShutdownForceMs: (env?: Record<string, string | undefined>) => number;
  trackGracefulTask: <T>(task: Promise<T>) => Promise<T>;
};

class FakeProcess extends EventEmitter {
  env: Record<string, string | undefined>;
  exits: number[] = [];

  constructor(env: Record<string, string | undefined>) {
    super();
    this.env = env;
  }

  exit(code: number) {
    this.exits.push(code);
  }
}

const silentLogger = {
  log: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
};

test("uses Railway drain window with a 5-second kill safety margin", () => {
  assert.equal(
    resolveGracefulShutdownForceMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "120" }),
    115_000
  );
  assert.equal(resolveGracefulShutdownForceMs({}), 115_000);
  assert.equal(
    resolveGracefulShutdownForceMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "0" }),
    115_000
  );
});

test("SIGTERM stops accepting new HTTP work and waits for active requests before exit", async () => {
  const processRef = new FakeProcess({
    RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "120",
  });
  let closeCalls = 0;
  let closeCallback: ((err?: Error) => void) | null = null;
  let forceCallback: (() => void) | null = null;
  let forceDelay = 0;
  let cleared = false;

  installGracefulHttpDrain(
    {
      close(cb) {
        closeCalls += 1;
        closeCallback = cb;
      },
    },
    {
      processRef,
      logger: silentLogger,
      setTimeoutFn(fn, ms) {
        forceCallback = fn;
        forceDelay = ms;
        return { unref() {} };
      },
      clearTimeoutFn() {
        cleared = true;
      },
    }
  );

  processRef.emit("SIGTERM");

  assert.equal(closeCalls, 1);
  assert.equal(forceDelay, 115_000);
  assert.deepEqual(processRef.exits, []);
  assert.ok(forceCallback);

  closeCallback?.();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(cleared, true);
  assert.deepEqual(processRef.exits, [0]);

  processRef.emit("SIGTERM");
  assert.equal(closeCalls, 1, "duplicate shutdown signal must not start a second drain");
});

test("HTTP close waits for tracked detached work before clean exit", async () => {
  const processRef = new FakeProcess({
    RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "120",
  });
  let closeCallback: ((err?: Error) => void) | null = null;
  let cleared = false;
  let resolveTask: (() => void) | null = null;

  const task = new Promise<void>((resolve) => {
    resolveTask = resolve;
  });
  trackGracefulTask(task);
  assert.equal(getTrackedGracefulTaskCount(), 1);

  installGracefulHttpDrain(
    {
      close(cb) {
        closeCallback = cb;
      },
    },
    {
      processRef,
      logger: silentLogger,
      setTimeoutFn() {
        return { unref() {} };
      },
      clearTimeoutFn() {
        cleared = true;
      },
    }
  );

  processRef.emit("SIGTERM");
  closeCallback?.();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(cleared, false, "force timer must stay armed while detached work is pending");
  assert.deepEqual(processRef.exits, [], "process must not exit while detached work is pending");
  assert.equal(getTrackedGracefulTaskCount(), 1);

  resolveTask?.();
  await task;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(getTrackedGracefulTaskCount(), 0);
  assert.equal(cleared, true);
  assert.deepEqual(processRef.exits, [0]);
});

test("forces exit before Railway SIGKILL when active requests exceed the drain window", () => {
  const processRef = new FakeProcess({
    RAILWAY_DEPLOYMENT_DRAINING_SECONDS: "120",
  });
  let forceCallback: (() => void) | null = null;

  installGracefulHttpDrain(
    { close() {} },
    {
      processRef,
      logger: silentLogger,
      setTimeoutFn(fn) {
        forceCallback = fn;
        return { unref() {} };
      },
      clearTimeoutFn() {},
    }
  );

  processRef.emit("SIGTERM");
  assert.ok(forceCallback);
  forceCallback?.();
  assert.deepEqual(processRef.exits, [1]);
});
