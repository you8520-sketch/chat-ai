import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canShowFullBillingReceipt } from "@/lib/billingReceiptAccess";
import { DEMO_USER_EMAIL } from "@/lib/demo";

describe("canShowFullBillingReceipt", () => {
  it("allows demo user email", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: DEMO_USER_EMAIL, is_admin: 0 }),
      true
    );
  });

  it("allows admin flag", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: "user@example.com", is_admin: 1 }),
      true
    );
  });

  it("denies regular users", () => {
    assert.equal(
      canShowFullBillingReceipt({ email: "user@example.com", is_admin: 0 }),
      false
    );
  });
});
