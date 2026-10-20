import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCampaignLedger,
  bindGmLocationToSubmittedMovement,
  destinationRefinesDeclared,
  type TrpgLocationPersistSubmission,
} from "./campaignLedger";
import { declaresTraversalIntent } from "./actionCheckContext";
import { resolveThreatStrikes } from "./encounterStrikes";
import type { TrpgScenarioEncounter } from "./scenarioPlan";
import type { TrpgSheetSnapshot } from "./types";

/**
 * Phase 2 P0 (#1541): player movement approval vs saved location.
 * Fixtures are the real inputs/outputs of the NEW world-only free-play run
 * (docs/evidence/trpg-phase2/live-free-new, commit 6286462): the human actions as submitted and the
 * location the real Gemini GM proposed in response. The server froze at 선원 조합 회관 from R3 to R10.
 */

type Seat = { id: number; at: string; body: string; tier?: string | null; goTo?: string };

function bind(opts: { current: string; gm: string; seats: Seat[]; hook?: string }) {
  return bindGmLocationToSubmittedMovement({
    opening: false,
    currentLocation: opts.current,
    proposedLocation: opts.gm,
    delta: {
      players: opts.seats.map((seat) => ({ participantId: seat.id, location: seat.goTo ?? opts.gm })),
      location: opts.gm,
      nextRoundContext: opts.hook ?? "GM이 쓴 다음 맥락.",
    },
    submissions: opts.seats.map(
      (seat): TrpgLocationPersistSubmission => ({ participantId: seat.id, body: seat.body, tier: seat.tier ?? null })
    ),
    sheetLocations: opts.seats.map((seat) => ({ participantId: seat.id, location: seat.at })),
  });
}

const placeOf = (bound: ReturnType<typeof bind>, id: number) =>
  bound.delta.players?.find((patch) => patch.participantId === id)?.location;

describe("movement authority: real Phase 2 free-play fixtures", () => {
  it("R2 어시장으로 가서 → 마레노 어시장 is accepted for both humans", () => {
    const bound = bind({
      current: "마레노 부두",
      gm: "마레노 어시장",
      seats: [
        { id: 8, at: "마레노 부두", body: "들은 이야기를 따라 어시장으로 가서 상인들에게 소문에 대해 묻는다.", tier: "SUCCESS" },
        { id: 9, at: "마레노 부두", body: "렌과 함께 어시장으로 이동해 가판대 사이를 둘러본다." },
      ],
    });
    assert.equal(bound.location, "마레노 어시장");
    assert.equal(placeOf(bound, 8), "마레노 어시장");
    assert.equal(placeOf(bound, 9), "마레노 어시장");
    assert.equal(bound.nextRoundContext, "GM이 쓴 다음 맥락.");
  });

  it("R5 곶 끝의 등대로 이동한다 → 곶 끝의 등대 외곽 is accepted; a companion that only walks the road is not moved", () => {
    const bound = bind({
      current: "선원 조합 회관",
      gm: "곶 끝의 등대 외곽",
      seats: [
        { id: 8, at: "선원 조합 회관", body: "알게 된 내용을 확인하러 곶 끝의 등대로 이동한다." },
        { id: 9, at: "선원 조합 회관", body: "등대로 이어지는 길을 따라 걸으며 주변을 살핀다." },
      ],
    });
    assert.equal(bound.location, "곶 끝의 등대 외곽");
    assert.equal(placeOf(bound, 8), "곶 끝의 등대 외곽");
    assert.equal(placeOf(bound, 9), undefined, "no declared goal for 현 means the GM cannot move 현");
  });

  it("R6 등대 위로 올라가 → 곶 끝의 등대 내부 is accepted", () => {
    const bound = bind({
      current: "곶 끝의 등대 외곽",
      gm: "곶 끝의 등대 내부",
      seats: [
        { id: 8, at: "곶 끝의 등대 외곽", body: "등대지기를 만나 이야기를 나눈다." },
        { id: 9, at: "곶 끝의 등대 외곽", body: "등대 위로 올라가 바다 쪽을 살핀다." },
      ],
    });
    assert.equal(placeOf(bound, 9), "곶 끝의 등대 내부");
    assert.equal(placeOf(bound, 8), undefined, "렌 only talked; the GM's relocation is not his");
    assert.equal(bound.location, "곶 끝의 등대 내부");
  });

  it("R7 세관으로 향한다 → 세관 청사 1층 is accepted for both humans", () => {
    const bound = bind({
      current: "곶 끝의 등대 내부",
      gm: "세관 청사 1층",
      seats: [
        { id: 8, at: "곶 끝의 등대 내부", body: "지금까지 알아낸 것을 정리하고, 다음에 가 볼 곳을 정해 세관으로 향한다." },
        { id: 9, at: "곶 끝의 등대 내부", body: "렌을 따라 세관으로 이동한다." },
      ],
    });
    assert.equal(bound.location, "세관 청사 1층");
    assert.equal(placeOf(bound, 8), "세관 청사 1층");
    assert.equal(placeOf(bound, 9), "세관 청사 1층");
  });

  it("R9 어시장으로 돌아가 → 어시장 is accepted; the place the party leaves is never the destination", () => {
    const body = "세관에서 얻은 단서를 들고 다시 어시장으로 돌아가 아까 만난 사람을 찾는다.";
    const home = bind({ current: "세관 청사 1층", gm: "어시장", seats: [{ id: 8, at: "세관 청사 1층", body }] });
    assert.equal(home.location, "어시장");
    assert.equal(placeOf(home, 8), "어시장");
    const source = bind({ current: "어시장", gm: "세관 지하 창고", seats: [{ id: 8, at: "어시장", body }] });
    assert.equal(source.location, "어시장", "세관에서 names the source, not a destination");
    assert.equal(placeOf(source, 8), undefined);
  });

  it("the whole free-play route R2→R9 persists step by step with no frozen place", () => {
    const route: Array<[string, string, string]> = [
      ["마레노 부두", "마레노 어시장", "들은 이야기를 따라 어시장으로 가서 상인들에게 소문에 대해 묻는다."],
      ["마레노 어시장", "선원 조합 회관", "어시장에서 들은 이야기를 확인하러 선원 조합 회관으로 향한다."],
      ["선원 조합 회관", "곶 끝의 등대 외곽", "알게 된 내용을 확인하러 곶 끝의 등대로 이동한다."],
      ["곶 끝의 등대 외곽", "곶 끝의 등대 내부", "등대 위로 올라가 바다 쪽을 살핀다."],
      ["곶 끝의 등대 내부", "세관 청사 1층", "다음에 가 볼 곳을 정해 세관으로 향한다."],
      ["세관 청사 1층", "어시장", "세관에서 얻은 단서를 들고 다시 어시장으로 돌아가 아까 만난 사람을 찾는다."],
    ];
    let ledger = route[0]![0];
    for (const [from, to, body] of route) {
      assert.equal(ledger, from);
      const bound = bind({ current: ledger, gm: to, seats: [{ id: 8, at: ledger, body }] });
      ledger = bound.location;
      assert.equal(ledger, to, `"${body}" must persist ${to}`);
    }
  });
});

