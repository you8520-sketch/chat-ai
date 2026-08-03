import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertLengthSupplementApiAllowed,
  MAX_TURN_SUB_API_CALLS,
  NARRATIVE_LENGTH_CONTINUATION_ENABLED,
  RP_META_LEAK_REGEN_API_ENABLED,
  SERVER_UNDER_LENGTH_RECOVERY_ENABLED,
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
  TurnApiBudget,
} from "@/lib/turnApiBudget";

describe("turn length supplement API — disabled for all models", () => {
  it("master switch and derived flags are off", () => {
    assert.equal(TURN_LENGTH_SUPPLEMENT_API_ENABLED, false);
    assert.equal(NARRATIVE_LENGTH_CONTINUATION_ENABLED, false);
    assert.equal(SERVER_UNDER_LENGTH_RECOVERY_ENABLED, false);
    assert.equal(RP_META_LEAK_REGEN_API_ENABLED, true);
    assert.equal(MAX_TURN_SUB_API_CALLS, 1);
  });

  it("canSubCall allows one meta-leak regen slot when supplements off", () => {
    const budget = new TurnApiBudget();
    assert.equal(budget.canSubCall(), true);
    budget.beforeFetch("primary");
    assert.equal(budget.canSubCall(), true);
    budget.beforeFetch("rp-meta-leak-regen");
    assert.equal(budget.canSubCall(), false);
  });

  it("assertLengthSupplementApiAllowed rejects supplement request kinds", () => {
    assert.throws(
      () => assertLengthSupplementApiAllowed("narrative-length-continuation"),
      /Length supplement API disabled/
    );
    assert.throws(
      () => assertLengthSupplementApiAllowed("server-under-length-recovery"),
      /Length supplement API disabled/
    );
    assert.doesNotThrow(() => assertLengthSupplementApiAllowed("openrouter-primary-stream"));
  });

  it("allows exactly one hard-failure fallback without enabling length supplements", () => {
    const budget = new TurnApiBudget();
    budget.beforeFetch("cheaperinference-primary-stream");
    assert.doesNotThrow(() =>
      budget.beforeFetch("adult-aion-hard-failure-fallback")
    );
    assert.throws(
      () => budget.beforeFetch("adult-aion-hard-failure-fallback"),
      /Max internal API calls exceeded/
    );
    assert.equal(budget.canSubCall(), false);
  });

  it("does not treat under-length output as an allowed fallback sub-call", () => {
    const budget = new TurnApiBudget();
    budget.beforeFetch("cheaperinference-primary-stream");
    assert.throws(
      () => budget.beforeFetch("server-under-length-recovery"),
      /Max internal API calls exceeded/
    );
  });
});
