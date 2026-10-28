import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialInPlaceLorebookPlan } from "@/lib/officialSupply/inPlaceSync";
import {
  resolveLorebookPlanDisplay,
  serializeLorebookPlanDisplayRows,
} from "./AdminOfficialCharactersClient";

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
    assert.equal(resolved.rows[0]?.lorebookId, 13);
    assert.equal(resolved.rows[0]?.action, "skip_identical");
    const serialized = serializeLorebookPlanDisplayRows(resolved.rows);
    assert.match(serialized, /mercator_exchange_underworld\t13\tskip_identical/);
    assert.doesNotMatch(serialized, /\b50\b|\b99\b|linkedCharacter|shared|token/);
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
    assert.equal(resolved.rows[0]?.action, "update");
    assert.notEqual(resolved.rows[0]?.action, "skip_identical");
  });

  it("returns unavailable when lorebookPlan is missing", () => {
    assert.deepEqual(resolveLorebookPlanDisplay(undefined), { status: "unavailable" });
    assert.deepEqual(resolveLorebookPlanDisplay(null), { status: "unavailable" });
  });

  it("does not expose internal plan fields in serialized display rows", () => {
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
    const json = JSON.stringify(resolved.rows);
    assert.doesNotMatch(json, /linkedCharacterIds|shared|preflight|token/);
  });
});