describe("movement authority: what is not a declared move", () => {
  const dock = "회린 부두";
  const market = "회린 시장";
  const reject = (body: string, extra: Partial<Seat> = {}, gm = market) => {
    const bound = bind({
      current: dock,
      gm,
      seats: [{ id: 1, at: dock, body, ...extra }],
      hook: `렌은 ${gm}에 도착했다.`,
    });
    assert.equal(bound.location, dock, body);
    assert.equal(placeOf(bound, 1), undefined, body);
    assert.equal(bound.nextRoundContext, "", `${body}: a hook written for the refused place is not kept`);
  };

  it("a negated move", () => {
    reject("시장으로 이동하지 않고 부두에 남는다.");
    reject("시장으로 가지 않겠다고 다짐한다.");
    reject("시장에는 가지 말자.");
    reject("시장으로 못 간다.");
  });

  it("a move that is only a question or a doubt", () => {
    reject("시장으로 가는지 렌에게 묻는다.");
    reject("시장으로 갈까 망설인다.");
  });

  it("a move command that only appears inside a quotation", () => {
    reject('"시장으로 가자"고 동료에게 말한다.');
    reject("“지금 당장 시장으로 이동해야 해.” 하고 외친다.");
  });

  it("a move the GM invented without any submitted movement", () => {
    reject("부두 끝에서 바다를 바라본다.");
    reject("시장 상인들의 소문을 곰곰이 생각해 본다.");
  });

  it("a place named only as a source, a location of the act, or an object", () => {
    reject("시장에서 부두로 돌아와 짐을 푼다.", {}, market);
    reject("시장 앞에서 상인에게 말을 건다.");
    reject("시장 지도를 펼쳐 본다.");
  });

  it("a failed player move", () => {
    reject("서둘러 시장으로 이동한다.", { tier: "FAILURE" });
    reject("서둘러 시장으로 이동한다.", { tier: "CRITICAL_FAILURE" });
  });

  it("a failed check does not undo a move the exploration owner already applied, and approves no other place", () => {
    const base = {
      opening: false,
      currentLocation: dock,
      delta: { players: [{ participantId: 1, location: market }], location: market, nextRoundContext: "다음" },
      sheetLocations: [{ participantId: 1, location: dock }],
    };
    const served = bindGmLocationToSubmittedMovement({
      ...base,
      proposedLocation: market,
      submissions: [{ participantId: 1, body: "시장을 조사한다.", tier: "FAILURE", serverMovedTo: market }],
    });
    assert.equal(served.delta.players?.[0]?.location, market);
    assert.equal(served.location, market);
    const other = bindGmLocationToSubmittedMovement({
      ...base,
      proposedLocation: market,
      submissions: [{ participantId: 1, body: "시장을 조사한다.", tier: "FAILURE", serverMovedTo: "창고" }],
    });
    assert.equal(other.delta.players?.[0]?.location, undefined);
    assert.equal(other.location, dock);
  });

  it("a partial success still moves the player that attempted it", () => {
    const bound = bind({ current: dock, gm: market, seats: [{ id: 1, at: dock, body: "시장으로 이동한다.", tier: "PARTIAL_SUCCESS" }] });
    assert.equal(bound.location, market);
  });

  it("a neighbouring place that only shares a qualifier word or a direction", () => {
    const north = bind({ current: dock, gm: "남쪽 창고", seats: [{ id: 1, at: dock, body: "북쪽 창고로 이동한다." }] });
    assert.equal(north.location, dock);
    const east = bind({ current: dock, gm: "서쪽 항구", seats: [{ id: 1, at: dock, body: "동쪽 항구로 이동한다." }] });
    assert.equal(east.location, dock);
    const color = bind({ current: dock, gm: "푸른 창고", seats: [{ id: 1, at: dock, body: "붉은 창고로 이동한다." }] });
    assert.equal(color.location, dock);
  });

  it("a different place that merely contains or starts with the declared name", () => {
    const lighthouse = (gm: string) =>
      bind({ current: dock, gm, seats: [{ id: 1, at: dock, body: "곶 끝의 등대로 이동한다." }] }).location;
    assert.equal(lighthouse("곶 끝의 등대"), "곶 끝의 등대");
    assert.equal(lighthouse("곶 끝의 등대 외곽"), "곶 끝의 등대 외곽");
    assert.equal(lighthouse("곶 끝의 선술집"), dock, "shares 곶 끝의 but is another place");
    assert.equal(lighthouse("등대지기 오두막"), dock, "등대지기 is not 등대");
    assert.equal(lighthouse("항구 광장"), dock);
  });

  it("an unnamed place can never be accepted", () => {
    reject("밖으로 나간다.", {}, "항구 광장");
    reject("앞으로 나아간다.", {}, "항구 광장");
    reject("문을 열고 나간다.", {}, "항구 광장");
  });
});

