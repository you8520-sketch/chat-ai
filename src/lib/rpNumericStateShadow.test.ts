import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ServerMeterNumericStateDefinitionV1,
  StatusWidget,
} from "@/lib/statusWidget/types";
import {
  aggregateNumericShadowObservations,
  classifyNumericProposalFormat,
  observeNumericShadow,
  tryObserveNumericShadowForTurn,
} from "@/lib/rpNumericState/shadowObserver";
import {
  listShadowEligibleNumericFields,
  parsePositiveIntAllowlist,
  resolveNumericShadowEligibility,
} from "@/lib/rpNumericState/shadowPolicy";

const def: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 0,
  integer: true,
  maxIncreasePerTurn: 5,
  maxDecreasePerTurn: 5,
};

function widgetWithNumeric(
  fields: Array<{
    id: string;
    label?: string;
    numericState?: ServerMeterNumericStateDefinitionV1 | null;
  }>
): StatusWidget {
  return {
    version: 1,
    name: "pilot",
    htmlTemplate: "",
    placement: "bottom",
    fields: fields.map((f) => ({
      id: f.id,
      label: f.label ?? f.id,
      instruction: "x",
      ...(f.numericState ? { numericState: f.numericState } : {}),
    })),
  };
}

const pilotWidget = widgetWithNumeric([
  { id: "affection", numericState: def },
  { id: "trust", numericState: { ...def, initial: 10 } },
  { id: "corruption", numericState: { ...def, initial: 0 } },
]);

