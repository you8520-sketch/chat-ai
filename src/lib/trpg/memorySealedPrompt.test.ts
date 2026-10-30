import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { clipTrpgChars } from "./clip";
import {
  buildTrpgMemoryPromptBlock,
  formatSealedSummariesForPrompt,
  loadSealedSummaries,
  loadSealedSummaryRows,
  persistRoundSummary,
  type TrpgSealedSummaryRow,
} from "./memory";
import { ensureTrpgTables } from "./schema";
import { TRPG_SEALED_PROMPT_MAX_CHARS } from "./types";
import { buildHorizonPromptSections, persistMemoryEvents, type TrpgMemoryEventDraft } from "./memoryHorizon";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function syntheticRows(count: number, charsEach: number, prefix = "SYN"): TrpgSealedSummaryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    roundStart: index,
    roundEnd: index,
    summary: `${prefix}_R${index}_${"가".repeat(Math.max(1, charsEach - prefix.length - 6))}`,
  }));
}

function legacyHeadClipJoin(rows: TrpgSealedSummaryRow[]): string {
  const combined = rows
    .map((row) => row.summary.trim())
    .filter(Boolean)
    .join("\n");
  return clipTrpgChars(combined, TRPG_SEALED_PROMPT_MAX_CHARS);
}

describe("TRPG sealed summary prompt budget (#P3-5A)", () => {
  it("legacy head-clip drops the newest marker; newest-first keeps it", () => {
    const rows = syntheticRows(20, 200);
    const legacy = legacyHeadClipJoin(rows);
    const formatted = formatSealedSummariesForPrompt(rows);
    assert.match(legacy, /SYN_R0_/);
    assert.doesNotMatch(legacy, /SYN_R19_/);
    assert.match(formatted, /SYN_R19_/);
    assert.doesNotMatch(formatted, /SYN_R0_/);
    assert.ok(Array.from(formatted).length <= TRPG_SEALED_PROMPT_MAX_CHARS);
  });

  it("keeps all summaries when total length is under the budget", () => {
    const rows = syntheticRows(3, 400);
    const formatted = formatSealedSummariesForPrompt(rows);
    assert.match(formatted, /SYN_R0_/);
    assert.match(formatted, /SYN_R2_/);
    assert.equal(formatted, rows.map((row) => row.summary).join("\n"));
  });

  it("keeps exact-budget join without dropping the newest segment", () => {
    const a = "A".repeat(1249);
    const b = "B".repeat(1250);
    const formatted = formatSealedSummariesForPrompt([
      { roundStart: 0, roundEnd: 0, summary: a },
      { roundStart: 1, roundEnd: 1, summary: b },
    ]);
    assert.equal(formatted, `${a}\n${b}`);
    assert.equal(Array.from(formatted).length, TRPG_SEALED_PROMPT_MAX_CHARS);
  });

  it("skips empty summaries and never joins partial sentences", () => {
    const rows = [
      { roundStart: 0, roundEnd: 0, summary: "   " },
      { roundStart: 1, roundEnd: 1, summary: "KEEP_ME" },
    ];
    assert.equal(formatSealedSummariesForPrompt(rows), "KEEP_ME");
  });

  it("prefers the newest 1–3 summaries when many short turns exceed the budget", () => {
    const rows = syntheticRows(20, 180);
    const formatted = formatSealedSummariesForPrompt(rows);
    assert.match(formatted, /SYN_R19_/);
    assert.doesNotMatch(formatted, /SYN_R0_/);
    assert.ok(formatted.split("\n").length >= 1);
  });

  it("does not skip a long middle summary to adopt a shorter older one (budget 10)", () => {
    const rows: TrpgSealedSummaryRow[] = [
      { roundStart: 0, roundEnd: 0, summary: "A" },
      { roundStart: 1, roundEnd: 1, summary: "MIDDLE123" },
      { roundStart: 2, roundEnd: 2, summary: "NEWEST" },
    ];
    const formatted = formatSealedSummariesForPrompt(rows, 10);
    assert.equal(formatted, "NEWEST");
    assert.doesNotMatch(formatted, /^A$/m);
    assert.doesNotMatch(formatted, /MIDDLE123/);
  });

  it("head-tails an oversized newest summary instead of keeping only OLD (budget 10)", () => {
    const rows: TrpgSealedSummaryRow[] = [
      { roundStart: 0, roundEnd: 0, summary: "OLD" },
      { roundStart: 1, roundEnd: 1, summary: "NEWEST_TOO_LONG" },
    ];
    const formatted = formatSealedSummariesForPrompt(rows, 10);
    assert.match(formatted, /NEWES/);
    assert.doesNotMatch(formatted, /^OLD$/);
    assert.ok(Array.from(formatted).length <= 10);
    assert.equal(formatSealedSummariesForPrompt([rows[1]!], 10), formatted);
  });

  function assertContiguousSuffix(rows: TrpgSealedSummaryRow[], formatted: string): void {
    const lines = formatted.split("\n");
    const indices = lines.map((line) => {
      const hit = rows.findIndex((row) => row.summary === line);
      assert.ok(hit >= 0, `unexpected line in output: ${line.slice(0, 40)}`);
      return hit;
    });
    for (let i = 1; i < indices.length; i += 1) {
      assert.equal(indices[i], indices[i - 1]! + 1, "output must be a contiguous time-ordered suffix");
    }
  }

  it("20 short summaries: newest included, contiguous suffix, chronological, bounded, deterministic", () => {
    const rows = syntheticRows(20, 180);
    const formatted = formatSealedSummariesForPrompt(rows);
    assert.match(formatted, /SYN_R19_/);
    assertContiguousSuffix(rows, formatted);
    assert.ok(Array.from(formatted).length <= TRPG_SEALED_PROMPT_MAX_CHARS);
    assert.equal(formatted, formatSealedSummariesForPrompt(rows));
  });

  it("100 short summaries: newest included, contiguous suffix, chronological, bounded, deterministic", () => {
    const rows = syntheticRows(100, 80);
    const formatted = formatSealedSummariesForPrompt(rows);
    assert.match(formatted, /SYN_R99_/);
    assertContiguousSuffix(rows, formatted);
    assert.ok(Array.from(formatted).length <= TRPG_SEALED_PROMPT_MAX_CHARS);
    assert.equal(formatted, formatSealedSummariesForPrompt(rows));
  });

  it("scales to long campaigns with bounded prompt size", () => {
    const rows = syntheticRows(100, 80);
    const formatted = formatSealedSummariesForPrompt(rows);
    assert.match(formatted, /SYN_R99_/);
    assert.doesNotMatch(formatted, /SYN_R0_/);
    assert.ok(Array.from(formatted).length <= TRPG_SEALED_PROMPT_MAX_CHARS);
    const again = formatSealedSummariesForPrompt(rows);
    assert.equal(formatted, again);
  });

  it("uses head-tail only when a single summary alone exceeds the budget", () => {
    const long = `LONG_${"가".repeat(TRPG_SEALED_PROMPT_MAX_CHARS + 200)}`;
    const formatted = formatSealedSummariesForPrompt([{ roundStart: 0, roundEnd: 0, summary: long }]);
    assert.ok(formatted.includes("…"));
    assert.ok(Array.from(formatted).length <= TRPG_SEALED_PROMPT_MAX_CHARS);
    assert.match(formatted, /LONG_/);
  });

  it("persists recent_summary with the same newest-first policy as the GM prompt", () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title) VALUES (1, 't')`).run();
    const campaignId = Number((db.prepare(`SELECT id FROM trpg_campaigns`).get() as { id: number }).id);
    db.prepare(`INSERT INTO trpg_campaign_memories (campaign_id) VALUES (?)`).run(campaignId);
    for (const row of syntheticRows(15, 200)) {
      persistRoundSummary(db, campaignId, row.roundStart, row.roundEnd, row.summary);
    }
    const fromDb = loadSealedSummaries(db, campaignId);
    const fromRows = formatSealedSummariesForPrompt(loadSealedSummaryRows(db, campaignId));
    const mem = db
      .prepare(`SELECT recent_summary FROM trpg_campaign_memories WHERE campaign_id=?`)
      .get(campaignId) as { recent_summary: string };
    assert.equal(fromDb, fromRows);
    assert.equal(mem.recent_summary, fromRows);
    assert.match(mem.recent_summary, /SYN_R14_/);
    assert.doesNotMatch(mem.recent_summary, /SYN_R0_/);
    const stored = db.prepare(`SELECT COUNT(*) AS n FROM trpg_round_summaries WHERE campaign_id=?`).get(campaignId) as {
      n: number;
    };
    assert.equal(stored.n, 15);
    db.close();
  });

  it("injects formatted sealed text into the GM memory block without re-head-clipping", () => {
    const rows = syntheticRows(10, 280);
    const sealed = formatSealedSummariesForPrompt(rows);
    const block = buildTrpgMemoryPromptBlock({
      structured: {
        roundNumber: 20,
        location: "hall",
        nextRoundContext: "",
        sheets: [],
        quests: [],
        npcs: [],
        worldFlags: [],
      },
      sealedSummary: sealed,
      recentRounds: [],
    });
    assert.match(block, /\[SEALED CAMPAIGN SUMMARY\]/);
    assert.match(block, /SYN_R9_/);
    assert.doesNotMatch(block, /SYN_R0_/);
    assert.ok(block.includes(sealed));
  });

  it("does not replace anchor or historical recall when older sealed summaries drop", () => {
    const events: TrpgMemoryEventDraft[] = [
      {
        type: "promise",
        fact: "ANCHOR_OLD_PROMISE_TOKEN",
        actors: ["A"],
        entities: [],
        keywords: ["약속"],
        importance: "critical",
        scope: "party_observed",
        round: 0,
      },
    ];
    const horizon = buildHorizonPromptSections({
      events: events.map((event, id) => ({
        id: id + 1,
        campaignId: 1,
        roundStart: 0,
        roundEnd: 0,
        type: event.type,
        fact: event.fact,
        importance: event.importance,
        scope: event.scope,
        actors: event.actors,
        entities: event.entities,
        keywords: event.keywords,
        knownParticipantIds: [],
        fingerprint: "fp",
        round: 0,
      })),
      query: {
        names: ["A"],
        actionText: "약속",
        location: "hall",
        quests: [],
        npcs: [],
        inventory: [],
        worldFlags: [],
        sceneText: "",
        currentRound: 50,
        viewerKind: "gm",
      },
    });
    assert.match(horizon.anchors, /ANCHOR_OLD_PROMISE_TOKEN/);
    const db = memoryDb();
    db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title) VALUES (1, 't')`).run();
    const campaignId = 1;
    persistMemoryEvents(db, { campaignId, roundStart: 0, roundEnd: 0, events });
    assert.equal(loadSealedSummaryRows(db, campaignId).length, 0);
    db.close();
  });
});
