import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USER_NOTE_FOCUS_MAX, USER_NOTE_MAX } from "@/lib/persona";
import { userContextSurcharge } from "@/lib/userContextBilling";

describe("userContextSurcharge", () => {
  it("is zero when note is empty or within focus zone", () => {
    assert.equal(userContextSurcharge(0), 0);
    assert.equal(userContextSurcharge(500), 0);
    assert.equal(userContextSurcharge(USER_NOTE_FOCUS_MAX), 0);
  });

  it("ramps linearly from 0.1% to 10% between focus max and note max", () => {
    const mid = USER_NOTE_FOCUS_MAX + (USER_NOTE_MAX - USER_NOTE_FOCUS_MAX) / 2;
    const midSurcharge = userContextSurcharge(mid);
    assert.ok(midSurcharge > 0.04 && midSurcharge < 0.06);
    assert.equal(userContextSurcharge(USER_NOTE_MAX), 0.1);
  });
});
