import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessTrpg } from "./access";

describe("canAccessTrpg", () => {
  it("allows every signed-in user", () => {
    assert.equal(canAccessTrpg(null), false);
    assert.equal(canAccessTrpg(undefined), false);
    assert.equal(canAccessTrpg({ email: "user@example.com", is_admin: 0 }), true);
    assert.equal(canAccessTrpg({ email: "ops@example.com", is_admin: 1 }), true);
  });
});
