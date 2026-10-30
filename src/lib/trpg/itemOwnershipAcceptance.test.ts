import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds } from "@/lib/points";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadSheetSnapshots } from "./engineSheets";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { inventoryQuantity } from "./inventory";
import { ensureTrpgTables } from "./schema";
import { insertParticipant } from "./store";

const HANDLE = "서랍 손잡이";
const LEDGER = "세관 밀수 원본 장부";
const POTION = "회복약";

type PlayerPatch = Record<string, unknown>;

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points REAL NOT NULL DEFAULT 0, creator_points REAL NOT NULL DEFAULT 0);
    CREATE TABLE point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '', creator_id INTEGER, official INTEGER NOT NULL DEFAULT 0);
  `);
  ensureTrpgTables(db);
  return db;
}

type World = Awaited<ReturnType<typeof startWorld>>;

/**
 * Scripted GM: `players` is the delta the next GM call returns. `openingPlayers` is
 * used for the opening call. No provider call is ever made.
 */
async function startWorld(opts: { humans: 1 | 2; ai?: boolean; openingPlayers: (seats: Seats) => PlayerPatch[]; billing?: boolean }) {
  const db = memoryDb();
  for (const [id, nickname] of [
    [1, "렌"],
    [2, "현"],
  ] as const) {
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (?,?,?,0)`).run(id, `${id}@t`, nickname);
    if (opts.billing) creditPointsWithIds(db, id, 50_000, "PAID", `credit-${id}`);
  }
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  if (opts.humans === 2) {
    const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string })
      .invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "현" });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "현", stats: EVEN_STATS });
  }
  const seatOf = (userId: number) =>
    (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?`).get(campaignId, userId) as { id: number }).id;
  let aiId = 0;
  if (opts.ai) {
    aiId = insertParticipant(db, {
      campaignId,
      slotIndex: 5,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "서하",
      persona: { description: "서하", greeting: "", systemPrompt: "" },
    });
    writeSheet(db, campaignId, aiId, "서하", EVEN_STATS, "마레노 부두");
  }
  const seats: Seats = { a: seatOf(1), b: opts.humans === 2 ? seatOf(2) : 0, ai: aiId };
  const state = {
    players: [] as PlayerPatch[],
    narration: "장면이 이어진다. GM: 무엇을 하겠는가?",
    inputs: [] as string[],
    calls: 0,
    botTake: "",
    botLock: "",
    billingFault: undefined as TrpgEngineDeps["billingFault"],
  };
  const usage = { modelId: "deepseek-v4-pro", inputTokens: 2000, outputTokens: 600 };
  const deps = (): TrpgEngineDeps => ({
    skipBilling: !opts.billing,
    billingFault: state.billingFault,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({
      text: state.botLock || (state.botTake ? `${state.botTake}를 받는다.` : "조용히 주변을 살핀다."),
    }),
    gmCall: async ({ user }) => {
      state.calls += 1;
      state.inputs.push(user);
      return {
        text: JSON.stringify({
          narration: state.narration,
          delta: { players: state.players, location: "마레노 부두", next_round_context: "", campaign_finished: false },
        }),
        usage,
      };
    },
  });
  state.players = opts.openingPlayers(seats);
  await startTrpgCampaign(db, { campaignId, userId: 1, deps: deps() });
  state.players = [];
  return { db, campaignId, seats, state, deps };
}

type Seats = { a: number; b: number; ai: number };

function roundNumber(w: Pick<World, "db" | "campaignId">): number {
  return (w.db.prepare(`SELECT MAX(round_number) AS n FROM trpg_rounds WHERE campaign_id=?`).get(w.campaignId) as { n: number }).n;
}

type Submit = { userId: number; body?: string; accept?: string[]; fromRound?: number };

function submit(w: World, s: Submit) {
  const fromRound = s.fromRound ?? roundNumber(w) - 1;
  submitTrpgAction(w.db, {
    campaignId: w.campaignId,
    userId: s.userId,
    body: s.body ?? "",
    acceptItems: s.accept?.map((name) => ({ name, fromRound })),
  });
}

async function play(w: World, submits: Submit[]) {
  for (const s of submits) submit(w, s);
  await advanceTrpgCampaign(w.db, { campaignId: w.campaignId, userId: 1, deps: w.deps() });
}

function held(w: Pick<World, "db" | "campaignId">, seat: number, name: string): number {
  const sheet = loadSheetSnapshots(w.db, w.campaignId).find((row) => row.participantId === seat);
  return sheet ? inventoryQuantity(sheet.inventory, name) : -1;
}

function committedHumanPatch(w: World, round: number, seat: number) {
  const row = w.db
    .prepare(
      `SELECT g.structured_json FROM trpg_gm_messages g JOIN trpg_rounds r ON r.id=g.round_id WHERE r.campaign_id=? AND r.round_number=?`
    )
    .get(w.campaignId, round) as { structured_json: string };
  const parsed = JSON.parse(row.structured_json) as { delta: { players: Array<Record<string, unknown>> } };
  return parsed.delta.players.find((p) => p.participantId === seat);
}

describe("human PC item ownership needs the player's acceptance", () => {
  it("1. inspecting a drawer handle never owns it, even when the GM writes inventoryAdd", async () => {
    const w = await startWorld({ humans: 1, openingPlayers: () => [] });
    w.state.players = [{ participantId: w.seats.a, inventoryAdd: [HANDLE] }];
    await play(w, [{ userId: 1, body: "서랍 손잡이를 살펴본다." }]);
    assert.equal(held(w, w.seats.a, HANDLE), 0);
    assert.equal(committedHumanPatch(w, 1, w.seats.a)?.inventoryAdd, undefined, "the committed record carries no unaccepted add");
    assert.equal(loadTrpgSnapshot(w.db, w.campaignId, 1)?.myItemOffers ?? null, null, "an add is not an offer");
  });

  it("2-3. an offer is shown to its seat but not owned; the next turn's acceptance owns it once", async () => {
    const w = await startWorld({ humans: 1, openingPlayers: (s) => [{ participantId: s.a, itemOffers: [HANDLE] }] });
    const snap = loadTrpgSnapshot(w.db, w.campaignId, 1);
    assert.deepEqual(snap?.myItemOffers, { fromRound: 0, items: [{ name: HANDLE, held: 0 }] });
    assert.equal(held(w, w.seats.a, HANDLE), 0);

    await play(w, [{ userId: 1, accept: [HANDLE] }]);
    assert.equal(held(w, w.seats.a, HANDLE), 1);
    const stored = w.db.prepare(`SELECT body, accepted_items_json FROM trpg_action_submissions WHERE locked=1`).get() as {
      body: string;
      accepted_items_json: string;
    };
    assert.deepEqual(JSON.parse(stored.accepted_items_json), { fromRound: 0, items: [HANDLE] });
    assert.equal(stored.body, "서랍 손잡이를 받는다.", "an accept-only submit needs no free-text sentence");
    assert.match(w.state.inputs.at(-1) ?? "", /\[ITEMS ACCEPTED BY THIS PC — server-confirmed, now held\]\n서랍 손잡이/);
    assert.equal(loadTrpgSnapshot(w.db, w.campaignId, 1)?.myItemOffers ?? null, null, "the offer is spent");
  });

  it("4. not accepting keeps the item unowned, tells the GM it is not a refusal, and lets the offer expire and be renewed", async () => {
    const w = await startWorld({ humans: 1, openingPlayers: (s) => [{ participantId: s.a, itemOffers: [HANDLE] }] });
    await play(w, [{ userId: 1, body: "방을 둘러본다." }]);
    assert.equal(held(w, w.seats.a, HANDLE), 0);
    const gmInput = w.state.inputs.at(-1) ?? "";
    assert.match(gmInput, /\[ITEM OFFERS — offered last round, NOT held, not accepted this round\]/);
    assert.match(gmInput, /That is not a refusal; the offer may be made again/);
    assert.equal(loadTrpgSnapshot(w.db, w.campaignId, 1)?.myItemOffers ?? null, null, "the old offer expired");

    assert.throws(() => submit(w, { userId: 1, accept: [HANDLE], fromRound: 0 }), /지난 장면|제안/);

    w.state.players = [{ participantId: w.seats.a, itemOffers: [HANDLE] }];
    await play(w, [{ userId: 1, body: "다시 서랍을 본다." }]);
    await play(w, [{ userId: 1, accept: [HANDLE] }]);
    assert.equal(held(w, w.seats.a, HANDLE), 1, "a renewed offer can be accepted");
  });

  it("5-6. an unoffered, stale, other-seat, or malformed acceptance is rejected before anything is stored", async () => {
    const w = await startWorld({
      humans: 2,
      openingPlayers: (s) => [{ participantId: s.b, itemOffers: [HANDLE] }],
    });
    const locked = () => (w.db.prepare(`SELECT COUNT(*) AS n FROM trpg_action_submissions WHERE locked=1`).get() as { n: number }).n;
    assert.throws(() => submit(w, { userId: 1, accept: [HANDLE] }), /제안/, "seat A cannot accept seat B's offer");
    assert.throws(() => submit(w, { userId: 2, accept: [LEDGER] }), /제안받은 아이템이 아닙니다/, "an unoffered item");
    assert.throws(() => submit(w, { userId: 2, accept: [HANDLE], fromRound: 7 }), /지난 장면/, "a stale source round");
    assert.throws(
      () =>
        submitTrpgAction(w.db, {
          campaignId: w.campaignId,
          userId: 2,
          body: "",
          acceptItems: [{ name: HANDLE }],
        }),
      /올바르지 않습니다/
    );
    assert.equal(locked(), 0);
    assert.equal(loadTrpgSnapshot(w.db, w.campaignId, 1)?.myItemOffers ?? null, null, "seat A is never shown seat B's offer");
    assert.equal(loadTrpgSnapshot(w.db, w.campaignId, 2)?.myItemOffers?.items[0]?.name, HANDLE);
  });

  it("7. an accept-only submit works and a typed action keeps its own text", async () => {
    const w = await startWorld({ humans: 1, openingPlayers: (s) => [{ participantId: s.a, itemOffers: [HANDLE, LEDGER] }] });
    submit(w, { userId: 1, body: "  장부를   조용히 넘겨본다.  ", accept: [LEDGER] });
    const body = (w.db.prepare(`SELECT body FROM trpg_action_submissions WHERE locked=1`).get() as { body: string }).body;
    assert.equal(body, "장부를 조용히 넘겨본다.");
    await advanceTrpgCampaign(w.db, { campaignId: w.campaignId, userId: 1, deps: w.deps() });
    assert.equal(held(w, w.seats.a, LEDGER), 1);
    assert.equal(held(w, w.seats.a, HANDLE), 0, "unselected offers are never auto-accepted");
  });

  it("8. a valid re-acquisition of a consumable adds one unit per acceptance", async () => {
    const w = await startWorld({ humans: 1, openingPlayers: (s) => [{ participantId: s.a, itemOffers: [POTION] }] });
    const offered = { participantId: w.seats.a, itemOffers: [POTION] };
    await play(w, [{ userId: 1, accept: [POTION] }]);
    assert.equal(held(w, w.seats.a, POTION), 1);
    w.state.players = [offered];
    await play(w, [{ userId: 1, body: "상인에게 한 병 더 부탁한다." }]);
    assert.equal(loadTrpgSnapshot(w.db, w.campaignId, 1)?.myItemOffers?.items[0]?.held, 1, "the chip shows the held quantity");
    w.state.players = [];
    await play(w, [{ userId: 1, accept: [POTION] }]);
    assert.equal(held(w, w.seats.a, POTION), 2);
  });

  it("a locked submission is immutable, so a double click cannot accept twice", async () => {
    const w = await startWorld({ humans: 2, openingPlayers: (s) => [{ participantId: s.a, itemOffers: [POTION] }] });
    submit(w, { userId: 1, accept: [POTION] });
    assert.throws(() => submit(w, { userId: 1, accept: [POTION] }), /이미 제출했습니다/);
    assert.throws(() => submit(w, { userId: 1, body: "다른 행동" }), /이미 제출했습니다/);
    assert.equal(loadTrpgSnapshot(w.db, w.campaignId, 1)?.myDraft?.locked, true);
    assert.deepEqual(loadTrpgSnapshot(w.db, w.campaignId, 1)?.myDraft?.acceptedItems, [POTION], "the lock survives a reload");
    await play(w, [{ userId: 2, body: "지켜본다." }]);
    assert.equal(held(w, w.seats.a, POTION), 1);
  });

  it("multi-human: each seat has its own offers and per-seat same-name quantity; one shared ledger is NOT deduplicated", async () => {
    const w = await startWorld({
      humans: 2,
      openingPlayers: (s) => [
        { participantId: s.a, itemOffers: [POTION] },
        { participantId: s.b, itemOffers: [POTION, LEDGER] },
      ],
    });
    assert.deepEqual(
      loadTrpgSnapshot(w.db, w.campaignId, 1)?.myItemOffers?.items.map((i) => i.name),
      [POTION]
    );
    await play(w, [
      { userId: 1, accept: [POTION] },
      { userId: 2, accept: [POTION, LEDGER] },
    ]);
    assert.equal(held(w, w.seats.a, POTION), 1);
    assert.equal(held(w, w.seats.b, POTION), 1, "consumables are separate per seat");
    assert.equal(held(w, w.seats.a, LEDGER), 0);
    assert.equal(held(w, w.seats.b, LEDGER), 1);
    // Known limit: items are name-only. If the GM offers the same single object to two
    // seats, both can accept it. The server cannot tell them apart without item ids.
    w.state.players = [
      { participantId: w.seats.a, itemOffers: [LEDGER] },
      { participantId: w.seats.b, itemOffers: [LEDGER] },
    ];
    await play(w, [{ userId: 1, body: "본다." }, { userId: 2, body: "본다." }]);
    await play(w, [
      { userId: 1, accept: [LEDGER] },
      { userId: 2, accept: [LEDGER] },
    ]);
    assert.equal(held(w, w.seats.a, LEDGER), 1);
    assert.equal(held(w, w.seats.b, LEDGER), 2);
  });

  it("an AI companion keeps a locked take and never carries itemOffers", async () => {
    const w = await startWorld({ humans: 1, ai: true, openingPlayers: () => [] });
    w.state.botTake = HANDLE;
    w.state.players = [
      { participantId: w.seats.ai, inventoryAdd: [HANDLE], itemOffers: [LEDGER] },
      { participantId: w.seats.a, inventoryAdd: [POTION] },
    ];
    await play(w, [{ userId: 1, body: "주변을 살핀다." }]);
    assert.equal(held(w, w.seats.ai, HANDLE), 1);
    assert.equal(held(w, w.seats.a, POTION), 0);
    assert.equal(committedHumanPatch(w, 1, w.seats.ai)?.itemOffers, undefined);
  });

  it("an AI companion mention, refusal, or wish never owns a GM inventoryAdd", async () => {
    const packet = "봉투";
    for (const lock of [
      "봉투를 살펴본다.",
      "봉투를 받지 않는다. 문을 닫는다.",
      "봉투를 받으면 좋겠다. 문을 닫는다.",
      '"봉투는 네가 챙겨." 문을 닫는다.',
    ]) {
      const w = await startWorld({ humans: 1, ai: true, openingPlayers: () => [] });
      w.state.botLock = lock;
      w.state.players = [{ participantId: w.seats.ai, inventoryAdd: [packet] }];
      await play(w, [{ userId: 1, body: "주변을 살핀다." }]);
      assert.equal(held(w, w.seats.ai, packet), 0, lock);
    }
  });

  it("an AI companion looking then taking another item owns only the taken item", async () => {
    const w = await startWorld({ humans: 1, ai: true, openingPlayers: () => [] });
    w.state.botLock = "봉투를 살펴본 뒤 칼을 받는다.";
    w.state.players = [{ participantId: w.seats.ai, inventoryAdd: ["봉투", "칼"] }];
    await play(w, [{ userId: 1, body: "주변을 살핀다." }]);
    assert.equal(held(w, w.seats.ai, "봉투"), 0);
    assert.equal(held(w, w.seats.ai, "칼"), 1);
  });

  it("an AI companion taking a sheath owns the sheath and not a shorter blade name", async () => {
    const w = await startWorld({ humans: 1, ai: true, openingPlayers: () => [] });
    w.state.botLock = "칼집을 받는다.";
    w.state.players = [{ participantId: w.seats.ai, inventoryAdd: ["칼", "칼집"] }];
    await play(w, [{ userId: 1, body: "주변을 살핀다." }]);
    assert.equal(held(w, w.seats.ai, "칼"), 0);
    assert.equal(held(w, w.seats.ai, "칼집"), 1);
  });

  it("an AI companion taking a named packet does not own a shorter packet name", async () => {
    const w = await startWorld({ humans: 1, ai: true, openingPlayers: () => [] });
    w.state.botLock = "볶은 메밀 봉투를 받는다.";
    w.state.players = [{ participantId: w.seats.ai, inventoryAdd: ["봉투", "볶은 메밀 봉투"] }];
    await play(w, [{ userId: 1, body: "주변을 살핀다." }]);
    assert.equal(held(w, w.seats.ai, "봉투"), 0);
    assert.equal(held(w, w.seats.ai, "볶은 메밀 봉투"), 1);
  });

  it("an AI companion past-tense take owns the named item", async () => {
    const packet = "봉투";
    const w = await startWorld({ humans: 1, ai: true, openingPlayers: () => [] });
    w.state.botLock = "봉투를 받았다.";
    w.state.players = [{ participantId: w.seats.ai, inventoryAdd: [packet] }];
    await play(w, [{ userId: 1, body: "주변을 살핀다." }]);
    assert.equal(held(w, w.seats.ai, packet), 1);
  });

  it("an AI companion keeps a packed take of the named item", async () => {
    const packet = "봉투";
    const w = await startWorld({ humans: 1, ai: true, openingPlayers: () => [] });
    w.state.botLock = "봉투를 챙겨 가방에 넣는다.";
    w.state.players = [{ participantId: w.seats.ai, inventoryAdd: [packet] }];
    await play(w, [{ userId: 1, body: "주변을 살핀다." }]);
    assert.equal(held(w, w.seats.ai, packet), 1);
  });

  it("an AI companion speech-only lock never owns a GM inventoryAdd", async () => {
    const w = await startWorld({ humans: 1, ai: true, openingPlayers: () => [] });
    w.state.players = [
      { participantId: w.seats.ai, inventoryAdd: [HANDLE], itemOffers: [LEDGER] },
    ];
    await play(w, [{ userId: 1, body: "주변을 살핀다." }]);
    assert.equal(held(w, w.seats.ai, HANDLE), 0);
    assert.equal(committedHumanPatch(w, 1, w.seats.ai)?.inventoryAdd, undefined);
    assert.equal(committedHumanPatch(w, 1, w.seats.ai)?.itemOffers, undefined);
  });

  it("regenerate neither adds, drops, nor swaps committed offers and grants", async () => {
    const w = await startWorld({ humans: 1, openingPlayers: (s) => [{ participantId: s.a, itemOffers: [HANDLE] }] });
    w.state.players = [{ participantId: w.seats.a, itemOffers: [LEDGER] }];
    await play(w, [{ userId: 1, accept: [HANDLE] }]);
    const before = committedHumanPatch(w, 1, w.seats.a);
    assert.deepEqual(before?.itemOffers, [LEDGER]);
    assert.deepEqual(before?.inventoryAdd, [HANDLE]);

    w.state.narration = "서랍 손잡이가 손에 쥐어졌고 복도가 조용히 울린다. GM: 무엇을 하겠는가?";
    w.state.players = [{ participantId: w.seats.a, itemOffers: [POTION], inventoryAdd: [POTION, HANDLE] }];
    await regenerateTrpgNarration(w.db, { campaignId: w.campaignId, userId: 1, deps: w.deps() });
    const after = committedHumanPatch(w, 1, w.seats.a);
    assert.deepEqual(after?.itemOffers, [LEDGER], "the committed offer survives the rewrite");
    assert.deepEqual(after?.inventoryAdd, [HANDLE], "the committed grant survives the rewrite");
    assert.equal(held(w, w.seats.a, HANDLE), 1, "a rewrite never grants again");
    assert.equal(held(w, w.seats.a, POTION), 0);
    assert.equal(loadTrpgSnapshot(w.db, w.campaignId, 1)?.myItemOffers?.items[0]?.name, LEDGER, "the next round still offers the committed item");
  });

  it("recovery from a pending result applies the acceptance exactly once", async () => {
    const w = await startWorld({ humans: 1, billing: true, openingPlayers: (s) => [{ participantId: s.a, itemOffers: [POTION] }] });
    w.state.billingFault = "billing_persist";
    submit(w, { userId: 1, accept: [POTION] });
    const failed = await advanceTrpgCampaign(w.db, { campaignId: w.campaignId, userId: 1, deps: w.deps() });
    assert.equal(failed.round.phase, "ERROR_RECOVERY");
    assert.equal(held(w, w.seats.a, POTION), 0, "nothing is owned before the commit");
    const callsAtFault = w.state.calls;

    w.state.billingFault = undefined;
    await advanceTrpgCampaign(w.db, { campaignId: w.campaignId, userId: 1, deps: w.deps() });
    assert.equal(w.state.calls, callsAtFault, "recovery reuses the pending GM result");
    assert.equal(held(w, w.seats.a, POTION), 1);
    await advanceTrpgCampaign(w.db, { campaignId: w.campaignId, userId: 1, deps: w.deps() });
    assert.equal(held(w, w.seats.a, POTION), 1, "a repeated advance does not acquire twice");
  });

  it("an existing database without the new column is migrated and old rows read as no acceptance", () => {
    const db = memoryDb();
    db.exec(`ALTER TABLE trpg_action_submissions DROP COLUMN accepted_items_json`);
    ensureTrpgTables(db);
    const columns = (db.prepare(`PRAGMA table_info(trpg_action_submissions)`).all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(columns.includes("accepted_items_json"));
    db.close();
  });
});
