import assert from "node:assert/strict";
import test from "node:test";
import { isBrowserOriginAllowed, resolvePublicOrigin } from "./publicOrigin";

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
    assert.equal(resolvePublicOrigin(req), "https://chat-ai-production-3e84.up.railway.app");
    assert.equal(isBrowserOriginAllowed(req), true);
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
    assert.equal(isBrowserOriginAllowed(req), true);
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
    assert.equal(isBrowserOriginAllowed(req), false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