describe("movement authority: inside / outside boundary", () => {
  const go = (body: string, gm: string) =>
    bind({ current: "마레노 부두", gm, seats: [{ id: 1, at: "마레노 부두", body }] }).location;

  it("going to the front of a building does not authorize its interior, and the reverse", () => {
    assert.equal(go("세관 앞으로 이동한다.", "세관 청사 1층"), "마레노 부두");
    assert.equal(go("세관 앞으로 이동한다.", "세관 내부"), "마레노 부두");
    assert.equal(go("세관 입구로 걸어간다.", "세관 내부"), "마레노 부두");
    assert.equal(go("세관 안으로 들어간다.", "세관 외곽"), "마레노 부두");
    assert.equal(go("세관 안으로 들어간다.", "세관 바깥"), "마레노 부두");
  });

  it("going to the building itself may land on either side of it", () => {
    assert.equal(go("세관으로 향한다.", "세관 청사 1층"), "세관 청사 1층");
    assert.equal(go("세관으로 향한다.", "세관 외곽"), "세관 외곽");
    assert.equal(go("세관 앞으로 이동한다.", "세관 외곽"), "세관 외곽");
    assert.equal(go("세관 안으로 들어간다.", "세관 내부"), "세관 내부");
  });

  it("the same place's detail wording is accepted: parents before the name, sub-areas after it", () => {
    assert.equal(go("어시장으로 이동한다.", "마레노 어시장"), "마레노 어시장");
    assert.equal(go("어시장으로 이동한다.", "마레노 어시장 외곽"), "마레노 어시장 외곽");
    assert.equal(go("어시장으로 이동한다.", "마레노 어시장 외곽 부두"), "마레노 부두", "a dock beyond the market is another place");
    assert.equal(go("열린 찻집 문으로 들어간다.", "석등 골목 찻집 내부"), "석등 골목 찻집 내부");
    assert.equal(go("열린 찻집 문으로 들어간다.", "석등 골목"), "마레노 부두", "the parent alley is not the tea house");
  });
});

