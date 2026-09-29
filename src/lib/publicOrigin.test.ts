import assert from "node:assert/strict";
import test from "node:test";
import {
  googleOAuthCallbackUrl,
  getConfiguredPublicOrigin,
  isBrowserOriginAllowed,
  resolvePublicOrigin,
} from "./publicOrigin";

const PUBLIC_ORIGIN_ENV_KEYS = ["GOOGLE_OAUTH_ORIGIN", "NEXTAUTH_URL", "APP_URL"] as const;

function withPublicOriginEnv(
  values: Partial<Record<(typeof PUBLIC_ORIGIN_ENV_KEYS)[number], string>>,
  run: () => void,
) {
  const previous = Object.fromEntries(
    PUBLIC_ORIGIN_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof PUBLIC_ORIGIN_ENV_KEYS)[number], string | undefined>;
  for (const key of PUBLIC_ORIGIN_ENV_KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const key of PUBLIC_ORIGIN_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("allows a Railway public Origin when the request URL is an internal bind address", () => {
  const req = new Request("http://0.0.0.0:8080/api/push", {
    method: "PATCH",
    headers: {
      origin: "https://chat-ai-production-3e84.up.railway.app",
      host: "0.0.0.0:8080",
      "x-forwarded-host": "chat-ai-production-3e84.up.railway.app",
      "x-forwarded-proto": "https",
    },
  });
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    withPublicOriginEnv({}, () => {
      assert.equal(resolvePublicOrigin(req), "https://chat-ai-production-3e84.up.railway.app");
      assert.equal(isBrowserOriginAllowed(req), true);
    });
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("allows iOS WKWebView opaque Origin: null", () => {
  const req = new Request("http://0.0.0.0:8080/api/push", {
    method: "POST",
    headers: {
      origin: "null",
      "x-forwarded-host": "chat-ai-production-3e84.up.railway.app",
      "x-forwarded-proto": "https",
    },
  });
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    withPublicOriginEnv({}, () => assert.equal(isBrowserOriginAllowed(req), true));
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("rejects a foreign Origin even when forwarded host is present", () => {
  const req = new Request("http://0.0.0.0:8080/api/push", {
    method: "PATCH",
    headers: {
      origin: "https://evil.example",
      "x-forwarded-host": "chat-ai-production-3e84.up.railway.app",
      "x-forwarded-proto": "https",
    },
  });
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    withPublicOriginEnv({}, () => assert.equal(isBrowserOriginAllowed(req), false));
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("NEXTAUTH_URL stays canonical when Railway supplies a forwarded host", () => {
  const req = new Request("http://0.0.0.0:8080/api/auth/google/callback", {
    headers: {
      host: "0.0.0.0:8080",
      "x-forwarded-host": "chat-ai-production-4275.up.railway.app",
      "x-forwarded-proto": "https",
    },
  });
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    withPublicOriginEnv({ NEXTAUTH_URL: "https://hav.chat" }, () => {
      assert.equal(getConfiguredPublicOrigin(), "https://hav.chat");
      assert.equal(resolvePublicOrigin(req), "https://hav.chat");
      assert.equal(
        googleOAuthCallbackUrl(resolvePublicOrigin(req)),
        "https://hav.chat/api/auth/google/callback",
      );
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
