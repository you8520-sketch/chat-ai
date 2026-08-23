import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET } from "./route";

describe("admin chat-turn-forensics", () => {
  it("requires debug token in production mode", async () => {
    const previous = process.env.ADMIN_DEBUG_TOKEN;
    process.env.ADMIN_DEBUG_TOKEN = "forensic-secret";
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await GET(
        new Request("https://example.test/api/admin/chat-turn-forensics?chatId=707")
      );
      assert.equal(res.status, 403);
    } finally {
      if (previous == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previous;
      if (previousNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
