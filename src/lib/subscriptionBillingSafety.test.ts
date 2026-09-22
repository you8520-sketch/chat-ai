import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("subscription recurring-payment safety", () => {
  it("subscription owner contains no mock activation or renewal writer", () => {
    const text = source("src/lib/subscription.ts");

    assert.doesNotMatch(text, /creditPoints\s*\(/);
    assert.doesNotMatch(text, /sub_until\s*=/);
    assert.doesNotMatch(text, /notifyPaymentSuccess/);
    assert.doesNotMatch(text, /activateSubscription/);
    assert.doesNotMatch(text, /processDueRenewals/);

    assert.match(text, /sub_auto_renew=0/);
    assert.doesNotMatch(text, /UPDATE users SET sub_until/);
  });

  it("initial subscription endpoint fails closed without granting benefits", () => {
    const text = source("src/app/api/points/subscribe/route.ts");

    assert.match(text, /SUBSCRIPTION_BILLING_UNAVAILABLE_MESSAGE/);
    assert.match(text, /status:\s*503/);
    assert.doesNotMatch(text, /activateSubscription/);
    assert.doesNotMatch(text, /processDueRenewals/);
    assert.doesNotMatch(text, /creditPoints\s*\(/);
    assert.doesNotMatch(text, /notifyPaymentSuccess/);
  });

  it("renewal cron cannot mutate subscriptions before a real recurring-payment owner exists", () => {
    const text = source("src/app/api/cron/subscription-renew/route.ts");

    assert.match(text, /renewed:\s*0/);
    assert.match(text, /status:\s*503/);
    assert.doesNotMatch(text, /processDueRenewals/);
    assert.doesNotMatch(text, /creditPoints\s*\(/);
    assert.doesNotMatch(text, /notifyPaymentSuccess/);
  });

  it("points page is a read path and never triggers subscription renewal", () => {
    const text = source("src/app/points/page.tsx");

    assert.doesNotMatch(text, /processDueRenewals/);
    assert.doesNotMatch(text, /activateSubscription/);
  });
});
