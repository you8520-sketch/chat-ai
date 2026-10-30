import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrpgGmUserBlock, formatTrpgItemOfferBlock, parseTrpgGmOutput, TRPG_GM_SYSTEM } from "./gmPrompt";
import {
  foldAcceptedInventoryGrants,
  grantAcceptedItems,
  normalizeTrpgItemOffers,
  resolveTrpgItemAcceptance,
  restoreCommittedHumanItemFacts,
  stripUnacceptedItemProposals,
} from "./itemAcceptance";
import { inventoryFromUnits, inventoryUnits } from "./inventory";
import { mergeMechanicsOwnedDelta } from "./mechanicsMerge";
import type { TrpgSheetSnapshot, TrpgStateDelta } from "./types";

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
    const aiLocks = new Map([[2, "칼을 받는다."]]);
    for (let pass = 0; pass < 2; pass += 1) {
      stripUnacceptedItemProposals(delta, humans, aiLocks);
      grantAcceptedItems(delta, new Map([[1, ["지도"]]]));
    }
    foldAcceptedInventoryGrants(delta);
    assert.deepEqual(delta.players[0], { participantId: 1, itemOffers: ["지도"], inventoryAdd: ["지도"] });
    assert.deepEqual(delta.players[1], { participantId: 2, inventoryAdd: ["칼"] });
  });

  it("AI inventoryAdd stays unowned unless the lock is a committed take of that item", () => {
    const item = "봉투";
    const cases: Array<{ lock: string; keep: boolean }> = [
      { lock: "봉투를 살펴본다.", keep: false },
      { lock: "봉투를 받지 않는다. 문을 닫는다.", keep: false },
      { lock: "봉투를 받으면 좋겠다. 문을 닫는다.", keep: false },
      { lock: '"봉투는 네가 챙겨." 문을 닫는다.', keep: false },
      { lock: "봉투를 받는다.", keep: true },
      { lock: "봉투를 챙겨 가방에 넣는다.", keep: true },
      { lock: "봉투를 받았다.", keep: true },
      { lock: "봉투를 살펴본 뒤 칼을 받는다.", keep: false },
      { lock: "봉투를 살펴본 다음 칼을 받는다.", keep: false },
    ];
    for (const row of cases) {
      const delta: TrpgStateDelta = { players: [{ participantId: 89, inventoryAdd: [item] }] };
      stripUnacceptedItemProposals(delta, new Set(), new Map([[89, row.lock]]));
      assert.deepEqual(
        delta.players[0]?.inventoryAdd,
        row.keep ? [item] : undefined,
        row.lock
      );
    }
    const received = "칼";
    for (const lock of ["봉투를 살펴본 뒤 칼을 받는다.", "봉투를 살펴본 다음 칼을 받는다."]) {
      const both: TrpgStateDelta = { players: [{ participantId: 89, inventoryAdd: ["봉투", received] }] };
      stripUnacceptedItemProposals(both, new Set(), new Map([[89, lock]]));
      assert.deepEqual(both.players[0]?.inventoryAdd, [received], lock);
    }
    const roasted: TrpgStateDelta = { players: [{ participantId: 89, inventoryAdd: ["볶은 메밀 봉투"] }] };
    stripUnacceptedItemProposals(roasted, new Set(), new Map([[89, "볶은 메밀 봉투를 받는다."]]));
    assert.deepEqual(roasted.players[0]?.inventoryAdd, ["볶은 메밀 봉투"]);
  });

  it("R7 speech-only companion locks drop GM inventoryAdd for the offered packets", () => {
    const delta: TrpgStateDelta = {
      players: [
        { participantId: 87, itemOffers: ["볶은 메밀 봉투"] },
        { participantId: 89, inventoryAdd: ["볶은 메밀 봉투"] },
        { participantId: 88, inventoryAdd: ["볶은 메밀 봉투"] },
      ],
    };
    stripUnacceptedItemProposals(
      delta,
      new Set([87]),
      new Map([
        [89, '"그래, 조심해서 가라. 길 미끄러우니까 발 헛디뎌서 우스운 꼴 보이지 말고."'],
        [88, '"여기까지라니까 더 발목 잡진 않겠는데, 꼴을 보니 밤길 걱정은 저쪽이 아니라 네가 해야겠네."'],
      ])
    );
    assert.deepEqual(delta.players[0], { participantId: 87, itemOffers: ["볶은 메밀 봉투"] });
    assert.deepEqual(delta.players[1], { participantId: 89 });
    assert.deepEqual(delta.players[2], { participantId: 88 });
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

  it("stacks exploration reward and accepted grant of the same name as separate acquisitions", () => {
    const sheet: TrpgSheetSnapshot = {
      participantId: 1,
      name: "렌",
      playerName: "렌",
      level: 1,
      hp: 10,
      maxHp: 25,
      stats: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, res: 8 },
      conditions: [],
      inventory: [],
      location: "",
      modifiersNote: "",
    };
    const merged = mergeMechanicsOwnedDelta(
      [sheet],
      { players: [{ participantId: 1, inventoryAdd: ["회복약"], acceptedInventoryAdd: ["회복약"] }] },
      null
    );
    assert.equal(merged.ok, true);
    if (merged.ok) assert.deepEqual(inventoryUnits(merged.next[0]?.inventory ?? []), ["회복약", "회복약"]);
  });

  it("states the human item rule once in the system prompt", () => {
    assert.equal(TRPG_GM_SYSTEM.split("itemOffers").length - 1, 2, "the rule and the example shape only");
    assert.match(TRPG_GM_SYSTEM, /AI inventoryAdd only that locked take or \[EXPLORATION\] rewards/);
    assert.doesNotMatch(TRPG_GM_SYSTEM, /Inventory, location, quests, NPCs, flags, and story progress remain yours/);
  });
});
