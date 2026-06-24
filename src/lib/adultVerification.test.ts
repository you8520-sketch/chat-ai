import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isAdultVerificationSkipped } from "./adultVerification";

describe("isAdultVerificationSkipped", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.SKIP_ADULT_VERIFICATION;
    delete process.env.PORTONE_CHARGE_ENABLED;
    delete process.env.NEXT_PUBLIC_PAYMENTS_ENABLED;
    delete process.env.NEXT_PUBLIC_PORTONE_CHARGE_ENABLED;
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns true when SKIP_ADULT_VERIFICATION=1", () => {
    process.env.SKIP_ADULT_VERIFICATION = "1";
    expect(isAdultVerificationSkipped()).toBe(true);
  });

  it("returns false when SKIP_ADULT_VERIFICATION=0 even if payments disabled", () => {
    process.env.SKIP_ADULT_VERIFICATION = "0";
    process.env.PORTONE_CHARGE_ENABLED = "0";
    expect(isAdultVerificationSkipped()).toBe(false);
  });

  it("returns true when NEXT_PUBLIC_PAYMENTS_ENABLED=0", () => {
    process.env.NEXT_PUBLIC_PAYMENTS_ENABLED = "0";
    expect(isAdultVerificationSkipped()).toBe(true);
  });

  it("returns true when PORTONE_CHARGE_ENABLED=0", () => {
    process.env.PORTONE_CHARGE_ENABLED = "0";
    expect(isAdultVerificationSkipped()).toBe(true);
  });

  it("returns false when payment env unset", () => {
    expect(isAdultVerificationSkipped()).toBe(false);
  });
});