describe("movement authority: separated 2 humans + 2 AI", () => {
  it("each seat moves only on its own declaration, even when the GM places everyone together", () => {
    const bound = bind({
      current: "선원 조합 회관",
      gm: "어시장",
      seats: [
        { id: 1, at: "선원 조합 회관", body: "어시장으로 이동한다." },
        { id: 2, at: "선원 조합 회관", body: "회관 게시판을 살핀다." },
        { id: 3, at: "선원 조합 회관", body: "렌을 따라 어시장으로 걸어간다." },
        { id: 4, at: "선원 조합 회관", body: "세관으로 향한다." },
      ],
    });
    assert.equal(placeOf(bound, 1), "어시장");
    assert.equal(placeOf(bound, 2), undefined);
    assert.equal(placeOf(bound, 3), "어시장");
    assert.equal(placeOf(bound, 4), undefined, "the AI headed to 세관, so the GM's 어시장 is not its approved place");
    assert.equal(bound.location, "어시장");
  });

  it("one seat's authorization never approves another seat's different destination", () => {
    const bound = bindGmLocationToSubmittedMovement({
      opening: false,
      currentLocation: "선원 조합 회관",
      proposedLocation: "어시장",
      delta: {
        players: [
          { participantId: 1, location: "어시장" },
          { participantId: 2, location: "세관" },
        ],
        location: "어시장",
        nextRoundContext: "둘은 갈라졌다.",
      },
      submissions: [
        { participantId: 1, body: "어시장으로 이동한다." },
        { participantId: 2, body: "어시장으로 이동한다." },
      ],
      sheetLocations: [
        { participantId: 1, location: "선원 조합 회관" },
        { participantId: 2, location: "선원 조합 회관" },
      ],
    });
    const byId = new Map((bound.delta.players ?? []).map((patch) => [patch.participantId, patch.location]));
    assert.equal(byId.get(1), "어시장");
    assert.equal(byId.get(2), "어시장", "the GM's 세관 for seat 2 is replaced by what seat 2 declared");
  });

  it("is deterministic: binding the same commit twice yields the same state", () => {
    const seats: Seat[] = [
      { id: 1, at: "선원 조합 회관", body: "어시장으로 가서 소문을 묻는다." },
      { id: 2, at: "선원 조합 회관", body: "회관 게시판을 살핀다." },
    ];
    const first = bind({ current: "선원 조합 회관", gm: "어시장", seats });
    const second = bind({ current: "선원 조합 회관", gm: "어시장", seats });
    assert.deepEqual(second, first);
  });
});

describe("movement authority: persisted state agrees after a refused GM relocation", () => {
  it("the place stays, the refused hook is dropped, and a relocation the player declared updates everything together", () => {
    const refused = bind({
      current: "선원 조합 회관",
      gm: "곶 끝의 등대 내부",
      seats: [{ id: 1, at: "선원 조합 회관", body: "회관 게시판을 살핀다." }],
      hook: "렌은 등대 안에 있다.",
    });
    assert.equal(refused.location, "선원 조합 회관");
    assert.equal(placeOf(refused, 1), undefined);
    assert.equal(refused.nextRoundContext, "", "neither the refused hook nor an older round's hook is kept");

    const accepted = bind({
      current: "선원 조합 회관",
      gm: "곶 끝의 등대 내부",
      seats: [{ id: 1, at: "선원 조합 회관", body: "곶 끝의 등대로 이동한다." }],
      hook: "렌은 등대 안에 있다.",
    });
    assert.equal(accepted.location, "곶 끝의 등대 내부");
    assert.equal(placeOf(accepted, 1), "곶 끝의 등대 내부");
    assert.equal(accepted.nextRoundContext, "렌은 등대 안에 있다.");
  });

  it("events progress without a place change: the GM's hook is kept when the place is unchanged", () => {
    const stay = bind({
      current: "선원 조합 회관",
      gm: "선원 조합 회관",
      seats: [{ id: 1, at: "선원 조합 회관", body: "바르토에게 면담을 청한다." }],
      hook: "바르토가 집무실로 안내한다.",
    });
    assert.equal(stay.location, "선원 조합 회관");
    assert.equal(stay.nextRoundContext, "바르토가 집무실로 안내한다.");
  });
});

