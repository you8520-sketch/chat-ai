import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, sessionCookieOptions } from "./sessionCookie";

test("production session cookie stays host-only for 30 days", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const options = sessionCookieOptions();
    assert.equal(SESSION_COOKIE_NAME, "session");
    assert.equal(SESSION_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.secure, true);
    assert.equal(options.path, "/");
    assert.equal(options.maxAge, SESSION_MAX_AGE_SECONDS);
    assert.equal(Object.prototype.hasOwnProperty.call(options, "domain"), false);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
