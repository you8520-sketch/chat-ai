import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertLengthSupplementApiAllowed,
  MAX_TURN_SUB_API_CALLS,
  NARRATIVE_LENGTH_CONTINUATION_ENABLED,
  SERVER_UNDER_LENGTH_RECOVERY_ENABLED,
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
  TurnApiBudget,
} from "@/lib/turnApiBudget";

describe("turn length supplement API — disabled for all models", () => {
  it("master switch and derived flags are off", () => {
    assert.equal(TURN_LENGTH_SUPPLEMENT_API_ENABLED, false);
    assert.equal(NARRATIVE_LENGTH_CONTINUATION_ENABLED, false);
    assert.equal(SERVER_UNDER_LENGTH_RECOVERY_ENABLED, false);
    assert.equal(MAX_TURN_SUB_API_CALLS, 0);
  });

  it("canSubCall is always false", () => {
    const budget = new TurnApiBudget();
    assert.equal(budget.canSubCall(), false);
    budget.beforeFetch("primary");
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
});
