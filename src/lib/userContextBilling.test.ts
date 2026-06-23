import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { userContextSurcharge } from "@/lib/userContextBilling";

describe("userContextSurcharge", () => {
  it("always returns 0 (surcharge removed)", () => {
    assert.equal(userContextSurcharge(0), 0);
    assert.equal(userContextSurcharge(500), 0);
    assert.equal(userContextSurcharge(5000), 0);
    assert.equal(userContextSurcharge(10000), 0);
  });
});