describe("movement authority: #1555 server threat targeting stays strict", () => {
  const encounter: TrpgScenarioEncounter = {
    id: "enc_lighthouse",
    name: "등대 감시자",
    kind: "enemy",
    location: "곶 끝의 등대",
    activateRound: 1,
    maxStrikes: 3,
    damageClass: "MEDIUM",
    hitDc: 10,
  };
  const sheet = (participantId: number, name: string, location: string): TrpgSheetSnapshot =>
    ({
      participantId,
      name,
      playerName: name,
      level: 1,
      hp: 40,
      maxHp: 40,
      stats: {},
      conditions: [],
      inventory: [],
      location,
      modifiersNote: "",
    }) as TrpgSheetSnapshot;
  const targets = (locations: Record<number, string>) => {
    const sheets = new Map(Object.entries(locations).map(([id, loc]) => [Number(id), sheet(Number(id), `P${id}`, loc)]));
    return resolveThreatStrikes({
      encounters: [encounter],
      roundNumber: 1,
      priorStrikes: {},
      sheets,
      rng: () => 1,
      rollD20: () => 20,
      baseDc: 12,
    }).flatMap((strike) => strike.eligibleParticipantIds);
  };

  it("the presence matcher is not widened by the movement fix: only the place itself or its interior counts", () => {
    assert.deepEqual(targets({ 1: "곶 끝의 등대", 2: "곶 끝의 등대 내부" }), [1, 2]);
    assert.deepEqual(targets({ 1: "곶 끝의 등대 외곽" }), [], "a movement-accepted 외곽 label is not the threat's place");
    assert.deepEqual(targets({ 1: "곶 끝의 선술집", 2: "등대지기 오두막", 3: "세관 청사 1층" }), []);
    assert.equal(destinationRefinesDeclared("곶 끝의 등대", "곶 끝의 등대 외곽"), false);
    assert.equal(destinationRefinesDeclared("곶 끝의 등대", "곶 끝의 등대 내부"), true);
  });

  it("a party that left the threat's place after an accepted move is out of reach; a split party is not mixed", () => {
    const moved = bind({
      current: "곶 끝의 등대",
      gm: "세관 청사 1층",
      seats: [
        { id: 1, at: "곶 끝의 등대", body: "세관으로 향한다." },
        { id: 2, at: "곶 끝의 등대", body: "등대 안을 살핀다." },
        { id: 3, at: "곶 끝의 등대", body: "렌을 따라 세관으로 이동한다." },
        { id: 4, at: "곶 끝의 등대", body: "등대 위로 올라가 주변을 경계한다.", goTo: "곶 끝의 등대 내부" },
      ],
    });
    const seatLocations: Record<number, string> = {
      1: placeOf(moved, 1) ?? "곶 끝의 등대",
      2: placeOf(moved, 2) ?? "곶 끝의 등대",
      3: placeOf(moved, 3) ?? "곶 끝의 등대",
      4: placeOf(moved, 4) ?? "곶 끝의 등대",
    };
    assert.deepEqual(seatLocations, {
      1: "세관 청사 1층",
      2: "곶 끝의 등대",
      3: "세관 청사 1층",
      4: "곶 끝의 등대 내부",
    });
    assert.deepEqual(targets(seatLocations), [2, 4], "seats that left are out of reach; the two still inside are the only candidates");
  });

  it("a player who only aims at the threat's place is not moved there by a GM proposal and is not a strike candidate", () => {
    const shot = bind({
      current: "선원 조합 회관",
      gm: "곶 끝의 등대 내부",
      seats: [
        { id: 1, at: "선원 조합 회관", body: "등대를 향해 화살을 쏜다." },
        { id: 2, at: "선원 조합 회관", body: "등대로 가는 길을 조사한다." },
        { id: 3, at: "선원 조합 회관", body: "곶 끝의 등대로 이동한다." },
      ],
    });
    const at = (id: number) => placeOf(shot, id) ?? "선원 조합 회관";
    assert.deepEqual([at(1), at(2), at(3)], ["선원 조합 회관", "선원 조합 회관", "곶 끝의 등대 내부"]);
    assert.deepEqual(targets({ 1: at(1), 2: at(2), 3: at(3) }), [3], "only the seat that really moved can be struck");
  });
});

