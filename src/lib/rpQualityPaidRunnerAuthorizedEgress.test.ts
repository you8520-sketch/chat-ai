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
const AUTHORIZED_CLI = path.resolve("scripts/rp-quality-paid-runner-authorized.ts");

type ChildResult = { stdout: string; stderr: string; status: number | null };

const UNWRAP =
  "const log = console.log.bind(console);\nconst unwrap = (m) => (m.default && !m.precallEgressAttempts && !m.getRealTimeExchangeRate ? m.default : m);\n";

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

function runAuthorizedCli(extraArgs: string[] = []): Promise<ChildResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", AUTHORIZED_CLI, ...extraArgs],
      { encoding: "utf8", env: { ...process.env }, timeout: 60_000 },
      (error, stdout, stderr) => {
        const status = error ? ((error as { code?: unknown }).code as number | null) ?? null : 0;
        resolve({ stdout, stderr, status: typeof status === "number" ? status : null });
      }
    );
  });
}

describe("rp quality paid runner AUTHORIZED CLI egress", () => {
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

  it("AUTHORIZED CLI is prepare-only, live transport stays unshipped, unexpected egress is 0", async () => {
    const result = await runAuthorizedCli(["--user-cost-approved"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as {
      providerPosts: number;
      authorized: boolean;
      approvalStatus: string;
      liveTransport: string;
      denialReason: string | null;
      egress: {
        attemptsBlocked: number;
        unexpectedAttempts: number;
        transmitted: number | null;
        guard: string;
      };
    };
    assert.equal(report.authorized, false);
    assert.equal(report.approvalStatus, "NOT_APPROVED");
    assert.equal(report.providerPosts, 0);
    assert.equal(report.liveTransport, "LIVE_TRANSPORT_NOT_SHIPPED");
    assert.equal(report.egress.guard, "rpQualityPrecallEgressGuard");
    assert.equal(report.egress.unexpectedAttempts, 0);
    assert.equal(report.egress.transmitted, 0);
    assert.equal(typeof report.egress.attemptsBlocked, "number");
    assert.doesNotMatch(result.stdout, /sk-|Authorization|Bearer /);
  });

  it("import-time loopback fetch after the existing guard transmits 0 sockets", async () => {
    connections = 0;
    const dir = mkdtempSync(path.join(tmpdir(), "rpq-authorized-egress-"));
    const initModule = path.join(dir, "initEgress.mjs");
    writeFileSync(
      initModule,
      `export const keyAtInit = process.env.OPENROUTER_API_KEY ?? null;
await fetch("http://127.0.0.1:${port}/authorized-init").catch(() => undefined);
`
    );
    const result = await runChild(
      `
      const guard = unwrap(await import(${JSON.stringify(GUARD_URL)}));
      const mod = unwrap(await import(${JSON.stringify(pathToFileURL(initModule).href)}));
      const paid = unwrap(await import("@/lib/rpQualityPaidRunner"));
      log(JSON.stringify({
        keyAtInit: mod.keyAtInit,
        attemptsBlocked: guard.precallEgressAttempts().length,
        unexpected: guard.precallUnexpectedEgressAttempts().length,
        liveTransport: (() => {
          try { paid.createLivePaidRunnerTransport(); return "shipped"; }
          catch (error) { return error instanceof Error ? error.message : String(error); }
        })(),
      }));
    `,
      { OPENROUTER_API_KEY: "sk-test-not-a-real-key-0000" }
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim()) as {
      keyAtInit: string | null;
      attemptsBlocked: number;
      unexpected: number;
      liveTransport: string;
    };
    assert.equal(parsed.keyAtInit, null);
    assert.equal(parsed.attemptsBlocked >= 1, true);
    assert.equal(parsed.unexpected, parsed.attemptsBlocked);
    assert.equal(parsed.liveTransport, "LIVE_TRANSPORT_NOT_SHIPPED");
    assert.equal(connections, 0);
  });

  it("known blocked exchange-rate GET is tolerated; other egress is unexpected", async () => {
    connections = 0;
    const result = await runChild(`
      const guard = unwrap(await import(${JSON.stringify(GUARD_URL)}));
      const fx = unwrap(await import("@/lib/exchangeRate"));
      await fx.getRealTimeExchangeRate();
      const afterKnown = guard.precallUnexpectedEgressAttempts().length;
      await fetch("https://open.er-api.com/v6/latest/USD", { method: "POST" }).catch(() => undefined);
      await fetch("http://127.0.0.1:${port}/unexpected-post", { method: "POST" }).catch(() => undefined);
      log(JSON.stringify({
        afterKnown,
        unexpected: guard.precallUnexpectedEgressAttempts().length,
        total: guard.precallEgressAttempts().length,
        first: guard.precallEgressAttempts()[0],
      }));
    `);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim()) as {
      afterKnown: number;
      unexpected: number;
      total: number;
      first: { host: string; method: string };
    };
    assert.equal(parsed.afterKnown, 0);
    assert.equal(parsed.first.host, "open.er-api.com");
    assert.equal(parsed.first.method, "GET");
    assert.equal(parsed.total >= 3, true);
    assert.equal(parsed.unexpected, parsed.total - 1);
    assert.equal(connections, 0);
  });

  it("unexpected egress fails closed before any loopback connection", async () => {
    connections = 0;
    const result = await runChild(`
      const guard = unwrap(await import(${JSON.stringify(GUARD_URL)}));
      await fetch("http://127.0.0.1:${port}/fail-closed", { method: "POST" }).catch(() => undefined);
      const unexpected = guard.precallUnexpectedEgressAttempts();
      if (unexpected.length > 0) {
        log(JSON.stringify({
          ok: false,
          denialReason: "UNEXPECTED_EGRESS",
          providerPosts: 0,
          egress: {
            attemptsBlocked: guard.precallEgressAttempts().length,
            unexpectedAttempts: unexpected.length,
            transmitted: null,
          },
        }));
        process.exit(2);
      }
    `);
    assert.equal(result.status, 2);
    const parsed = JSON.parse(result.stdout.trim()) as {
      denialReason: string;
      providerPosts: number;
      egress: { transmitted: number | null; unexpectedAttempts: number };
    };
    assert.equal(parsed.denialReason, "UNEXPECTED_EGRESS");
    assert.equal(parsed.providerPosts, 0);
    assert.equal(parsed.egress.transmitted, null);
    assert.equal(parsed.egress.unexpectedAttempts >= 1, true);
    assert.equal(connections, 0);
  });
});
