import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign } from "./engineAdvance";
import { ensureTrpgTables } from "./schema";
import { loadCampaign } from "./store";
import {
  loadDurableReplySuggestions,
  parseReplySuggestions,
  requestTrpgReplySuggestions,
  resetTrpgReplySuggestionCooldownForTests,
  saveDurableReplySuggestions,
  type TrpgReplySuggestionRouteTelemetry,
} from "./replySuggestions";

const validJson = JSON.stringify({
  suggestions: [
    { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
    { stance: "neutral", actionType: "investigate", text: "경첩부터 살핀다." },
    { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
  ],
});

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(narration = "폐역에 찬 바람이 돈다."): string {
  return `<<<NARRATION>>>
${narration}
<<<DELTA>>>
{"players":[],"location":"폐역","next_round_context":"기다릴지","campaign_finished":false}`;
}

async function startedCampaign(db: Database.Database, secondUser = false): Promise<number> {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
    hostPersona: {
      personaId: 9,
      name: "렌",
      description: "차갑고 짧게 말한다.",
      gender: "other",
      speechExamples: "됐어. 내가 볼게.",
    },
  });
  if (secondUser) {
    const camp = loadCampaign(db, campaignId)!;
    joinTrpgCampaign(db, { code: camp.invite_code!, userId: 2, nickname: "태현" });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "태현", stats: EVEN_STATS });
  }
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  await startTrpgCampaign(db, {
    campaignId,
    userId: 1,
    deps: { skipBilling: true, gmCall: async () => ({ text: gmText() }) },
  });
  return campaignId;
}

function participantId(db: Database.Database, campaignId: number, userId: number): number {
  return (
    db
      .prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?`)
      .get(campaignId, userId) as { id: number }
  ).id;
}

function roundId(db: Database.Database, campaignId: number): number {
  return (
    db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number DESC LIMIT 1`)
      .get(campaignId) as { id: number }
  ).id;
}

function captureRouteLogs(fn: () => Promise<unknown>): Promise<TrpgReplySuggestionRouteTelemetry[]> {
  const logs: TrpgReplySuggestionRouteTelemetry[] = [];
  const previous = console.info;
  console.info = ((label: unknown, payload: Record<string, unknown>) => {
    if (label === "[trpg-reply-suggestion]" && payload.kind === "trpg_reply_suggestion_route") {
      logs.push(payload as TrpgReplySuggestionRouteTelemetry);
    }
  }) as typeof console.info;
  return fn()
    .then(() => logs)
    .catch(() => logs)
    .finally(() => {
      console.info = previous;
    });
}

