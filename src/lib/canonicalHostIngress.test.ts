import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { getConfiguredPublicOrigin } from "./publicOrigin";

const require = createRequire(import.meta.url);
const { canonicalHostDecision, canonicalHostRedirect } = require("./canonicalHostIngress.js") as {
  canonicalHostDecision: (req: { url?: string; headers?: Record<string, string> }) => {
    action: "pass" | "redirect";
    status?: number;
    location?: string;
  };
  canonicalHostRedirect: (req: IncomingMessage, res: ServerResponse) => boolean;
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
  test("injected Railway public domain redirects to the shared canonical origin", async () => {
    const server = await listen();
    try {
      await withIngressEnv(
        {
          NEXTAUTH_URL: "https://hav.chat",
          RAILWAY_PUBLIC_DOMAIN: FIXTURE_RAILWAY_HOST,
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

          const character = await probe(server, {
            path: "/character/123?foo=bar",
            headers: {
              host: "0.0.0.0:8080",
              "x-forwarded-host": FIXTURE_RAILWAY_HOST,
              "x-forwarded-proto": "https",
            },
          });
          assert.equal(character.status, 308);
          assert.equal(character.location, `${canonical}/character/123?foo=bar`);
          assert.equal(character.setCookie, undefined);

          const encoded = await probe(server, {
            path: "/character/123?foo=bar&next=%2Fchat%2F9",
            headers: { host: "Chat-AI-Production-4275.up.railway.app" },
          });
          assert.equal(encoded.status, 308);
          assert.equal(encoded.location, `${canonical}/character/123?foo=bar&next=%2Fchat%2F9`);

          const oauthStart = await probe(server, {
            method: "GET",
            path: "/api/auth/google?returnTo=%2Flogin&redirect=%2Fcharacter%2F123",
            headers: {
              host: "0.0.0.0:8080",
              "x-forwarded-host": `${FIXTURE_RAILWAY_HOST}, proxy.internal`,
              "x-forwarded-proto": "https",
            },
          });
          assert.equal(oauthStart.status, 308);
          assert.equal(
            oauthStart.location,
            `${canonical}/api/auth/google?returnTo=%2Flogin&redirect=%2Fcharacter%2F123`,
          );
          assert.equal(oauthStart.setCookie, undefined);
          assert.equal(oauthStart.body, "");

          const oauthPost = await probe(server, {
            method: "POST",
            path: "/api/auth/google?returnTo=%2Flogin",
            headers: { host: FIXTURE_RAILWAY_HOST },
          });
          assert.equal(oauthPost.status, 308);
          assert.equal(oauthPost.location, `${canonical}/api/auth/google?returnTo=%2Flogin`);
        },
      );
    } finally {
      await close(server);
    }
  });

  test("a replaced RAILWAY_PUBLIC_DOMAIN drops the previous hostname", async () => {
    const server = await listen();
    try {
      await withIngressEnv(
        {
          NEXTAUTH_URL: "https://hav.chat",
          RAILWAY_PUBLIC_DOMAIN: "replaced-public.example",
        },
        async () => {
          const previousLiteral = await probe(server, {
            path: "/",
            headers: { host: FIXTURE_RAILWAY_HOST },
          });
          assert.equal(previousLiteral.status, 200);
          assert.equal(previousLiteral.location, undefined);

          const replaced = await probe(server, {
            path: "/character/9?foo=bar",
            headers: { host: "replaced-public.example" },
          });
          assert.equal(replaced.status, 308);
          assert.equal(replaced.location, `${getConfiguredPublicOrigin()}/character/9?foo=bar`);
          assert.equal(replaced.setCookie, undefined);
        },
      );
    } finally {
      await close(server);
    }
  });

  test("ingress redirect target follows the canonical public-origin owner", async () => {
    const server = await listen();
    try {
      await withIngressEnv(
        {
          GOOGLE_OAUTH_ORIGIN: "https://canonical.example/ignored-path",
          NEXTAUTH_URL: "https://secondary.example",
          APP_URL: "https://third.example",
          RAILWAY_PUBLIC_DOMAIN: "edge.example",
        },
        async () => {
          const canonical = getConfiguredPublicOrigin();
          assert.equal(canonical, "https://canonical.example");
          const redirected = await probe(server, {
            path: "/api/auth/google?returnTo=%2Flogin",
            headers: { host: "edge.example" },
          });
          assert.equal(redirected.status, 308);
          assert.equal(redirected.location, `${canonical}/api/auth/google?returnTo=%2Flogin`);
          assert.equal(redirected.setCookie, undefined);
        },
      );
    } finally {
      await close(server);
    }
  });

  test("canonical host requests pass, and an empty Railway domain does not redirect", async () => {
    const server = await listen();
    try {
      await withIngressEnv(
        {
          NEXTAUTH_URL: "https://hav.chat",
          RAILWAY_PUBLIC_DOMAIN: FIXTURE_RAILWAY_HOST,
        },
        async () => {
          const home = await probe(server, {
            path: "/",
            headers: { host: "hav.chat", "x-forwarded-host": "hav.chat", "x-forwarded-proto": "https" },
          });
          assert.equal(home.status, 200);
          assert.equal(home.location, undefined);
          assert.deepEqual(JSON.parse(home.body), { reachedApp: true });

          const character = await probe(server, {
            path: "/character/123?foo=bar",
            headers: { host: "hav.chat" },
          });
          assert.equal(character.status, 200);
          assert.equal(character.location, undefined);

          const oauthStart = await probe(server, {
            path: "/api/auth/google?returnTo=%2Flogin",
            headers: {
              host: "0.0.0.0:8080",
              "x-forwarded-host": "hav.chat",
              "x-forwarded-proto": "https",
            },
          });
          assert.equal(oauthStart.status, 200);
          assert.equal(oauthStart.location, undefined);
          assert.ok(oauthStart.setCookie?.some((cookie) => cookie.startsWith("oauth_state=")));

          const forwardedCanonicalWins = await probe(server, {
            path: "/",
            headers: { host: FIXTURE_RAILWAY_HOST, "x-forwarded-host": "hav.chat" },
          });
          assert.equal(forwardedCanonicalWins.status, 200);
          assert.equal(forwardedCanonicalWins.location, undefined);
        },
      );

      await withIngressEnv({ NEXTAUTH_URL: "https://hav.chat" }, async () => {
        const unsetRailway = await probe(server, {
          path: "/",
          headers: { host: FIXTURE_RAILWAY_HOST },
        });
        assert.equal(unsetRailway.status, 200);
        assert.equal(unsetRailway.location, undefined);

        const local = await probe(server, {
          path: "/",
          headers: { host: "localhost:3000" },
        });
        assert.equal(local.status, 200);
        assert.equal(local.location, undefined);
      });
    } finally {
      await close(server);
    }
  });

  test("/health stays on this process for Railway healthchecks and the public hostname", async () => {
    const server = await listen();
    try {
      await withIngressEnv(
        {
          NEXTAUTH_URL: "https://hav.chat",
          RAILWAY_PUBLIC_DOMAIN: FIXTURE_RAILWAY_HOST,
        },
        async () => {
          const healthcheck = await probe(server, {
            path: "/health",
            headers: { host: "healthcheck.railway.app" },
          });
          assert.equal(healthcheck.status, 200);
          assert.equal(healthcheck.location, undefined);
          assert.deepEqual(JSON.parse(healthcheck.body), { status: "ok" });

          const publicHealth = await probe(server, {
            path: "/health",
            headers: { host: FIXTURE_RAILWAY_HOST, "x-forwarded-proto": "https" },
          });
          assert.equal(publicHealth.status, 200);
          assert.equal(publicHealth.location, undefined);
          assert.deepEqual(JSON.parse(publicHealth.body), { status: "ok" });

          const canonicalHealth = await probe(server, {
            path: "/health",
            headers: { host: "hav.chat" },
          });
          assert.equal(canonicalHealth.status, 200);
          assert.deepEqual(JSON.parse(canonicalHealth.body), { status: "ok" });

          const healthQuery = await probe(server, {
            path: "/health?ready=1",
            headers: { host: "healthcheck.railway.app" },
          });
          assert.equal(healthQuery.status, 200);
          assert.equal(healthQuery.location, undefined);

          const healthz = await probe(server, {
            path: "/healthz",
            headers: { host: FIXTURE_RAILWAY_HOST },
          });
          assert.equal(healthz.status, 308);
          assert.equal(healthz.location, `${getConfiguredPublicOrigin()}/healthz`);
        },
      );
    } finally {
      await close(server);
    }
  });

  test("alternate-host redirect cannot be steered to another origin", async () => {
    const server = await listen();
    try {
      await withIngressEnv(
        {
          NEXTAUTH_URL: "https://hav.chat",
          RAILWAY_PUBLIC_DOMAIN: FIXTURE_RAILWAY_HOST,
        },
        async () => {
          const canonical = getConfiguredPublicOrigin();
          const protocolRelative = await probe(server, {
            path: "//evil.example/phish",
            headers: { host: FIXTURE_RAILWAY_HOST },
          });
          assert.equal(protocolRelative.status, 308);
          assert.equal(protocolRelative.location, `${canonical}/`);

          const injected = canonicalHostDecision({
            url: "/\r\nLocation: https://evil.example",
            headers: { host: FIXTURE_RAILWAY_HOST },
          });
          assert.equal(injected.action, "redirect");
          assert.equal(injected.status, 308);
          assert.equal(injected.location, `${canonical}/`);
        },
      );
    } finally {
      await close(server);
    }
  });

  test("a Railway domain without a configured public origin does not invent a target", async () => {
    const server = await listen();
    try {
      await withIngressEnv({ RAILWAY_PUBLIC_DOMAIN: FIXTURE_RAILWAY_HOST }, async () => {
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
