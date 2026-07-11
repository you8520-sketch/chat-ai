import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "./route";

describe("status widget diagnostics admin endpoint", () => {
  it("rejects requests without the configured admin debug token before DB access", async () => {
    const previous = process.env.ADMIN_DEBUG_TOKEN;
    process.env.ADMIN_DEBUG_TOKEN = "diagnostic-secret";
    try {
      const res = await GET(
        new Request("https://example.test/api/admin/status-widget-diagnostics?messageId=msg-112")
      );
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, "admin diagnostics access denied");
    } finally {
      if (previous == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previous;
    }
  });
});
