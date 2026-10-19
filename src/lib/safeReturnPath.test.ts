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

  test("falls back when the URL parser would leave https://hav.chat", () => {
    const bypasses = [
      "/\\evil.example/phish",
      "/\t/evil.example/phish",
      "/\n/evil.example/phish",
      "/\r/evil.example/phish",
    ];
    for (const value of bypasses) {
      assert.notEqual(new URL(value, "https://hav.chat").origin, "https://hav.chat");
      assert.equal(sanitizeReturnPath(value, "/"), "/");
    }
    assert.equal(new URL("/chats", "https://hav.chat").origin, "https://hav.chat");
    assert.equal(sanitizeReturnPath("/chats", "/"), "/chats");
  });
});
