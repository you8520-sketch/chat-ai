import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForReady(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/readyz`);
      if (response.status === 200 && (await response.text()) === "ready\n") return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`PID1 child did not become ready: ${lastError}`);
}

async function waitForChildExit(
  child: ReturnType<typeof spawn>,
  output: string[],
): Promise<[number | null, NodeJS.Signals | null]> {
  return new Promise((resolve) => {
    child.once("exit", (code, receivedSignal) => resolve([code, receivedSignal]));
    setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) {
        child.kill("SIGKILL");
      }
    }, 35_000).unref();
  }).catch((error) => {
    throw new Error(`${String(error)}\n${output.join("")}`);
  });
}

async function statusOrConnectionFailure(url: string): Promise<number> {
  try {
    return (await fetch(url)).status;
  } catch {
    return 0;
  }
}

async function waitForOutput(output: string[], pattern: RegExp, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(output.join(""))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Child output did not match ${pattern}:\n${output.join("")}`);
}

test(
  "direct Node PID1 command boots, serves readiness, and exits cleanly on SIGTERM",
  { skip: process.platform !== "linux" },
  async (t) => {
    const port = await reservePort();
    const dataDir = await mkdtemp(join(tmpdir(), "habby-server-lifecycle-pid1-"));
    const output: string[] = [];
    const child = spawn(process.execPath, ["--import", "tsx", "server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(port),
        DATA_DIR: dataDir,
        SESSION_SECRET: "pid1-test-session-secret-32chars-minimum",
        PLAYWRIGHT_PROD_SERVER: "1",
        TRPG_SCROLL_FOLLOW_LAB_ENABLED: "1",
        DISABLE_PAYOUT_SCHEDULER: "1",
        DISABLE_FINANCE_SCHEDULER: "1",
        DISABLE_WEB_PUSH: "1",
        ENABLE_TRAINING_PIPELINE: "0",
        OPENROUTER_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.ok(child.pid, "direct server child must have a PID");
    assert.equal(child.spawnargs.at(-1), "server.js");
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));

    t.after(async () => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
      await rm(dataDir, { recursive: true, force: true });
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForReady(baseUrl);
    const home = await fetch(baseUrl);
    assert.equal(home.status, 200);
    await home.text();
    const login = await fetch(`${baseUrl}/api/auth/demo-login`, { method: "POST" });
    assert.equal(login.status, 200);
    await login.text();
    const cookie = login.headers.get("set-cookie");
    assert.ok(cookie, "demo login must provide a session cookie for the active request");

    const activeBody = JSON.stringify({ characterId: 2, message: "pid1 drain proof" });
    let resolveActiveResponse!: (response: Response) => void;
    let rejectActiveResponse!: (error: Error) => void;
    const activeResponse = new Promise<Response>((resolve, reject) => {
      resolveActiveResponse = resolve;
      rejectActiveResponse = reject;
    });
    const active = httpRequest(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(activeBody),
        cookie,
      },
    }, (response) => {
      response.resume();
      response.once("end", () => {
        resolveActiveResponse(new Response(null, { status: response.statusCode ?? 0 }));
      });
    });
    active.on("error", (error) => rejectActiveResponse(error));
    active.write(activeBody.slice(0, 1));
    await new Promise((resolve) => setTimeout(resolve, 100));

    child.kill("SIGTERM");
    await waitForOutput(output, /SIGTERM received; entering draining state \(activeRequests=1\)/);
    assert.notEqual(await statusOrConnectionFailure(`${baseUrl}/readyz`), 200);
    assert.notEqual(await statusOrConnectionFailure(baseUrl), 200);

    active.end(activeBody.slice(1));
    const completed = await activeResponse;
    assert.equal(completed.status, 200, "the existing active stream must be allowed to finish");

    const [exitCode, signal] = await waitForChildExit(child, output);
    assert.equal(exitCode, 0, output.join(""));
    assert.equal(signal, null, output.join(""));
    assert.match(output.join(""), /active HTTP work drained; exiting cleanly/);
  }
);
