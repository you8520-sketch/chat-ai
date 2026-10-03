import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { isPaymentsEnabled, isPortOneChargeEnabled } from "@/lib/portoneConfig";
import { canAccessPortoneCheckout } from "@/lib/portoneReviewerAccount";

const ENV_KEYS = [
  "PORTONE_CHARGE_ENABLED",
  "NEXT_PUBLIC_PORTONE_STORE_ID",
  "NEXT_PUBLIC_PORTONE_CHANNEL_KEY",
  "PORTONE_API_SECRET",
] as const;

const previousEnv: Record<string, string | undefined> = {};

describe("portone member payment enablement", () => {
  before(() => {
    for (const key of ENV_KEYS) previousEnv[key] = process.env[key];
  });

  after(() => {
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  beforeEach(() => {
    delete process.env.PORTONE_CHARGE_ENABLED;
    delete process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
    delete process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;
    delete process.env.PORTONE_API_SECRET;
  });

  it("stays closed when the enable flag is missing, blank, off, or a typo", () => {
    const member = { account_kind: "standard" };
    process.env.PORTONE_API_SECRET = "secret_test";
    process.env.NEXT_PUBLIC_PORTONE_STORE_ID = "iamporttest_3";
    process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY = "channel-key-test";

    for (const flag of [undefined, "", "0", "typo", "yes", "on"]) {
      if (flag === undefined) delete process.env.PORTONE_CHARGE_ENABLED;
      else process.env.PORTONE_CHARGE_ENABLED = flag;
      assert.equal(isPaymentsEnabled(), false, `flag=${flag ?? "<unset>"}`);
      assert.equal(isPortOneChargeEnabled(), false, `flag=${flag ?? "<unset>"}`);
      assert.equal(canAccessPortoneCheckout(member), false, `flag=${flag ?? "<unset>"}`);
    }
  });

  it("opens ordinary-member charge only for explicit 1 or true plus browser and secret", () => {
    const member = { account_kind: "standard" };
    process.env.PORTONE_API_SECRET = "secret_test";
    process.env.NEXT_PUBLIC_PORTONE_STORE_ID = "iamporttest_3";
    process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY = "channel-key-test";

    process.env.PORTONE_CHARGE_ENABLED = "1";
    assert.equal(isPaymentsEnabled(), true);
    assert.equal(canAccessPortoneCheckout(member), true);

    process.env.PORTONE_CHARGE_ENABLED = "true";
    assert.equal(isPaymentsEnabled(), true);
    assert.equal(canAccessPortoneCheckout(member), true);

    delete process.env.PORTONE_API_SECRET;
    assert.equal(isPortOneChargeEnabled(), false);
    assert.equal(canAccessPortoneCheckout(member), false);
  });
});
