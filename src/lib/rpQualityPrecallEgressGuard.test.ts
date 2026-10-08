import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const GUARD_URL = pathToFileURL(
  path.resolve("scripts/lib/rpQualityPrecallEgressGuard.ts")
).href;

type ChildResult = { stdout: string; stderr: string; status: number | null };

const UNWRAP = "const log = console.log.bind(console);\nconst unwrap = (m) => (m.default && !m.precallEgressAttempts && !m.getRealTimeExchangeRate ? m.default : m);\n";

function runChild(code: string, env: Record<string, string> = {}): Promise<ChildResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", UNWRAP + code],
      { encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000 },
      (error, stdout, stderr) => {
        const status = error ? ((error as { code?: unknown }).code as number | null) ?? null : 0;
        resolve({ stdout, stderr, status: typeof status === "number" ? status : null });
      }
    );
  });
}

describe("rp quality PRECALL egress guard", () => {
  let server: net.Server;
  let port = 0;
  let connections = 0;
  const sockets = new Set<net.Socket>();

  before(async () => {
    server = net.createServer((socket) => {
      connections += 1;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as net.AddressInfo).port;
  });

  after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("control: a pass-through fetch monitor reaches the mocked transport", async () => {
    connections = 0;
    const result = await runChild(`
      let counted = 0;
      const realFetch = globalThis.fetch;
      globalThis.fetch = (...args) => { counted += 1; return realFetch(...args); };
      await fetch("http://127.0.0.1:${port}/").then((r) => r.text());
      log(JSON.stringify({ counted }));
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).counted, 1);
    assert.equal(connections, 1, "the removed monitor design lets the request reach the transport");
  });

  it("blocks every outbound channel before the transport and records the attempts", async () => {
    connections = 0;
    const result = await runChild(`
      const guard = unwrap(await import(${JSON.stringify(GUARD_URL)}));
      const http = await import("node:http");
      const https = await import("node:https");
      const tls = await import("node:tls");
      const dns = await import("node:dns");
      const net = await import("node:net");
      const outcomes = {};
      const attempt = async (name, fn) => {
        try { await fn(); outcomes[name] = "reached"; }
        catch (error) { outcomes[name] = error.name; }
      };
      const url = "http://127.0.0.1:${port}/secret-path?token=abc";
      await attempt("fetch", () => fetch(url, { method: "POST", body: "payload" }));
      await attempt("http.get", () => new Promise((resolve, reject) => {
        const req = http.default.get(url, resolve);
        req.on("error", reject);
      }));
      await attempt("https.request", () => new Promise((resolve, reject) => {
        const req = https.default.request("https://127.0.0.1:${port}/", resolve);
        req.on("error", reject);
        req.end();
      }));
      await attempt("net.connect", () => new Promise((resolve, reject) => {
        const socket = net.default.connect(${port}, "127.0.0.1", resolve);
        socket.on("error", reject);
      }));
      await attempt("tls.connect", () => new Promise((resolve, reject) => {
        const socket = tls.default.connect({ host: "127.0.0.1", port: ${port} }, resolve);
        socket.on("error", reject);
      }));
      await attempt("dns.lookup", () => new Promise((resolve, reject) => {
        dns.default.lookup("example.com", (error, address) => (error ? reject(error) : resolve(address)));
      }));
      await attempt("dns.promises.lookup", () => dns.default.promises.lookup("example.com"));
      log(JSON.stringify({
        outcomes,
        attempts: guard.precallEgressAttempts(),
        unexpected: guard.precallUnexpectedEgressAttempts().length,
      }));
    `);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim()) as {
      outcomes: Record<string, string>;
      attempts: Array<{ channel: string; host: string; method: string }>;
      unexpected: number;
    };
    for (const [name, outcome] of Object.entries(parsed.outcomes)) {
      assert.notEqual(outcome, "reached", `${name} reached a transport`);
    }
    assert.equal(parsed.outcomes.fetch, "PrecallEgressBlockedError");
    assert.equal(connections, 0, "no connection reached the mocked transport");
    assert.ok(parsed.attempts.length >= 7);
    assert.equal(parsed.unexpected, parsed.attempts.length);
    const fetchAttempt = parsed.attempts.find((attempt) => attempt.channel === "fetch");
    assert.equal(fetchAttempt?.host, "127.0.0.1");
    assert.equal(fetchAttempt?.method, "POST");
    assert.doesNotMatch(JSON.stringify(parsed.attempts), /secret-path|token=abc|payload/);
  });

  it("covers module initialization: credentials gone and init-time fetch blocked", async () => {
    connections = 0;
    const dir = mkdtempSync(path.join(tmpdir(), "precall-egress-test-"));
    const initModule = path.join(dir, "initEgress.mjs");
    writeFileSync(
      initModule,
      `export const keyAtInit = process.env.OPENROUTER_API_KEY ?? null;
export const turso = process.env.TURSO_DATABASE_URL ?? null;
await fetch("http://127.0.0.1:${port}/init").catch(() => undefined);
`
    );
    const result = await runChild(
      `
      const guard = unwrap(await import(${JSON.stringify(GUARD_URL)}));
      const mod = unwrap(await import(${JSON.stringify(pathToFileURL(initModule).href)}));
      log(JSON.stringify({
        keyAtInit: mod.keyAtInit,
        turso: mod.turso,
        dataDirRedirected: process.env.DATA_DIR === guard.precallTempDataDir,
        originalDataDir: guard.precallOriginalDataDir,
        attempts: guard.precallEgressAttempts().length,
      }));
    `,
      {
        OPENROUTER_API_KEY: "sk-test-not-a-real-key-0000",
        TURSO_DATABASE_URL: "libsql://example.invalid",
        DATA_DIR: "/data-should-not-be-used",
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.keyAtInit, null);
    assert.equal(parsed.turso, null);
    assert.equal(parsed.dataDirRedirected, true);
    assert.equal(parsed.originalDataDir, "/data-should-not-be-used");
    assert.equal(parsed.attempts, 1);
    assert.equal(connections, 0);
  });

  it("tolerates only the known blocked import-time exchange-rate GET", async () => {
    const result = await runChild(`
      const guard = unwrap(await import(${JSON.stringify(GUARD_URL)}));
      const fx = unwrap(await import("@/lib/exchangeRate"));
      await fx.getRealTimeExchangeRate();
      const afterKnown = guard.precallUnexpectedEgressAttempts().length;
      await fetch("https://open.er-api.com/v6/latest/USD", { method: "POST" }).catch(() => undefined);
      await fetch("https://example.invalid/v1/chat/completions", { method: "POST" }).catch(() => undefined);
      log(JSON.stringify({
        afterKnown,
        afterOthers: guard.precallUnexpectedEgressAttempts().length,
        total: guard.precallEgressAttempts().length,
        first: guard.precallEgressAttempts()[0],
      }));
    `);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.total, 3);
    assert.equal(parsed.afterKnown, 0);
    assert.equal(parsed.afterOthers, 2);
    assert.equal(parsed.first.host, "open.er-api.com");
    assert.equal(parsed.first.method, "GET");
  });

  it("mutes console output so nothing but the runner JSON can leave the process", async () => {
    const result = await runChild(`
      await import(${JSON.stringify(GUARD_URL)});
      console.log("raw-prompt-text");
      console.error("raw-prompt-text");
      console.warn("raw-prompt-text");
      process.stdout.write("final-json\\n");
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "final-json\n");
    assert.doesNotMatch(result.stderr, /raw-prompt-text/);
  });
});
