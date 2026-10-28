import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialInPlaceLorebookPlan } from "@/lib/officialSupply/inPlaceSync";
import { resolveLorebookPlanDisplay } from "./AdminOfficialCharactersClient";

describe("lorebookPlanPreviewDisplay", () => {
  it("shows lorebookId 13 with skip_identical from server action", () => {
    const plan: OfficialInPlaceLorebookPlan[] = [
      {
        entryKey: "mercator_exchange_underworld",
        lorebookId: 13,
        action: "skip_identical",
        shared: false,
        linkedCharacterIds: [50, 99],
      },
    ];
    const resolved = resolveLorebookPlanDisplay(plan);
    assert.equal(resolved.status, "available");
    if (resolved.status !== "available") return;
    assert.equal(resolved.rows.length, 1);
    assert.deepEqual(resolved.rows[0], {
      entryKey: "mercator_exchange_underworld",
      lorebookId: 13,
      action: "skip_identical",
    });
  });

  it("shows update action without remapping to identical", () => {
    const plan: OfficialInPlaceLorebookPlan[] = [
      {
        entryKey: "other_entry",
        lorebookId: 7,
        action: "update",
        shared: true,
        linkedCharacterIds: [1],
      },
    ];
    const resolved = resolveLorebookPlanDisplay(plan);
    assert.equal(resolved.status, "available");
    if (resolved.status !== "available") return;
    assert.deepEqual(resolved.rows[0], {
      entryKey: "other_entry",
      lorebookId: 7,
      action: "update",
    });
  });

  it("returns unavailable when lorebookPlan is missing", () => {
    assert.deepEqual(resolveLorebookPlanDisplay(undefined), { status: "unavailable" });
    assert.deepEqual(resolveLorebookPlanDisplay(null), { status: "unavailable" });
  });

  it("does not expose internal plan fields in display rows", () => {
    const plan: OfficialInPlaceLorebookPlan[] = [
      {
        entryKey: "k",
        lorebookId: 13,
        action: "insert",
        shared: true,
        linkedCharacterIds: [50],
      },
    ];
    const resolved = resolveLorebookPlanDisplay(plan);
    assert.equal(resolved.status, "available");
    if (resolved.status !== "available") return;
    assert.deepEqual(Object.keys(resolved.rows[0] ?? {}).sort(), ["action", "entryKey", "lorebookId"]);
    const json = JSON.stringify(resolved.rows);
    assert.doesNotMatch(json, /linkedCharacterIds|shared|preflight|token|\b50\b/);
  });
});
