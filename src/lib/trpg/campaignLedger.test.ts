import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCampaignLedger,
  bindGmLocationToSubmittedMovement,
  emptyCampaignLedger,
} from "./campaignLedger";

describe("TRPG campaign ledger", () => {
  it("adds and removes quests, NPCs, and flags without dropping unrelated facts", () => {
    const first = applyCampaignLedger(emptyCampaignLedger(), {
      players: [],
      location: "여관",
      nextRoundContext: "문을 밀지 창을 볼지",
      questsAdd: ["밀서 찾기"],
      npcsAdd: ["여관주인"],
      flagsAdd: ["문_열림"],
    });
    assert.equal(first.location, "여관");
    assert.match(first.nextRoundContext, /문을 밀지/);
    const next = applyCampaignLedger(first, {
      players: [],
      questsAdd: ["밀서 찾기", "뒷문 열쇠"],
      flagsRemove: ["문_열림"],
      flagsAdd: ["열쇠_획득"],
      npcsRemove: ["없는NPC"],
    });
    assert.deepEqual(next.quests, ["밀서 찾기", "뒷문 열쇠"]);
    assert.deepEqual(next.npcs, ["여관주인"]);
    assert.deepEqual(next.worldFlags, ["열쇠_획득"]);
    assert.equal(next.nextRoundContext, first.nextRoundContext);
  });
});

describe("TRPG location persist bind", () => {
  const dock = "회린 부두";
  const tavern = "회린 주점";
  const tavernEntry = "한결은 회린의 낡은 주점 안으로 들어섰다.";

  function bind(opts: {
    opening?: boolean;
    proposed?: string;
    body?: string;
    participantId?: number;
    playerLocation?: string;
    tier?: string | null;
    extraPlayers?: Array<{ participantId: number; location?: string }>;
  }) {
    return bindGmLocationToSubmittedMovement({
      opening: opts.opening === true,
      currentLocation: dock,
      currentNextRoundContext: "부두에서 다음을 고른다.",
      proposedLocation: opts.proposed ?? tavern,
      delta: {
        players: [
          {
            participantId: opts.participantId ?? 1,
            location: opts.playerLocation ?? tavern,
          },
          ...(opts.extraPlayers ?? []),
        ],
        location: opts.proposed ?? tavern,
        nextRoundContext: tavernEntry,
      },
      submissions: opts.body
        ? [{ participantId: opts.participantId ?? 1, body: opts.body, tier: opts.tier }]
        : [],
      sheetLocations: [{ participantId: opts.participantId ?? 1, location: dock }],
    });
  }

  it("#1468 F: undeclared moon action does not accept tavern location or next-round lock-in", () => {
    const bound = bind({ body: "달을 주머니에 넣는다." });
    assert.equal(bound.location, dock);
    assert.equal(bound.nextRoundContext, "부두에서 다음을 고른다.");
    assert.equal(bound.delta.players?.[0]?.location, undefined);
  });

  it("declared traversal still accepts the named destination", () => {
    const bound = bind({ body: "주점으로 간다." });
    assert.equal(bound.location, tavern);
    assert.equal(bound.nextRoundContext, tavernEntry);
    assert.equal(bound.delta.players?.[0]?.location, tavern);
  });

  it("걸어간다 naming the destination still accepts — TRAVERSAL_VERBS misses 걷", () => {
    const bound = bind({ body: "주점으로 걸어간다." });
    assert.equal(bound.location, tavern);
    assert.equal(bound.delta.players?.[0]?.location, tavern);
  });

  it("T9/L5: NPC/world event without submitted movement does not persist relocation", () => {
    const bound = bind({
      body: "주변을 살핀다.",
      proposed: "적 소굴",
      playerLocation: "적 소굴",
    });
    assert.equal(bound.location, dock);
    assert.equal(bound.delta.players?.[0]?.location, undefined);
  });

  it("opening may set the starting place with no locked submissions", () => {
    const bound = bind({ opening: true, proposed: dock, playerLocation: dock });
    assert.equal(bound.location, dock);
  });

  it("keeps a second PC at the current place when only the first declared movement", () => {
    const bound = bindGmLocationToSubmittedMovement({
      opening: false,
      currentLocation: dock,
      currentNextRoundContext: "부두.",
      proposedLocation: tavern,
      delta: {
        players: [
          { participantId: 1, location: tavern },
          { participantId: 2, location: tavern },
        ],
        location: tavern,
        nextRoundContext: "주점.",
      },
      submissions: [
        { participantId: 1, body: "주점으로 간다." },
        { participantId: 2, body: "달을 주머니에 넣는다." },
      ],
      sheetLocations: [
        { participantId: 1, location: dock },
        { participantId: 2, location: dock },
      ],
    });
    assert.equal(bound.location, tavern);
    assert.equal(bound.delta.players?.[0]?.location, tavern);
    assert.equal(bound.delta.players?.[1]?.location, undefined);
  });

  it("A: 밖으로 나간다 does not accept an unnamed 성소", () => {
    const bound = bind({ body: "밖으로 나간다.", proposed: "성소", playerLocation: "성소" });
    assert.equal(bound.location, dock);
    assert.equal(bound.delta.players?.[0]?.location, undefined);
  });

  it("B: 주점을 바라본다 does not accept tavern relocation", () => {
    const bound = bind({ body: "주점을 바라본다." });
    assert.equal(bound.location, dock);
    assert.equal(bound.delta.players?.[0]?.location, undefined);
  });

  it("B extra: 회린의 날씨를 살핀다 does not accept 회린 주점", () => {
    const bound = bind({ body: "회린의 날씨를 살핀다." });
    assert.equal(bound.location, dock);
  });

  it("C: tavern declaration does not keep a sanctuary player location", () => {
    const bound = bind({ body: "주점으로 간다.", playerLocation: "성소" });
    assert.equal(bound.location, tavern);
    assert.equal(bound.delta.players?.[0]?.location, tavern);
  });

  it("D: stationary PC is compared to sheet location, not campaign location", () => {
    const bound = bindGmLocationToSubmittedMovement({
      opening: false,
      currentLocation: dock,
      currentNextRoundContext: "부두.",
      proposedLocation: dock,
      delta: {
        players: [
          { participantId: 1, location: dock },
          { participantId: 2, location: dock },
        ],
        location: dock,
        nextRoundContext: "부두.",
      },
      submissions: [
        { participantId: 1, body: "달을 주머니에 넣는다." },
        { participantId: 2, body: "주점 안을 살핀다." },
      ],
      sheetLocations: [
        { participantId: 1, location: dock },
        { participantId: 2, location: tavern },
      ],
    });
    assert.equal(bound.delta.players?.[1]?.location, undefined);
    assert.equal(bound.location, dock);
  });

  it("E: FAILURE does not persist the declared destination", () => {
    const bound = bindGmLocationToSubmittedMovement({
      opening: false,
      currentLocation: dock,
      currentNextRoundContext: "부두.",
      proposedLocation: tavern,
      delta: {
        players: [{ participantId: 1, location: tavern }],
        location: tavern,
        nextRoundContext: tavernEntry,
      },
      submissions: [{ participantId: 1, body: "급히 주점으로 간다.", tier: "CRITICAL_FAILURE" }],
      sheetLocations: [{ participantId: 1, location: dock }],
    });
    assert.equal(bound.location, dock);
    assert.equal(bound.delta.players?.[0]?.location, undefined);
  });
});
