import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  ALTERNATE_PUBLIC_HOST,
  CANONICAL_PUBLIC_ORIGIN,
  canonicalHostDecision,
  canonicalHostRedirect,
} = require("./canonicalHostIngress.js") as {
  ALTERNATE_PUBLIC_HOST: string;
  CANONICAL_PUBLIC_ORIGIN: string;
  canonicalHostDecision: (req: { url?: string; headers?: Record<string, string> }) => {
    action: "pass" | "redirect";
    status?: number;
    location?: string;
  };
  canonicalHostRedirect: (req: IncomingMessage, res: ServerResponse) => boolean;
};

const RAILWAY_HOST = ALTERNATE_PUBLIC_HOST;
const CANONICAL_HOST = "hav.chat";

type Probe = {
  status: number;
  location: string | undefined;
  setCookie: string[] | undefined;
  body: string;
};

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

test("Railway public hostname converges to hav.chat before the app issues cookies", async () => {
  const server = await listen();
  try {
    const root = await probe(server, {
      path: "/",
      headers: { host: RAILWAY_HOST },
    });
    assert.equal(root.status, 308);
    assert.equal(root.location, `${CANONICAL_PUBLIC_ORIGIN}/`);
    assert.equal(root.setCookie, undefined);
    assert.equal(root.body, "");

    const character = await probe(server, {
      path: "/character/123?foo=bar",
      headers: {
        host: "0.0.0.0:8080",
        "x-forwarded-host": RAILWAY_HOST,
        "x-forwarded-proto": "https",
      },
    });
    assert.equal(character.status, 308);
    assert.equal(character.location, `${CANONICAL_PUBLIC_ORIGIN}/character/123?foo=bar`);
    assert.equal(character.setCookie, undefined);

    const encoded = await probe(server, {
      path: "/character/123?foo=bar&next=%2Fchat%2F9",
      headers: { host: `Chat-AI-Production-4275.up.railway.app` },
    });
    assert.equal(encoded.status, 308);
    assert.equal(
      encoded.location,
      `${CANONICAL_PUBLIC_ORIGIN}/character/123?foo=bar&next=%2Fchat%2F9`,
    );

    const oauthStart = await probe(server, {
      method: "GET",
      path: "/api/auth/google?returnTo=%2Flogin&redirect=%2Fcharacter%2F123",
      headers: {
        host: "0.0.0.0:8080",
        "x-forwarded-host": `${RAILWAY_HOST}, proxy.internal`,
        "x-forwarded-proto": "https",
      },
    });
    assert.equal(oauthStart.status, 308);
    assert.equal(
      oauthStart.location,
      `${CANONICAL_PUBLIC_ORIGIN}/api/auth/google?returnTo=%2Flogin&redirect=%2Fcharacter%2F123`,
    );
    assert.equal(oauthStart.setCookie, undefined);
    assert.equal(oauthStart.body, "");

    const oauthPost = await probe(server, {
      method: "POST",
      path: "/api/auth/google?returnTo=%2Flogin",
      headers: { host: RAILWAY_HOST },
    });
    assert.equal(oauthPost.status, 308);
    assert.equal(oauthPost.location, `${CANONICAL_PUBLIC_ORIGIN}/api/auth/google?returnTo=%2Flogin`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("canonical hav.chat requests are not redirected", async () => {
  const server = await listen();
  try {
    const home = await probe(server, {
      path: "/",
      headers: { host: CANONICAL_HOST, "x-forwarded-host": CANONICAL_HOST, "x-forwarded-proto": "https" },
    });
    assert.equal(home.status, 200);
    assert.equal(home.location, undefined);
    assert.deepEqual(JSON.parse(home.body), { reachedApp: true });

    const character = await probe(server, {
      path: "/character/123?foo=bar",
      headers: { host: CANONICAL_HOST },
    });
    assert.equal(character.status, 200);
    assert.equal(character.location, undefined);

    const oauthStart = await probe(server, {
      path: "/api/auth/google?returnTo=%2Flogin",
      headers: {
        host: "0.0.0.0:8080",
        "x-forwarded-host": CANONICAL_HOST,
        "x-forwarded-proto": "https",
      },
    });
    assert.equal(oauthStart.status, 200);
    assert.equal(oauthStart.location, undefined);
    assert.ok(oauthStart.setCookie?.some((cookie) => cookie.startsWith("oauth_state=")));

    const forwardedCanonicalWins = await probe(server, {
      path: "/",
      headers: { host: RAILWAY_HOST, "x-forwarded-host": CANONICAL_HOST },
    });
    assert.equal(forwardedCanonicalWins.status, 200);
    assert.equal(forwardedCanonicalWins.location, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("/health stays on this process for Railway healthchecks and the public hostname", async () => {
  const server = await listen();
  try {
    const healthcheck = await probe(server, {
      path: "/health",
      headers: { host: "healthcheck.railway.app" },
    });
    assert.equal(healthcheck.status, 200);
    assert.equal(healthcheck.location, undefined);
    assert.deepEqual(JSON.parse(healthcheck.body), { status: "ok" });

    const publicHealth = await probe(server, {
      path: "/health",
      headers: { host: RAILWAY_HOST, "x-forwarded-proto": "https" },
    });
    assert.equal(publicHealth.status, 200);
    assert.equal(publicHealth.location, undefined);
    assert.deepEqual(JSON.parse(publicHealth.body), { status: "ok" });

    const canonicalHealth = await probe(server, {
      path: "/health",
      headers: { host: CANONICAL_HOST },
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
      headers: { host: RAILWAY_HOST },
    });
    assert.equal(healthz.status, 308);
    assert.equal(healthz.location, `${CANONICAL_PUBLIC_ORIGIN}/healthz`);

    const local = await probe(server, {
      path: "/",
      headers: { host: "localhost:3000" },
    });
    assert.equal(local.status, 200);
    assert.equal(local.location, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("alternate-host redirect cannot be steered to another origin", async () => {
  const server = await listen();
  try {
    const protocolRelative = await probe(server, {
      path: "//evil.example/phish",
      headers: { host: RAILWAY_HOST },
    });
    assert.equal(protocolRelative.status, 308);
    assert.equal(protocolRelative.location, `${CANONICAL_PUBLIC_ORIGIN}/`);

    const injected = canonicalHostDecision({
      url: "/\r\nLocation: https://evil.example",
      headers: { host: RAILWAY_HOST },
    });
    assert.equal(injected.action, "redirect");
    assert.equal(injected.status, 308);
    assert.equal(injected.location, `${CANONICAL_PUBLIC_ORIGIN}/`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
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
