import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizeReturnPath } from "./safeReturnPath";

describe("sanitizeReturnPath", () => {
  test("keeps an in-app path", () => {
    assert.equal(sanitizeReturnPath("/chats", "/"), "/chats");
    assert.equal(sanitizeReturnPath("  /settings  ", "/"), "/settings");
  });

  test("falls back for external and protocol-relative targets", () => {
    assert.equal(sanitizeReturnPath("https://evil.example/phish", "/"), "/");
    assert.equal(sanitizeReturnPath("//evil.example/phish", "/"), "/");
    assert.equal(sanitizeReturnPath("http://evil.example/phish", "/"), "/");
  });

  test("falls back for empty, query, hash, and script targets", () => {
    assert.equal(sanitizeReturnPath("", "/"), "/");
    assert.equal(sanitizeReturnPath(null, "/"), "/");
    assert.equal(sanitizeReturnPath("/chats?next=1", "/"), "/");
    assert.equal(sanitizeReturnPath("/chats#part", "/"), "/");
    assert.equal(sanitizeReturnPath("javascript:alert(1)", "/"), "/");
  });
});