describe("movement authority: one definition of declared movement", () => {
  it("adjudication and persistence agree on what a movement clause is", () => {
    for (const body of [
      "어시장으로 가서 상인들에게 묻는다.",
      "곶 끝의 등대로 이동한다.",
      "등대 위로 올라가 바다 쪽을 살핀다.",
      "세관으로 향한다.",
      "어시장으로 돌아가 사람을 찾는다.",
    ]) {
      assert.equal(declaresTraversalIntent(body), true, body);
    }
    for (const body of [
      "시장으로 이동하지 않는다.",
      "시장으로 가는지 살핀다.",
      '"시장으로 가자"고 말한다.',
      "우측 통로를 조사한다.",
      "그에게 말을 건다.",
    ]) {
      assert.equal(declaresTraversalIntent(body), false, body);
    }
  });

  it("authorizes a declared follow into the named place and not an observed or stationary sentence", () => {
    const follow =
      "서하는 주 통로로 진입하는 데모유저의 뒤를 따라 이동하며, 손전등으로 바닥의 파편과 연구원들의 이동 흔적을 비추어 데모유저의 조사와 전진을 보조하려 했다.";
    const moved = bind({
      current: "도킹 베이",
      gm: "주 통로",
      seats: [{ id: 1, at: "도킹 베이", body: follow }],
    });
    assert.equal(moved.location, "주 통로");
    assert.equal(placeOf(moved, 1), "주 통로");
    for (const body of [
      "데모유저가 주 통로로 들어가는 것을 본다.",
      '"주 통로로 가자"고 말한다.',
      "주 통로로 이동하지 않고 도킹 베이에 남는다.",
      "제자리에 서서 도킹 베이를 비춘다.",
      "출구를 향해 화살을 쏜다.",
    ]) {
      const stayed = bind({
        current: "도킹 베이",
        gm: "주 통로",
        seats: [{ id: 1, at: "도킹 베이", body }],
      });
      assert.equal(stayed.location, "도킹 베이", body);
      assert.equal(placeOf(stayed, 1), undefined, body);
    }
    const elsewhere = bind({
      current: "도킹 베이",
      gm: "유지보수실",
      seats: [{ id: 1, at: "도킹 베이", body: follow }],
    });
    assert.equal(elsewhere.location, "도킹 베이");
    const command = bind({
      current: "도킹 베이",
      gm: "주 통로",
      seats: [{ id: 1, at: "도킹 베이", body: "주 통로로 이동" }],
    });
    assert.equal(command.location, "주 통로");
    for (const body of ["주 통로로 돌을 던지고 돌아온다.", "주 통로로 들어가는 데모유저를 지켜보며 출발한다."]) {
      const stayed = bind({
        current: "도킹 베이",
        gm: "주 통로",
        seats: [{ id: 1, at: "도킹 베이", body }],
      });
      assert.equal(stayed.location, "도킹 베이", body);
      assert.equal(placeOf(stayed, 1), undefined, body);
    }
  });
});

