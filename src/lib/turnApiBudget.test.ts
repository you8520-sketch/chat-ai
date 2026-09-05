import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertLengthSupplementApiAllowed,
  MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
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
    assert.equal(RP_META_LEAK_REGEN_API_ENABLED, false);
    assert.equal(MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN, 1);
    assert.equal(MAX_TURN_SUB_API_CALLS, 0);
  });

  it("allows the primary fetch and rejects every second-call escape hatch", () => {
    const budget = new TurnApiBudget();
    assert.equal(budget.canSubCall(), true);
    assert.doesNotThrow(() => budget.beforeFetch("cheaperinference-primary-stream"));
    assert.equal(budget.canSubCall(), false);

    for (const requestKind of [
      "ordinary-second-main-rp",
      "adult-general-refusal-fallback",
      "adult-hard-failure-fallback",
      "rp-meta-leak-regen",
      "server-under-length-recovery",
      "narrative-length-continuation",
      "truncation-recovery",
    ]) {
      assert.throws(
        () => budget.beforeFetch(requestKind),
        /Main RP provider call budget exceeded/
      );
    }
    assert.equal(budget.fetchCountSnapshot, 1);
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

  it("rejects model-failure fallbacks after the primary fetch", () => {
    const budget = new TurnApiBudget();
    budget.beforeFetch("cheaperinference-primary-stream");
    assert.throws(
      () => budget.beforeFetch("adult-hard-failure-fallback"),
      /Main RP provider call budget exceeded/
    );
    assert.throws(
      () => budget.beforeFetch("adult-general-refusal-fallback"),
      /Main RP provider call budget exceeded/
    );
  });

  it("rejects length recovery and continuation after the primary fetch", () => {
    const budget = new TurnApiBudget();
    budget.beforeFetch("cheaperinference-primary-stream");
    assert.throws(
      () => budget.beforeFetch("server-under-length-recovery"),
      /Main RP provider call budget exceeded/
    );
    assert.throws(
      () => budget.beforeFetch("narrative-length-continuation"),
      /Main RP provider call budget exceeded/
    );
    assert.throws(
      () => budget.beforeFetch("truncation-recovery"),
      /Main RP provider call budget exceeded/
    );
  });
});
