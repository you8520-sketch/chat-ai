import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET } from "./route";

describe("GET /api/admin/forensic-readonly", () => {
  it("rejects missing debug token in production", async () => {
    const previousToken = process.env.ADMIN_DEBUG_TOKEN;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.ADMIN_DEBUG_TOKEN = "forensic-secret";
    process.env.NODE_ENV = "production";
    try {
      const res = await GET(
        new Request("https://example.test/api/admin/forensic-readonly?messageId=3750")
      );
      assert.equal(res.status, 403);
    } finally {
      if (previousToken == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previousToken;
      if (previousNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
