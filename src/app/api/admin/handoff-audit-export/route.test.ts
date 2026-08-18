import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET } from "./route";

describe("handoff audit export admin endpoint", () => {
  it("rejects when the exporter is default-off", async () => {
    const previousEnabled = process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
    const previousToken = process.env.ADMIN_DEBUG_TOKEN;
    delete process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
    process.env.ADMIN_DEBUG_TOKEN = "handoff-audit-secret";
    try {
      const res = await GET(
        new Request("https://example.test/api/admin/handoff-audit-export?mode=resolve-character&name=플러드", {
          headers: { "x-admin-debug-token": "handoff-audit-secret" },
        })
      );
      assert.equal(res.status, 403);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, "handoff audit export denied");
    } finally {
      if (previousEnabled == null) delete process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
      else process.env.HANDOFF_AUDIT_EXPORT_ENABLED = previousEnabled;
      if (previousToken == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previousToken;
    }
  });

  it("rejects enabled requests without the admin debug token", async () => {
    const previousEnabled = process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
    const previousToken = process.env.ADMIN_DEBUG_TOKEN;
    process.env.HANDOFF_AUDIT_EXPORT_ENABLED = "1";
    process.env.ADMIN_DEBUG_TOKEN = "handoff-audit-secret";
    try {
      const res = await GET(
        new Request("https://example.test/api/admin/handoff-audit-export?mode=resolve-character&name=플러드")
      );
      assert.equal(res.status, 403);
    } finally {
      if (previousEnabled == null) delete process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
      else process.env.HANDOFF_AUDIT_EXPORT_ENABLED = previousEnabled;
      if (previousToken == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previousToken;
    }
  });
});
