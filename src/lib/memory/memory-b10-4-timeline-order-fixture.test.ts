/**
 * B10-4: deterministic semantics for T25 arrival-order summary loss vs fixture NEW tail.
 * Full snap-50 → Global → wire replay: docs/pr-evidence/pr-b10-4-timeline-preserve/.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const OLD_TAIL =
  "렌이 자신의 탓이라며 주저앉자 태형은 아무것도 묻지 않고 곁을 지키며 귤을 건네고, “네 탓 아니야”라고 위로함.";
const NEW_TAIL =
  "렌이 자신의 탓이라며 비상계단에 먼저 주저앉자, 태형이 말없이 내려와 옆에 앉았다. 태형은 아무것도 묻지 않고 귤을 건네며 “네 탓 아니야”라고 위로했다.";

function evaluateSemantics(text: string) {
  const renFirstOrSelfBlame = /렌.*(먼저|탓|주저앉)/.test(text);
  const taehyungArrivalOrSitBeside = /태형.*(내려와|옆에 앉|곁을)/.test(text);
  const orderedRenThenTaehyung =
    /(먼저.*렌|렌.*먼저).*(내려와|태형)/s.test(text) ||
    (/렌.*주저앉/.test(text) && /내려와/.test(text));
  return {
    renFirstOrSelfBlame,
    taehyungArrivalOrSitBeside,
    orderedRenThenTaehyung,
    tangerineComfort: /(귤|네 탓 아니)/.test(text),
    noFabricatedNonWitness: !/목격하지 못|직접 목격하지/.test(text),
  };
}

describe("B10-4 T25 arrival order semantics", () => {
  it("OLD stored tail weakens explicit arrival order", () => {
    const s = evaluateSemantics(OLD_TAIL);
    assert.equal(s.renFirstOrSelfBlame, true);
    assert.equal(s.taehyungArrivalOrSitBeside, true);
    assert.equal(s.orderedRenThenTaehyung, false);
    assert.equal(s.tangerineComfort, true);
    assert.equal(s.noFabricatedNonWitness, true);
  });

  it("NEW fixture tail preserves ren-first then taehyung arrival", () => {
    const s = evaluateSemantics(NEW_TAIL);
    assert.equal(s.orderedRenThenTaehyung, true);
    assert.match(NEW_TAIL, /내려와/);
    assert.equal(s.noFabricatedNonWitness, true);
  });
});