describe("movement authority: #1567 review — aiming, route talk and destination identity", () => {
  const home = "선원 조합 회관";
  const go = (body: string, gm: string, tier?: string) =>
    bind({ current: home, gm, seats: [{ id: 1, at: home, body, tier }] }).location;

  it("aiming, firing or pointing at a place is not moving to it", () => {
    for (const body of [
      "등대를 향해 화살을 쏜다.",
      "등대를 향해 활을 겨눈다.",
      "곶 끝의 등대를 향해 주문을 외운다.",
      "등대를 향해 소리친다.",
    ]) {
      assert.equal(go(body, "곶 끝의 등대"), home, body);
      assert.equal(declaresTraversalIntent(body), false, body);
    }
  });

  it("talking about or investigating the way to a place is not traversing it", () => {
    for (const body of [
      "등대로 가는 길을 조사한다.",
      "등대로 가는 길을 지도에서 찾아본다.",
      "등대로 갈 길을 살핀다.",
      "곶 끝의 등대로 이어지는 길을 확인한다.",
    ]) {
      assert.equal(go(body, "곶 끝의 등대"), home, body);
      assert.equal(declaresTraversalIntent(body), false, body);
    }
  });

  it("a real movement toward a place still passes, with or without a following action", () => {
    assert.equal(go("등대를 향해 달려간다.", "곶 끝의 등대"), "곶 끝의 등대");
    assert.equal(go("등대를 향해 전속력으로 달려간다.", "곶 끝의 등대"), "곶 끝의 등대");
    assert.equal(go("등대로 가서 주변을 조사한다.", "곶 끝의 등대"), "곶 끝의 등대");
    assert.equal(go("곶 끝의 등대로 이동한다.", "곶 끝의 등대 외곽"), "곶 끝의 등대 외곽");
    assert.equal(go("등대 위로 올라가 바다를 살핀다.", "곶 끝의 등대 내부"), "곶 끝의 등대 내부");
    assert.equal(go("곶 끝의 등대로 갈 것이다.", "곶 끝의 등대"), "곶 끝의 등대");
    assert.equal(go("등대를 향한다.", "곶 끝의 등대"), "곶 끝의 등대");
  });

  it("when the aim and the run cannot be tied together the server fails closed", () => {
    assert.equal(go("등대를 향해 화살을 쏘며 달려간다.", "곶 끝의 등대"), home, "the aim and the run are separated by another object");
    assert.equal(go("등대를 향해 화살을 쏘고 제자리에서 버틴다.", "곶 끝의 등대"), home);
    assert.equal(go("등대로 달려가며 화살을 쏜다.", "곶 끝의 등대"), "곶 끝의 등대", "the goal-marked place with a run is a move");
  });

  it("a different place that only contains the declared name as one word is refused", () => {
    for (const gm of ["등대 마을", "곶 끝의 등대 마을", "등대 선술집", "등대 앞 광장", "등대 어시장"]) {
      assert.equal(go("등대로 이동한다.", gm), home, gm);
      assert.equal(go("곶 끝의 등대로 이동한다.", gm), home, gm);
    }
  });

  it("the same place with parents before it and structural sub-areas after it is accepted", () => {
    for (const gm of ["곶 끝의 등대", "곶 끝의 등대 외곽", "곶 끝의 등대 내부", "곶 끝의 등대 2층", "등대 꼭대기", "등대 옥상"]) {
      assert.equal(go("등대로 이동한다.", gm), gm, gm);
    }
    assert.equal(go("세관으로 향한다.", "세관 청사 1층"), "세관 청사 1층");
    assert.equal(go("세관으로 향한다.", "세관 본관 로비"), "세관 본관 로비");
  });

  it("a refused top-level relocation clears the hook; the in-place state and typed facts stay", () => {
    const refused = bind({
      current: home,
      gm: "곶 끝의 등대 내부",
      seats: [{ id: 1, at: home, body: "회관 게시판을 살핀다." }],
      hook: "게시판 뒤에서 바르토의 서신이 나왔다. 렌은 등대 안으로 들어섰다.",
    });
    assert.equal(refused.location, home);
    assert.equal(refused.nextRoundContext, "");
  });

  it("a split party keeps each seat's real place and drops the group hook the GM wrote", () => {
    const bound = bindGmLocationToSubmittedMovement({
      opening: false,
      currentLocation: home,
      proposedLocation: "세관 청사 1층",
      delta: {
        players: [
          { participantId: 1, location: "어시장" },
          { participantId: 2, location: "세관 청사 1층" },
        ],
        location: "세관 청사 1층",
        nextRoundContext: "렌은 어시장에서 소문을 들었다. 바르토는 회관에 남았다. 둘은 세관에서 만나기로 했다.",
      },
      submissions: [
        { participantId: 1, body: "어시장으로 이동한다." },
        { participantId: 2, body: "회관 장부를 살핀다." },
      ],
      sheetLocations: [
        { participantId: 1, location: home },
        { participantId: 2, location: home },
      ],
    });
    assert.equal(bound.location, home);
    assert.equal(placeOf(bound, 1), "어시장", "the seat that declared 어시장 reached it");
    assert.equal(placeOf(bound, 2), undefined, "the seat that only read the ledger is not sent to 세관");
    assert.equal(bound.nextRoundContext, "", "the hook mixes an approved and a refused claim; none of it is re-injected as authority");
  });
});

