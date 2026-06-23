import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrimaryModelFlashFirewallBlock } from "@/lib/flashOwnedOutputFirewall";

/** @deprecated openRouterServerUiDelegation → flashOwnedOutputFirewall */
describe("openRouterServerUiDelegation (compat)", () => {
  it("delegates to primary flash firewall block", () => {
    const block = buildPrimaryModelFlashFirewallBlock();
    assert.match(block, /NOT YOUR JOB|FLASH-OWNED|SERVER GENERATED/);
    assert.match(block, /```html/);
  });
});