describe("Phase B1-B — shadow eligibility (SH1-SH8)", () => {
  it("SH1 flag OFF → not eligible", () => {
    const r = resolveNumericShadowEligibility({
      userId: 1,
      env: {
        RP_NUMERIC_STATE_SHADOW_ENABLED: "0",
        RP_NUMERIC_STATE_SHADOW_USER_IDS: "1",
      },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "flag_off");
  });

  it("SH2 enabled + empty user allowlist → OFF", () => {
    const r = resolveNumericShadowEligibility({
      userId: 1,
      env: {
        RP_NUMERIC_STATE_SHADOW_ENABLED: "1",
        RP_NUMERIC_STATE_SHADOW_USER_IDS: "",
      },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "empty_user_allowlist");
  });

  it("SH2b invalid allowlist tokens ignored → empty → OFF", () => {
    assert.deepEqual(parsePositiveIntAllowlist("abc,1.2,-1,0"), []);
    const r = resolveNumericShadowEligibility({
      userId: 1,
      env: {
        RP_NUMERIC_STATE_SHADOW_ENABLED: "true",
        RP_NUMERIC_STATE_SHADOW_USER_IDS: "abc,0,-1,1.2",
      },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "empty_user_allowlist");
  });

  it("SH3 allowlisted user → eligible", () => {
    const r = resolveNumericShadowEligibility({
      userId: 9,
      characterId: 6,
      env: {
        RP_NUMERIC_STATE_SHADOW_ENABLED: "1",
        RP_NUMERIC_STATE_SHADOW_USER_IDS: "9,12",
      },
    });
    assert.equal(r.eligible, true);
  });

  it("SH4 non-allowlisted user → OFF", () => {
    const r = resolveNumericShadowEligibility({
      userId: 3,
      env: {
        RP_NUMERIC_STATE_SHADOW_ENABLED: "1",
        RP_NUMERIC_STATE_SHADOW_USER_IDS: "9",
      },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "user_not_allowlisted");
  });

  it("SH5 character allowlist mismatch → OFF", () => {
    const r = resolveNumericShadowEligibility({
      userId: 9,
      characterId: 99,
      env: {
        RP_NUMERIC_STATE_SHADOW_ENABLED: "1",
        RP_NUMERIC_STATE_SHADOW_USER_IDS: "9",
        RP_NUMERIC_STATE_SHADOW_CHARACTER_IDS: "6",
      },
    });
    assert.equal(r.eligible, false);
    assert.equal(r.reason, "character_not_allowlisted");
  });

  it("SH6 field without numericState → skipped", () => {
    const fields = listShadowEligibleNumericFields(
      widgetWithNumeric([{ id: "affection" }])
    );
    assert.equal(fields.length, 0);
  });

  it("SH7 invalid numericState → skipped", () => {
    const fields = listShadowEligibleNumericFields(
      widgetWithNumeric([
        {
          id: "affection",
          numericState: {
            version: 1,
            mode: "server_meter",
            min: 80,
            max: 20,
            initial: 40,
            integer: true,
          },
        },
      ])
    );
    assert.equal(fields.length, 0);
  });

  it("SH8 non-pilot state key → skipped", () => {
    const fields = listShadowEligibleNumericFields(
      widgetWithNumeric([{ id: "d_day", numericState: def }])
    );
    assert.equal(fields.length, 0);
  });
});

describe("Phase B1-B — normal / regen baseline (SB/SR)", () => {
  it("SB1 previous 40 proposal 43 → before 40 APPLIED", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterId: 6,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      previousCharacterValues: { affection: "40" },
      currentCharacterValues: { affection: "43" },
    });
    assert.equal(obs.length, 1);
    assert.equal(obs[0]!.baselineSource, "previous_status");
    assert.equal(obs[0]!.beforeValue, 40);
    assert.equal(obs[0]!.parsedProposal, 43);
    assert.equal(obs[0]!.hypotheticalAfter, 43);
    assert.equal(obs[0]!.outcome, "APPLIED");
  });

  it("SB2 no previous → definition.initial", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([
        { id: "affection", numericState: { ...def, initial: 12 } },
      ]),
      previousCharacterValues: null,
      currentCharacterValues: { affection: "14" },
    });
    assert.equal(obs[0]!.baselineSource, "definition_initial");
    assert.equal(obs[0]!.beforeValue, 12);
    assert.equal(obs[0]!.hypotheticalAfter, 14);
  });

  it("SB3 previous invalid → BASELINE_INVALID_SKIP", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      previousCharacterValues: { affection: "약 40" },
      currentCharacterValues: { affection: "43" },
    });
    assert.equal(obs[0]!.outcome, "BASELINE_INVALID_SKIP");
    assert.equal(obs[0]!.baselineSource, "invalid_previous");
    assert.equal(obs[0]!.beforeValue, null);
    assert.equal(obs[0]!.hypotheticalAfter, null);
  });

  it("SB4 previous percent 40% on 0..100 → before 40", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      previousCharacterValues: { affection: "40%" },
      currentCharacterValues: { affection: "42" },
    });
    assert.equal(obs[0]!.beforeValue, 40);
    assert.equal(obs[0]!.baselineSource, "previous_status");
  });

  it("SR1 regen uses prior canonical 40 not rejected variant 45", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      // loadPrevious excludes the regenerating message — baseline is T9=40
      previousCharacterValues: { affection: "40" },
      currentCharacterValues: { affection: "42" },
      regeneration: true,
    });
    assert.equal(obs[0]!.beforeValue, 40);
    assert.notEqual(obs[0]!.beforeValue, 45);
    assert.equal(obs[0]!.parsedProposal, 42);
    assert.equal(obs[0]!.regeneration, true);
  });

  it("SR2 regen invalid proposal → INVALID_HOLD keeps before 40", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      previousCharacterValues: { affection: "40" },
      currentCharacterValues: { affection: "약 42" },
      regeneration: true,
    });
    assert.equal(obs[0]!.beforeValue, 40);
    assert.equal(obs[0]!.outcome, "INVALID_HOLD");
    assert.equal(obs[0]!.hypotheticalAfter, 40);
    assert.equal(obs[0]!.proposalFormat, "invalid_text");
  });
});