describe("movement authority: the next-round hook never asserts a place or move the server did not approve (#1567)", () => {
  type Place = { id: number; at: string; body: string; goTo?: string };
  const bindSeats = (opts: {
    current: string;
    gm: string;
    seats: Place[];
    hook: string;
    extra?: Partial<Parameters<typeof bindGmLocationToSubmittedMovement>[0]["delta"]>;
  }) =>
    bindGmLocationToSubmittedMovement({
      opening: false,
      currentLocation: opts.current,
      proposedLocation: opts.gm,
      delta: {
        players: opts.seats.map((seat) => ({ participantId: seat.id, location: seat.goTo ?? opts.gm })),
        location: opts.gm,
        nextRoundContext: opts.hook,
        ...opts.extra,
      },
      submissions: opts.seats.map((seat): TrpgLocationPersistSubmission => ({ participantId: seat.id, body: seat.body })),
      sheetLocations: opts.seats.map((seat) => ({ participantId: seat.id, location: seat.at })),
    });

  it("A. guarding outside the lighthouse while the GM says the party went inside", () => {
    const bound = bindSeats({
      current: "곶 끝의 등대 외곽",
      gm: "곶 끝의 등대 내부",
      seats: [{ id: 1, at: "곶 끝의 등대 외곽", body: "등대 외곽에서 경비를 선다." }],
      hook: "렌은 등대 내부에 들어갔다. 외곽에서 종소리가 울렸다.",
    });
    assert.equal(bound.location, "곶 끝의 등대 외곽");
    assert.equal(bound.nextRoundContext, "");
  });

  it("B. staying on the customs second floor while the GM says the party went down to the first floor", () => {
    const bound = bindSeats({
      current: "세관 청사 2층",
      gm: "세관 청사 1층",
      seats: [{ id: 1, at: "세관 청사 2층", body: "2층 사무실의 장부를 살핀다." }],
      hook: "렌은 1층으로 내려갔다. 장부 사이에서 밀수 기록이 나왔다.",
    });
    assert.equal(bound.location, "세관 청사 2층");
    assert.equal(bound.nextRoundContext, "");
  });

  it("C. 2 humans + 2 AI apart: a group-move hook is not kept when only some seats really moved or one seat was already there", () => {
    const apart: Place[] = [
      { id: 1, at: "어시장", body: "어시장 장부를 살핀다." },
      { id: 2, at: "선원 조합 회관", body: "회관 게시판을 살핀다." },
      { id: 3, at: "세관 청사 1층", body: "세관 서류를 정리한다." },
      { id: 4, at: "선원 조합 회관", body: "회관 입구를 지킨다." },
    ];
    const alreadyThere = bindSeats({
      current: "선원 조합 회관",
      gm: "어시장",
      seats: apart,
      hook: "일행은 모두 어시장에 모였다. 상인이 소문을 전했다.",
    });
    assert.equal(alreadyThere.location, "선원 조합 회관");
    assert.equal(alreadyThere.nextRoundContext, "", "seat 1 standing in 어시장 does not approve the group's move");
    assert.equal(alreadyThere.delta.players?.some((patch) => patch.location !== undefined && patch.participantId !== 1), false);

    const partlyMoved = bindSeats({
      current: "선원 조합 회관",
      gm: "어시장",
      seats: apart.map((seat) =>
        seat.id === 3 ? { ...seat, body: "어시장으로 이동한다." } : seat
      ),
      hook: "일행은 모두 어시장에 모였다. 상인이 소문을 전했다.",
    });
    const placeById = new Map((partlyMoved.delta.players ?? []).map((patch) => [patch.participantId, patch.location]));
    assert.equal(placeById.get(3), "어시장", "the seat that declared it did move");
    assert.equal(placeById.get(2), undefined);
    assert.equal(partlyMoved.nextRoundContext, "", "the hook says everyone moved, but only one seat did");
  });

  it("D. clues and NPC facts reach the ledger through the typed delta even when the hook is cleared", () => {
    const bound = bindSeats({
      current: "곶 끝의 등대 외곽",
      gm: "곶 끝의 등대 내부",
      seats: [{ id: 1, at: "곶 끝의 등대 외곽", body: "등대 외곽에서 경비를 선다." }],
      hook: "렌은 등대 내부에 들어갔다. 종지기가 열쇠 이야기를 했다.",
      extra: { npcsAdd: ["종지기: 열쇠는 등대지기가 가졌다고 말했다"], flagsAdd: ["종소리가 세 번 울렸다"], questsAdd: ["등대 열쇠를 찾는다"] },
    });
    const ledger = applyCampaignLedger(
      { location: "곶 끝의 등대 외곽", nextRoundContext: "R4 이전 맥락", quests: [], npcs: [], worldFlags: [] },
      { ...bound.delta, location: bound.location, nextRoundContext: bound.nextRoundContext }
    );
    assert.equal(ledger.location, "곶 끝의 등대 외곽");
    assert.equal(ledger.nextRoundContext, "", "neither the refused move nor the older round's hook survives");
    assert.deepEqual(ledger.npcs, ["종지기: 열쇠는 등대지기가 가졌다고 말했다"]);
    assert.deepEqual(ledger.worldFlags, ["종소리가 세 번 울렸다"]);
    assert.deepEqual(ledger.quests, ["등대 열쇠를 찾는다"]);
  });

  it("a hook is kept when nothing was refused: an approved move for the whole party, an unchanged place, a persistent split", () => {
    const together = bindSeats({
      current: "마레노 부두",
      gm: "마레노 어시장",
      seats: [
        { id: 1, at: "마레노 부두", body: "어시장으로 가서 소문을 묻는다." },
        { id: 2, at: "마레노 부두", body: "렌과 함께 어시장으로 이동한다." },
      ],
      hook: "렌은 어시장 상인에게 소문을 물었다.",
    });
    assert.equal(together.nextRoundContext, "렌은 어시장 상인에게 소문을 물었다.");

    const split = bindGmLocationToSubmittedMovement({
      opening: false,
      currentLocation: "마레노 어시장",
      proposedLocation: "마레노 어시장",
      delta: { players: [], location: "마레노 어시장", nextRoundContext: "렌은 어시장, 현은 회관에서 각자 조사한다." },
      submissions: [
        { participantId: 1, body: "상인에게 말을 건다." },
        { participantId: 2, body: "회관 장부를 살핀다." },
      ],
      sheetLocations: [
        { participantId: 1, location: "마레노 어시장" },
        { participantId: 2, location: "선원 조합 회관" },
      ],
    });
    assert.equal(split.nextRoundContext, "렌은 어시장, 현은 회관에서 각자 조사한다.");
  });
});
