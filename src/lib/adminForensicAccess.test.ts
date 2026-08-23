import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasValidAdminDebugToken } from "@/lib/adminForensicAccess";

describe("adminForensicAccess", () => {
  it("requires debug token in production mode", () => {
    const previous = process.env.ADMIN_DEBUG_TOKEN;
    process.env.ADMIN_DEBUG_TOKEN = "forensic-secret";
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const denied = hasValidAdminDebugToken(
        new Request("https://example.test/api/admin/chat-turn-forensics?chatId=707")
      );
      assert.equal(denied, false);

      const allowed = hasValidAdminDebugToken(
        new Request("https://example.test/api/admin/chat-turn-forensics?chatId=707", {
          headers: { Authorization: "Bearer forensic-secret" },
        })
      );
      assert.equal(allowed, true);
    } finally {
      if (previous == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previous;
      if (previousNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