describe("Phase B1-B — reducer integration (SI)", () => {
  it("SI1 40 → 43 APPLIED", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      previousCharacterValues: { affection: "40" },
      currentCharacterValues: { affection: "43" },
    });
    assert.equal(obs[0]!.outcome, "APPLIED");
    assert.equal(obs[0]!.hypotheticalAfter, 43);
  });

  it("SI2 40 → 80 with maxIncrease 5 → DELTA_LIMITED_UP 45", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      previousCharacterValues: { affection: "40" },
      currentCharacterValues: { affection: "80" },
    });
    assert.equal(obs[0]!.hypotheticalAfter, 45);
    assert.ok(obs[0]!.adjustments.includes("DELTA_LIMITED_UP"));
  });

  it("SI3 98 → 120 clamp/limit", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      previousCharacterValues: { affection: "98" },
      currentCharacterValues: { affection: "120" },
    });
    // clamp to 100 then delta limit from 98 → 103 would clamp again to 100;
    // policy: clamp then delta limit: 120→100 (CLAMPED_MAX), delta 2 ≤ 5 → after 100
    assert.equal(obs[0]!.hypotheticalAfter, 100);
    assert.ok(obs[0]!.adjustments.includes("CLAMPED_MAX"));
  });

  it("SI4 약 43 → INVALID_HOLD", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: widgetWithNumeric([{ id: "affection", numericState: def }]),
      previousCharacterValues: { affection: "40" },
      currentCharacterValues: { affection: "약 43" },
    });
    assert.equal(obs[0]!.outcome, "INVALID_HOLD");
  });

  it("proposal format classifier", () => {
    assert.equal(classifyNumericProposalFormat(40), "number");
    assert.equal(classifyNumericProposalFormat("40"), "plain_numeric");
    assert.equal(classifyNumericProposalFormat("40%"), "percent");
    assert.equal(classifyNumericProposalFormat("40/100"), "fraction");
    assert.equal(classifyNumericProposalFormat("약 40"), "invalid_text");
    assert.equal(classifyNumericProposalFormat(null), "missing");
  });
});

describe("Phase B1-B — fail-closed entry + non-mutation", () => {
  it("flag OFF → tryObserve returns [] without mutating payload", () => {
    const current = { affection: "44", note: "keep" };
    const snapshot = JSON.stringify(current);
    const out = tryObserveNumericShadowForTurn({
      userId: 1,
      characterId: 6,
      chatId: 1,
      characterWidget: pilotWidget,
      previousCharacterValues: { affection: "40" },
      currentCharacterValues: current,
      env: {
        RP_NUMERIC_STATE_SHADOW_ENABLED: "0",
        RP_NUMERIC_STATE_SHADOW_USER_IDS: "1",
      },
    });
    assert.deepEqual(out, []);
    assert.equal(JSON.stringify(current), snapshot);
  });

  it("shadow ON does not mutate current status map", () => {
    const current = { affection: "44", trust: "10" };
    const snapshot = JSON.stringify(current);
    const out = tryObserveNumericShadowForTurn({
      userId: 1,
      characterId: 6,
      chatId: 1,
      characterWidget: pilotWidget,
      previousCharacterValues: { affection: "40", trust: "10" },
      currentCharacterValues: current,
      env: {
        RP_NUMERIC_STATE_SHADOW_ENABLED: "1",
        RP_NUMERIC_STATE_SHADOW_USER_IDS: "1",
      },
    });
    assert.ok(out.length >= 1);
    assert.equal(JSON.stringify(current), snapshot);
  });

  it("aggregate metrics helper", () => {
    const obs = observeNumericShadow({
      chatId: 1,
      characterWidget: pilotWidget,
      previousCharacterValues: {
        affection: "40",
        trust: "10",
        corruption: "0",
      },
      currentCharacterValues: {
        affection: "80",
        trust: "10",
        corruption: "약 1",
      },
    });
    const agg = aggregateNumericShadowObservations(obs);
    assert.equal(agg.total, 3);
    assert.ok((agg.byAdjustment.DELTA_LIMITED_UP ?? 0) >= 1);
    assert.ok((agg.byOutcome.INVALID_HOLD ?? 0) >= 1);
  });

  it("1000 local observations have no DB/network (microbench)", () => {
    const started = Date.now();
    for (let i = 0; i < 1000; i++) {
      observeNumericShadow({
        chatId: 1,
        characterWidget: widgetWithNumeric([
          { id: "affection", numericState: def },
        ]),
        previousCharacterValues: { affection: "40" },
        currentCharacterValues: { affection: String(40 + (i % 6)) },
      });
    }
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `expected <2s for 1000 obs, got ${elapsed}ms`);
  });
});