describe("TRPG reply suggestion durable persistence", () => {
  beforeEach(() => {
    resetTrpgReplySuggestionCooldownForTests();
  });

  it("E. durable same round — first provider call persists, reload serves DB without provider", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let providerCalls = 0;
    const first = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        providerCalls += 1;
        return { text: validJson, model: "deepseek-v4-flash-0731" };
      },
    });
    assert.equal(providerCalls, 1);
    assert.equal(first.suggestions.length, 3);

    resetTrpgReplySuggestionCooldownForTests();
    const logs = await captureRouteLogs(async () => {
      const second = await requestTrpgReplySuggestions(db, {
        campaignId,
        userId: 1,
        complete: async () => {
          providerCalls += 1;
          return { text: validJson, model: "deepseek-v4-flash-0731" };
        },
      });
      assert.equal(providerCalls, 1);
      assert.deepEqual(
        second.suggestions.map((row) => row.text),
        first.suggestions.map((row) => row.text)
      );
    });
    assert.equal(logs.at(-1)?.cache_source, "durable_db");
    db.close();
  });

  it("F. server restart simulation — inflight cleared, DB hit avoids provider", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    const rid = roundId(db, campaignId);
    const pid = participantId(db, campaignId, 1);
    const suggestions = parseReplySuggestions(validJson);
    saveDurableReplySuggestions(db, rid, pid, suggestions);
    resetTrpgReplySuggestionCooldownForTests();

    let providerCalls = 0;
    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        providerCalls += 1;
        return { text: validJson, model: "deepseek-v4-flash-0731" };
      },
    });
    assert.equal(providerCalls, 0);
    db.close();
  });

  it("G. navigation before client save — server success persists to DB for re-entry", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    const rid = roundId(db, campaignId);
    const pid = participantId(db, campaignId, 1);

    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => ({ text: validJson, model: "deepseek-v4-flash-0731" }),
    });
    const stored = loadDurableReplySuggestions(db, rid, pid);
    assert.ok(stored);
    assert.equal(stored.length, 3);

    resetTrpgReplySuggestionCooldownForTests();
    let providerCalls = 0;
    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        providerCalls += 1;
        return { text: validJson, model: "deepseek-v4-flash-0731" };
      },
    });
    assert.equal(providerCalls, 0);
    db.close();
  });

  it("H. new round — previous DB result is not reused", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    const firstRoundId = roundId(db, campaignId);
    const pid = participantId(db, campaignId, 1);
    const firstRoundNumber = (
      db.prepare(`SELECT round_number FROM trpg_rounds WHERE id=?`).get(firstRoundId) as {
        round_number: number;
      }
    ).round_number;

    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => ({ text: validJson, model: "deepseek-v4-flash-0731" }),
    });
    assert.ok(loadDurableReplySuggestions(db, firstRoundId, pid));

    const nextRoundNumber = firstRoundNumber + 1;
    const inserted = db
      .prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?,?, 'ACTION_INPUT')`)
      .run(campaignId, nextRoundNumber);
    const newRoundId = Number(inserted.lastInsertRowid);
    db.prepare(
      `INSERT INTO trpg_action_submissions (round_id, participant_id, body, locked, source) VALUES (?,?,?,0,'human')`
    ).run(newRoundId, pid, "draft for round 2");

    resetTrpgReplySuggestionCooldownForTests();
    let providerCalls = 0;
    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        providerCalls += 1;
        return { text: validJson, model: "deepseek-v4-flash-0731" };
      },
    });
    assert.equal(providerCalls, 1);
    assert.ok(loadDurableReplySuggestions(db, newRoundId, pid));
    db.close();
  });

  it("I. multiplayer — same round participant A/B suggestions stay separate", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db, true);
    const rid = roundId(db, campaignId);
    const hostPid = participantId(db, campaignId, 1);
    const guestPid = participantId(db, campaignId, 2);

    const hostJson = JSON.stringify({
      suggestions: [
        { stance: "good", actionType: "support", text: "HOST_GOOD_ACTION_TEXT." },
        { stance: "neutral", actionType: "investigate", text: "HOST_NEUTRAL_ACTION_TEXT." },
        { stance: "evil", actionType: "persuade", text: "HOST_EVIL_ACTION_TEXT." },
      ],
    });
    const guestJson = JSON.stringify({
      suggestions: [
        { stance: "good", actionType: "support", text: "GUEST_GOOD_ACTION_TEXT." },
        { stance: "neutral", actionType: "investigate", text: "GUEST_NEUTRAL_ACTION_TEXT." },
        { stance: "evil", actionType: "persuade", text: "GUEST_EVIL_ACTION_TEXT." },
      ],
    });

    db.prepare(
      `INSERT INTO trpg_action_submissions (round_id, participant_id, body, locked, source) VALUES (?,?,?,0,'human')`
    ).run(rid, guestPid, "guest draft");

    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => ({ text: hostJson, model: "deepseek-v4-flash-0731" }),
    });
    await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 2,
      complete: async () => ({ text: guestJson, model: "deepseek-v4-flash-0731" }),
    });

    const hostStored = loadDurableReplySuggestions(db, rid, hostPid);
    const guestStored = loadDurableReplySuggestions(db, rid, guestPid);
    assert.match(hostStored?.[0]?.text ?? "", /HOST_GOOD/);
    assert.match(guestStored?.[0]?.text ?? "", /GUEST_GOOD/);
    db.close();
  });

  it("J. concurrent request — two simultaneous calls invoke provider at most once", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let providerCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const complete = async () => {
      providerCalls += 1;
      await gate;
      return { text: validJson, model: "deepseek-v4-flash-0731" };
    };
    const first = requestTrpgReplySuggestions(db, { campaignId, userId: 1, complete });
    await new Promise((r) => setTimeout(r, 20));
    const second = requestTrpgReplySuggestions(db, { campaignId, userId: 1, complete });
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(providerCalls, 1);
    assert.deepEqual(
      a.suggestions.map((row) => row.text),
      b.suggestions.map((row) => row.text)
    );
    db.close();
  });
});
