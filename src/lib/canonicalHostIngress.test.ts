import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getConfiguredPublicOrigin } from "./publicOrigin";

const require = createRequire(import.meta.url);
const {
  canonicalHostDecision,
  canonicalHostRedirect,
  isRailwayGeneratedPublicHost,
} = require("./canonicalHostIngress.js") as {
  canonicalHostDecision: (req: { url?: string; headers?: Record<string, string> }) => {
    action: "pass" | "redirect";
    status?: number;
    location?: string;
  };
  canonicalHostRedirect: (req: IncomingMessage, res: ServerResponse) => boolean;
  isRailwayGeneratedPublicHost: (hostname: string) => boolean;
};

const INGRESS_ENV_KEYS = ["GOOGLE_OAUTH_ORIGIN", "NEXTAUTH_URL", "APP_URL", "RAILWAY_PUBLIC_DOMAIN"] as const;
const FIXTURE_RAILWAY_HOST = "chat-ai-production-4275.up.railway.app";

type Probe = {
  status: number;
  location: string | undefined;
  setCookie: string[] | undefined;
  body: string;
};

function withIngressEnv(
  values: Partial<Record<(typeof INGRESS_ENV_KEYS)[number], string>>,
  run: () => Promise<void>,
) {
  const previous = Object.fromEntries(INGRESS_ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
    (typeof INGRESS_ENV_KEYS)[number],
    string | undefined
  >;
  for (const key of INGRESS_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const key of INGRESS_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function listen(): Promise<ReturnType<typeof createServer>> {
  const server = createServer((req, res) => {
    if (canonicalHostRedirect(req, res)) return;
    const pathOnly = (req.url ?? "/").split("?")[0];
    if (pathOnly === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": "oauth_state=issued-by-app; Path=/; HttpOnly; SameSite=Lax",
    });
    res.end(JSON.stringify({ reachedApp: true }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function probe(
  server: ReturnType<typeof createServer>,
  opts: { path: string; headers?: Record<string, string>; method?: string },
): Promise<Probe> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server is not listening");
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: opts.path,
        method: opts.method ?? "GET",
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            setCookie: res.headers["set-cookie"],
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe("canonical host ingress", { concurrency: 1 }, () => {
  test("Railway-generated hostname redirects even when RAILWAY_PUBLIC_DOMAIN is the customer domain", async () => {
    const server = await listen();
    try {
      await withIngressEnv(
        {
          NEXTAUTH_URL: "https://hav.chat",
          RAILWAY_PUBLIC_DOMAIN: "hav.chat",
        },
        async () => {
          const canonical = getConfiguredPublicOrigin();
          assert.equal(canonical, "https://hav.chat");

          const root = await probe(server, {
            path: "/",
            headers: { host: FIXTURE_RAILWAY_HOST },
          });
          assert.equal(root.status, 308);
          assert.equal(root.location, `${canonical}/`);
          assert.equal(root.setCookie, undefined);
          assert.equal(root.body, "");

          const oauthStart = await probe(server, {
            path: "/api/auth/google?returnTo=%2Flogin&redirect=%2Fcharacter%2F123",
            headers: {
              host: "0.0.0.0:8080",
              "x-forwarded-host": FIXTURE_RAILWAY_HOST,
              "x-forwarded-proto": "https",
            },
          });
          assert.equal(oauthStart.status, 308);
          assert.equal(
            oauthStart.location,
            `${canonical}/api/auth/google?returnTo=%2Flogin&redirect=%2Fcharacter%2F123`,
          );
          assert.equal(oauthStart.setCookie, undefined);

          const post = await probe(server, {
            method: "POST",
            path: "/api/auth/google?returnTo=%2Flogin",
            headers: { host: FIXTURE_RAILWAY_HOST },
          });
          assert.equal(post.status, 308);
          assert.equal(post.location, `${canonical}/api/auth/google?returnTo=%2Flogin`);
        },
      );
    } finally {
      await close(server);
    }
  });

  test("redirect target follows the canonical public-origin owner", async () => {
    const server = await listen();
    try {
      await withIngressEnv(
        {
          GOOGLE_OAUTH_ORIGIN: "https://canonical.example/ignored-path",
          NEXTAUTH_URL: "https://secondary.example",
          APP_URL: "https://third.example",
        },
        async () => {
          const canonical = getConfiguredPublicOrigin();
          assert.equal(canonical, "https://canonical.example");
          const response = await probe(server, {
            path: "/character/9?foo=bar",
            headers: { host: "generated-service.up.railway.app" },
          });
          assert.equal(response.status, 308);
          assert.equal(response.location, `${canonical}/character/9?foo=bar`);
          assert.equal(response.setCookie, undefined);
        },
      );
    } finally {
      await close(server);
    }
  });

  test("canonical, local, and non-Railway hosts are not redirected", async () => {
    const server = await listen();
    try {
      await withIngressEnv({ NEXTAUTH_URL: "https://hav.chat" }, async () => {
        for (const headers of [
          { host: "hav.chat", "x-forwarded-host": "hav.chat" },
          { host: "localhost:3000" },
          { host: "api.partner.example" },
          { host: "fake.up.railway.app.evil.example" },
        ]) {
          const response = await probe(server, { path: "/", headers });
          assert.equal(response.status, 200);
          assert.equal(response.location, undefined);
        }

        const forwardedCanonicalWins = await probe(server, {
          path: "/",
          headers: { host: FIXTURE_RAILWAY_HOST, "x-forwarded-host": "hav.chat" },
        });
        assert.equal(forwardedCanonicalWins.status, 200);
        assert.equal(forwardedCanonicalWins.location, undefined);
      });
    } finally {
      await close(server);
    }
  });

  test("/health stays on this process for Railway healthchecks and generated public hosts", async () => {
    const server = await listen();
    try {
      await withIngressEnv({ NEXTAUTH_URL: "https://hav.chat" }, async () => {
        for (const headers of [
          { host: "healthcheck.railway.app" },
          { host: FIXTURE_RAILWAY_HOST },
          { host: "hav.chat" },
        ]) {
          const response = await probe(server, { path: "/health?ready=1", headers });
          assert.equal(response.status, 200);
          assert.equal(response.location, undefined);
          assert.deepEqual(JSON.parse(response.body), { status: "ok" });
        }

        const healthz = await probe(server, {
          path: "/healthz",
          headers: { host: FIXTURE_RAILWAY_HOST },
        });
        assert.equal(healthz.status, 308);
        assert.equal(healthz.location, "https://hav.chat/healthz");
      });
    } finally {
      await close(server);
    }
  });

  test("Railway namespace matching is strict", () => {
    assert.equal(isRailwayGeneratedPublicHost("chat-ai-production-4275.up.railway.app"), true);
    assert.equal(isRailwayGeneratedPublicHost("x.up.railway.app"), true);
    assert.equal(isRailwayGeneratedPublicHost("up.railway.app"), false);
    assert.equal(isRailwayGeneratedPublicHost("x.up.railway.app.evil.example"), false);
    assert.equal(isRailwayGeneratedPublicHost("hav.chat"), false);
  });

  test("alternate-host redirect cannot be steered to another origin", async () => {
    const server = await listen();
    try {
      await withIngressEnv({ NEXTAUTH_URL: "https://hav.chat" }, async () => {
        const protocolRelative = await probe(server, {
          path: "//evil.example/phish",
          headers: { host: FIXTURE_RAILWAY_HOST },
        });
        assert.equal(protocolRelative.status, 308);
        assert.equal(protocolRelative.location, "https://hav.chat/");

        const injected = canonicalHostDecision({
          url: "/\r\nLocation: https://evil.example",
          headers: { host: FIXTURE_RAILWAY_HOST },
        });
        assert.equal(injected.action, "redirect");
        assert.equal(injected.status, 308);
        assert.equal(injected.location, "https://hav.chat/");
      });
    } finally {
      await close(server);
    }
  });

  test("Railway-generated hostname passes when no canonical origin is configured", async () => {
    const server = await listen();
    try {
      await withIngressEnv({}, async () => {
        assert.equal(getConfiguredPublicOrigin(), null);
        const response = await probe(server, {
          path: "/",
          headers: { host: FIXTURE_RAILWAY_HOST },
        });
        assert.equal(response.status, 200);
        assert.equal(response.location, undefined);
      });
    } finally {
      await close(server);
    }
  });

  test("server.js redirects before Next handles the request", () => {
    const serverJs = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../server.js"),
      "utf8",
    );
    const redirectAt = serverJs.indexOf("if (canonicalHostRedirect(req, res)) return;");
    const handleAt = serverJs.indexOf("handle(req, res, parsedUrl)");
    assert.ok(redirectAt !== -1);
    assert.ok(handleAt !== -1);
    assert.ok(redirectAt < handleAt);
  });
});
