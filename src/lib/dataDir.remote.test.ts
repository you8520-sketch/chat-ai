import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getRemoteDatabaseConfig, remoteDatabaseDiagnostics } from "./dataDir.ts";

const previousUrl = process.env.TURSO_DATABASE_URL;
const previousToken = process.env.TURSO_AUTH_TOKEN;

afterEach(() => {
  if (previousUrl == null) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = previousUrl;
  if (previousToken == null) delete process.env.TURSO_AUTH_TOKEN;
  else process.env.TURSO_AUTH_TOKEN = previousToken;
});

describe("remote database configuration", () => {
  it("uses local storage when Turso is not configured", () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    assert.equal(getRemoteDatabaseConfig(), null);
  });

  it("requires the URL and token as a pair", () => {
    process.env.TURSO_DATABASE_URL = "libsql://chat-ai.example.turso.io";
    delete process.env.TURSO_AUTH_TOKEN;
    assert.throws(() => getRemoteDatabaseConfig(), /must be configured together/);
  });

  it("returns a remote config without exposing the token in diagnostics", () => {
    process.env.TURSO_DATABASE_URL = "libsql://chat-ai.example.turso.io";
    process.env.TURSO_AUTH_TOKEN = "top-secret-token";
    const config = getRemoteDatabaseConfig();
    assert.deepEqual(config, {
      url: "libsql://chat-ai.example.turso.io",
      authToken: "top-secret-token",
    });
    const diagnostics = remoteDatabaseDiagnostics(config!);
    assert.equal(diagnostics.backend, "turso");
    assert.equal(diagnostics.host, "chat-ai.example.turso.io");
    assert.equal(JSON.stringify(diagnostics).includes("top-secret-token"), false);
  });
});
