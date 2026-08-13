import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessSituationBand, resolveActionDc } from "./dcAssess";
import { parseTrpgDiceRules } from "./types";

describe("TRPG situational DC", () => {
  it("keeps old campaigns on fixed DC 12", () => {
    const rules = parseTrpgDiceRules({ dc: 12 });
    assert.equal(rules.dcMode, "fixed");
    assert.equal(
      resolveActionDc({ rules, body: "절벽에서 맨손으로 뛰어내린다." }),
      12
    );
    const fromJson = parseTrpgDiceRules(JSON.stringify({ dcMode: "situational", dc: 12 }));
    assert.equal(fromJson.dcMode, "situational");
  });

  it("marks obvious hard and easy actions when situational", () => {
    const rules = parseTrpgDiceRules({ dcMode: "situational" });
    assert.equal(assessSituationBand({ body: "절벽에서 맨손으로 뛰어내린다." }), "hard");
    assert.equal(
      resolveActionDc({ rules, body: "절벽에서 맨손으로 뛰어내린다." }),
      16
    );
    assert.equal(assessSituationBand({ body: "고개 끄덕이며 인사하고 잡담한다." }), "easy");
    assert.equal(
      resolveActionDc({ rules, body: "고개 끄덕이며 인사하고 잡담한다." }),
      8
    );
    assert.equal(assessSituationBand({ body: "조심스럽게 문을 민다." }), "normal");
    assert.equal(resolveActionDc({ rules, body: "조심스럽게 문을 민다." }), 12);
  });

  it("lets a locked door in the place text raise the band", () => {
    assert.equal(
      assessSituationBand({
        body: "안으로 들어간다.",
        location: "잠긴 철문 앞",
      }),
      "hard"
    );
  });
});
