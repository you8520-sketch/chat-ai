import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  canAccessAdultContent,
  effectiveIsAdult,
  isAdultVerificationSkipped,
  shouldHideAdultListings,
} from "./adultVerification";

const ENV_KEYS = [
  "SKIP_ADULT_VERIFICATION",
  "PORTONE_CHARGE_ENABLED",
  "NEXT_PUBLIC_PAYMENTS_ENABLED",
  "NEXT_PUBLIC_PORTONE_CHARGE_ENABLED",
  "ADMIN_EMAILS",
] as const;

const previous: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function snapshotEnv() {
  for (const key of ENV_KEYS) previous[key] = process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

function clearAccessEnv() {
  snapshotEnv();
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  restoreEnv();
});

describe("adult verification owners", () => {
  it("skip remains observable but does not grant stored verification", () => {
    clearAccessEnv();
    process.env.SKIP_ADULT_VERIFICATION = "1";
    process.env.NEXT_PUBLIC_PAYMENTS_ENABLED = "0";
    assert.equal(isAdultVerificationSkipped(), true);
    assert.equal(effectiveIsAdult(0), false);
    assert.equal(effectiveIsAdult(1), true);
    assert.equal(
      canAccessAdultContent({ email: "member@example.com", is_adult: 0, is_admin: 0 }),
      false
    );
  });

  it("admin beta access does not require or write is_adult", () => {
    clearAccessEnv();
    const admin = { email: "admin@example.com", is_adult: 0, is_admin: 1 as const };
    assert.equal(effectiveIsAdult(admin.is_adult), false);
    assert.equal(canAccessAdultContent(admin), true);
    assert.equal(shouldHideAdultListings({ ...admin, nsfw_on: 0 }), true);
    assert.equal(shouldHideAdultListings({ ...admin, nsfw_on: 1 }), false);
  });

  it("ADMIN_EMAILS grants the same beta access without is_admin column", () => {
    clearAccessEnv();
    process.env.ADMIN_EMAILS = "ops@hav.chat";
    assert.equal(
      canAccessAdultContent({ email: "ops@hav.chat", is_adult: 0, is_admin: 0 }),
      true
    );
    assert.equal(
      canAccessAdultContent({ email: "member@hav.chat", is_adult: 0, is_admin: 0 }),
      false
    );
  });

  it("guests and regular members cannot hide-disable the safety filter", () => {
    clearAccessEnv();
    assert.equal(shouldHideAdultListings(null), true);
    assert.equal(shouldHideAdultListings({ email: "a@b.c", is_adult: 0, is_admin: 0, nsfw_on: 1 }), true);
    assert.equal(shouldHideAdultListings({ email: "a@b.c", is_adult: 1, is_admin: 0, nsfw_on: 0 }), true);
    assert.equal(shouldHideAdultListings({ email: "a@b.c", is_adult: 1, is_admin: 0, nsfw_on: 1 }), false);
  });
});
