import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GET, POST } from "./route";

describe("handoff audit export admin endpoint", () => {
  it("rejects GET even when enabled with a header token", async () => {
    const previousEnabled = process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
    const previousToken = process.env.ADMIN_DEBUG_TOKEN;
    process.env.HANDOFF_AUDIT_EXPORT_ENABLED = "1";
    process.env.ADMIN_DEBUG_TOKEN = "handoff-audit-secret";
    try {
      const res = await GET();
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("cache-control"), "no-store");
    } finally {
      if (previousEnabled == null) delete process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
      else process.env.HANDOFF_AUDIT_EXPORT_ENABLED = previousEnabled;
      if (previousToken == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previousToken;
    }
  });

  it("rejects when the exporter is default-off", async () => {
    const previousEnabled = process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
    const previousToken = process.env.ADMIN_DEBUG_TOKEN;
    delete process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
    process.env.ADMIN_DEBUG_TOKEN = "handoff-audit-secret";
    try {
      const res = await POST(
        new Request("https://example.test/api/admin/handoff-audit-export", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-admin-debug-token": "handoff-audit-secret",
          },
          body: JSON.stringify({ mode: "resolve-character", name: "플러드" }),
        })
      );
      assert.equal(res.status, 403);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, "handoff audit export denied");
    } finally {
      if (previousEnabled == null) delete process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
      else process.env.HANDOFF_AUDIT_EXPORT_ENABLED = previousEnabled;
      if (previousToken == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previousToken;
    }
  });

  it("rejects query-string tokens and requires a request header", async () => {
    const previousEnabled = process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
    const previousToken = process.env.ADMIN_DEBUG_TOKEN;
    process.env.HANDOFF_AUDIT_EXPORT_ENABLED = "1";
    process.env.ADMIN_DEBUG_TOKEN = "handoff-audit-secret";
    try {
      const queryRes = await POST(
        new Request(
          "https://example.test/api/admin/handoff-audit-export?ADMIN_DEBUG_TOKEN=handoff-audit-secret",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: "resolve-character", name: "플러드" }),
          }
        )
      );
      assert.equal(queryRes.status, 403);

      const headerRes = await POST(
        new Request("https://example.test/api/admin/handoff-audit-export", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-admin-debug-token": "handoff-audit-secret",
          },
          body: JSON.stringify({ mode: "resolve-character", name: "플러드" }),
        })
      );
      assert.equal(headerRes.status, 200);
      assert.equal(headerRes.headers.get("cache-control"), "no-store");
    } finally {
      if (previousEnabled == null) delete process.env.HANDOFF_AUDIT_EXPORT_ENABLED;
      else process.env.HANDOFF_AUDIT_EXPORT_ENABLED = previousEnabled;
      if (previousToken == null) delete process.env.ADMIN_DEBUG_TOKEN;
      else process.env.ADMIN_DEBUG_TOKEN = previousToken;
    }
  });
});
