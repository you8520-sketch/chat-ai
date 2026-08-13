import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessTrpg } from "./access";

describe("canAccessTrpg", () => {
  it("allows DB admins and ADMIN_EMAILS only", () => {
    assert.equal(canAccessTrpg(null), false);
    assert.equal(canAccessTrpg({ email: "user@example.com", is_admin: 0 }), false);
    assert.equal(canAccessTrpg({ email: "ops@example.com", is_admin: 1 }), true);
  });

  it("allows ADMIN_EMAILS even without is_admin", () => {
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "gm@example.com";
    try {
      assert.equal(canAccessTrpg({ email: "gm@example.com", is_admin: 0 }), true);
      assert.equal(canAccessTrpg({ email: "other@example.com", is_admin: 0 }), false);
    } finally {
      if (prev == null) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prev;
    }
  });
});
