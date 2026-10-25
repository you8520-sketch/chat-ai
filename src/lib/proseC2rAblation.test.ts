import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertC2rRegionalIsolation,
  fingerprintArm,
  C2R_ARM_PROSE,
  C2R_M2_CHANGE_KIND,
  PROSE_STYLE_SECTION_C2R_A,
  PROSE_STYLE_SECTION_C2R_AB,
} from "./proseC2rAblation";
import { PROSE_STYLE_SECTION } from "./advancedProseNsfwGuidelines";

describe("C2-R prose ablation arms", () => {
  it("regional isolation + AB composition", () => {
    const r = assertC2rRegionalIsolation();
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  it("A is production baseline", () => {
    assert.equal(PROSE_STYLE_SECTION_C2R_A, PROSE_STYLE_SECTION);
  });

  it("fingerprints are stable and AB changes both families", () => {
    const fps = (["A", "M1", "M2", "AB"] as const).map(fingerprintArm);
    assert.equal(fps[0]!.changed_clause_ids.length, 0);
    assert.ok(fps[1]!.changed_clause_ids.includes("P07_RHYTHM_SHORT_SENTENCE"));
    assert.ok(!fps[1]!.changed_clause_ids.includes("P05_SCENE_FLOW_QUIET"));
    assert.ok(fps[2]!.changed_clause_ids.includes("P05_SCENE_FLOW_QUIET"));
    assert.ok(!fps[2]!.changed_clause_ids.includes("P07_RHYTHM_SHORT_SENTENCE"));
    assert.ok(fps[3]!.changed_clause_ids.includes("P07_RHYTHM_SHORT_SENTENCE"));
    assert.ok(fps[3]!.changed_clause_ids.includes("P05_SCENE_FLOW_QUIET"));
    assert.notEqual(fps[0]!.sha256, fps[1]!.sha256);
    assert.notEqual(fps[0]!.sha256, fps[2]!.sha256);
    assert.equal(C2R_ARM_PROSE.AB, PROSE_STYLE_SECTION_C2R_AB);
  });

  it("M2 records wording + position change", () => {
    assert.equal(C2R_M2_CHANGE_KIND.wording_change, true);
    assert.equal(C2R_M2_CHANGE_KIND.position_change, true);
  });
});
