import assert from "node:assert/strict";
import Module from "node:module";
import { after, describe, test } from "node:test";

const PUBLIC_ORIGIN_ENV_KEYS = [
  "GOOGLE_OAUTH_ORIGIN",
  "NEXTAUTH_URL",
  "APP_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

const cookieJar = new Map<string, string>();

// Node 22.14's test runner has no mock.module. Stub next/headers before the route loads.
const nodeModule = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = nodeModule._load;
nodeModule._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get(name: string) {
          const value = cookieJar.get(name);
          return value === undefined ? undefined : { value };
        },
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

type AuthResponse = {
  status: number;
  headers: Headers;
};

type GoogleStart = {
  GET: (req: Request) => Promise<AuthResponse>;
};

type GoogleCallback = {
  GET: (req: Request) => Promise<AuthResponse>;
};

function withAuthEnv(
  values: Partial<Record<(typeof PUBLIC_ORIGIN_ENV_KEYS)[number], string>>,
  run: () => Promise<void>,
) {
  const previous = Object.fromEntries(PUBLIC_ORIGIN_ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
    (typeof PUBLIC_ORIGIN_ENV_KEYS)[number],
    string | undefined
  >;
  for (const key of PUBLIC_ORIGIN_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const key of PUBLIC_ORIGIN_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function cookieHeaders(res: AuthResponse): string[] {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(res.headers);
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

after(() => {
  nodeModule._load = originalLoad;
});

describe("google oauth host fragmentation", { concurrency: 1 }, () => {
  test("hav.chat Google start still issues a host-only oauth_state cookie", async () => {
    const { GET } = (await import("../app/api/auth/google/route")) as GoogleStart;
    await withAuthEnv(
      {
        NEXTAUTH_URL: "https://hav.chat",
        GOOGLE_CLIENT_ID: "test-google-client",
        GOOGLE_CLIENT_SECRET: "test-google-secret",
      },
      async () => {
        const res = await GET(new Request("https://hav.chat/api/auth/google?returnTo=/login&redirect=/"));
        assert.equal(res.status, 307);
        const location = res.headers.get("location");
        assert.ok(location);
        const target = new URL(location);
        assert.equal(target.origin, "https://accounts.google.com");
        assert.equal(target.pathname, "/o/oauth2/v2/auth");
        assert.equal(target.searchParams.get("redirect_uri"), "https://hav.chat/api/auth/google/callback");
        const cookies = cookieHeaders(res);
        assert.ok(cookies.some((cookie) => cookie.startsWith("oauth_state=")));
        assert.ok(cookies.every((cookie) => !/domain=/i.test(cookie)));
        assert.equal(cookies.some((cookie) => cookie.startsWith("session=")), false);
      },
    );
  });

  test("Google callback still rejects a missing or mismatched oauth_state before token exchange", async () => {
    const { GET } = (await import("../app/api/auth/google/callback/route")) as GoogleCallback;
    const originalFetch = globalThis.fetch;
    const fetchUrls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchUrls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return new Response("no", { status: 400 });
    }) as typeof fetch;

    try {
      await withAuthEnv({ NEXTAUTH_URL: "https://hav.chat" }, async () => {
        cookieJar.clear();
        cookieJar.set("oauth_state", "expected-state");
        cookieJar.set("oauth_return_to", "/login");
        cookieJar.set("oauth_redirect_after", "/");

        const mismatched = await GET(
          new Request("https://hav.chat/api/auth/google/callback?code=auth-code&state=other-state"),
        );
        assert.equal(mismatched.status, 307);
        assert.equal(mismatched.headers.get("location"), "https://hav.chat/login?error=google_failed");
        assert.equal(cookieHeaders(mismatched).some((cookie) => cookie.startsWith("session=")), false);
        assert.deepEqual(fetchUrls, []);

        const missing = await GET(new Request("https://hav.chat/api/auth/google/callback?code=auth-code"));
        assert.equal(missing.headers.get("location"), "https://hav.chat/login?error=google_failed");
        assert.deepEqual(fetchUrls, []);

        cookieJar.delete("oauth_state");
        const unsaved = await GET(
          new Request("https://hav.chat/api/auth/google/callback?code=auth-code&state=expected-state"),
        );
        assert.equal(unsaved.headers.get("location"), "https://hav.chat/login?error=google_failed");
        assert.deepEqual(fetchUrls, []);

        cookieJar.set("oauth_state", "expected-state");
        const matched = await GET(
          new Request("https://hav.chat/api/auth/google/callback?code=auth-code&state=expected-state"),
        );
        assert.equal(matched.headers.get("location"), "https://hav.chat/login?error=google_failed");
        assert.deepEqual(fetchUrls, ["https://oauth2.googleapis.com/token"]);
        assert.equal(cookieHeaders(matched).some((cookie) => cookie.startsWith("session=")), false);
      });
    } finally {
      globalThis.fetch = originalFetch;
      cookieJar.clear();
    }
  });
});
