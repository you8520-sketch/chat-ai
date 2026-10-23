import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrpgGmUserBlock, formatTrpgItemOfferBlock, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "./gmPrompt";
import {
  grantAcceptedItems,
  normalizeTrpgItemOffers,
  resolveTrpgItemAcceptance,
  restoreCommittedHumanItemFacts,
  stripUnacceptedItemProposals,
} from "./itemAcceptance";
import type { TrpgStateDelta } from "./types";

describe("item acceptance helpers", () => {
  it("normalizes offers once: trim, whitespace, length, dedupe, cap", () => {
    const long = "가".repeat(41);
    assert.deepEqual(normalizeTrpgItemOffers([" 열쇠 ", "열쇠", "", long, 3, "낡은   지도", "a", "b", "c", "d"]), [
      "열쇠",
      "낡은 지도",
      "a",
      "b",
    ]);
    assert.deepEqual(normalizeTrpgItemOffers("열쇠"), []);
  });

  it("parses itemOffers from GM output through the same normalizer", () => {
    const parsed = parseTrpgGmOutput(
      JSON.stringify({
        narration: "문이 열린다. GM: 무엇을 하겠는가?",
        delta: { players: [{ participantId: 3, itemOffers: ["열쇠", "열쇠", " "] }], location: "문턱" },
      })
    );
    assert.deepEqual(parsed.delta.players[0]?.itemOffers, ["열쇠"]);
  });

  it("strips human adds and AI offers, and the commit steps are idempotent on one parsed object", () => {
    const delta: TrpgStateDelta = {
      players: [
        { participantId: 1, inventoryAdd: ["열쇠"], itemOffers: ["지도"] },
        { participantId: 2, inventoryAdd: ["칼"], itemOffers: ["방패"] },
      ],
    };
    const humans = new Set([1]);
    for (let pass = 0; pass < 2; pass += 1) {
      stripUnacceptedItemProposals(delta, humans);
      grantAcceptedItems(delta, new Map([[1, ["지도"]]]));
    }
    assert.deepEqual(delta.players[0], { participantId: 1, itemOffers: ["지도"], inventoryAdd: ["지도"] });
    assert.deepEqual(delta.players[1], { participantId: 2, inventoryAdd: ["칼"] });
  });

  it("restores committed human item facts over a rewrite", () => {
    const rewrite: TrpgStateDelta = { players: [{ participantId: 1, itemOffers: ["새것"], inventoryAdd: ["새것"], hp: 9 }] };
    const committed: TrpgStateDelta = { players: [{ participantId: 1, itemOffers: ["지도"], inventoryAdd: ["열쇠"] }] };
    restoreCommittedHumanItemFacts(rewrite, committed, new Set([1]));
    assert.deepEqual(rewrite.players[0], { participantId: 1, hp: 9, itemOffers: ["지도"], inventoryAdd: ["열쇠"] });
    const empty: TrpgStateDelta = { players: [{ participantId: 1, itemOffers: ["새것"] }] };
    restoreCommittedHumanItemFacts(empty, undefined, new Set([1]));
    assert.deepEqual(empty.players[0], { participantId: 1 });
  });

  it("binds acceptance to the source round and this seat's own offers", () => {
    const offers = { fromRound: 4, items: ["열쇠"] };
    assert.equal(resolveTrpgItemAcceptance(offers, []), null);
    assert.deepEqual(resolveTrpgItemAcceptance(offers, [{ name: "열쇠", fromRound: 4 }]), { fromRound: 4, items: ["열쇠"] });
    assert.throws(() => resolveTrpgItemAcceptance(offers, [{ name: "열쇠", fromRound: 3 }]), /지난 장면/);
    assert.throws(() => resolveTrpgItemAcceptance(offers, [{ name: "칼", fromRound: 4 }]), /제안받은/);
    assert.throws(() => resolveTrpgItemAcceptance(null, [{ name: "열쇠", fromRound: 4 }]), /제안이 없습니다/);
  });

  it("gives the GM only server-confirmed acceptance and labels unaccepted offers as not held", () => {
    const user = buildTrpgGmUserBlock({
      worldBrief: "w",
      memoryBlock: "",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "열쇠를 받는다.",
          participantKind: "human",
          statKey: "dex",
          d20: 10,
          finalScore: 10,
          dc: 10,
          tier: "SUCCESS",
          acceptedItems: ["열쇠"],
        },
      ],
      itemOfferBlock: formatTrpgItemOfferBlock([{ participantId: 1, name: "렌", items: ["지도"] }]),
    });
    assert.match(user, /\[ITEMS ACCEPTED BY THIS PC — server-confirmed, now held\]\n열쇠/);
    assert.match(user, /NOT held, not accepted this round\]\n- participantId=1 name=렌: 지도/);
    assert.equal(formatTrpgItemOfferBlock([{ participantId: 1, name: "렌", items: [] }]), "");
  });

  it("states the human item rule once in the system prompt", () => {
    assert.equal(TRPG_GM_SYSTEM.split("itemOffers").length - 1, 2, "the rule and the example shape only");
    assert.match(TRPG_GM_SYSTEM, /never inventoryAdd \(AI companion seats only\)/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Inventory, location, quests, NPCs, flags, and story progress remain yours/);
  });
});
