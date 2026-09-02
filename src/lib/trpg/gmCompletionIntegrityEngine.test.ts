import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { loadGmNarrationDraft, saveGmNarrationDraftForGeneration, clearGmNarrationDraftForGeneration } from "./gmNarrationDraft";
import { hasPendingGmResult, loadPendingGmResult } from "./pendingGmResult";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { insertParticipant, loadLatestRound } from "./store";
import { ensureTrpgTables } from "./schema";
import type { TrpgModelUsage } from "./billing";
import { TRPG_GM_MODEL } from "./types";

const VALID_DELTA = {
  players: [],
  location: "문턱",
  next_round_context: "다음",
  campaign_finished: false,
};

const INCIDENT_TRUNCATED = `{"narration":"GM: 권태현이 ... 태현의 방벽 뒤에서 이현이 찾은 환풍구 발판으로 단숨에 도약해 빠져나갈지, 아니면 태현과`;

function gmText(narration: string): string {
  return buildTrpgGmStructuredWireText(narration, VALID_DELTA);
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function usageFixture(): TrpgModelUsage {
  return {
    modelId: TRPG_GM_MODEL,
    inputTokens: 120,
    outputTokens: 450,
  };
}

async function setupRoundOne(db: Database.Database, deps: TrpgEngineDeps): Promise<number> {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  for (const [idx, name] of ["유나", "민수"].entries()) {
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: idx + 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: name,
    });
    writeSheet(db, campaignId, botId, name, EVEN_STATS, "");
  }
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return campaignId;
}

describe("gmCompletionIntegrity engine regressions", () => {
  it("integrity failure: no canonical commit, ERROR_RECOVERY, draft cleared, usage preserved", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동." }),
      gmCall: async (opts) => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: gmText("오프닝"), usage: usageFixture() };
        opts.stream?.onNarrationChunk?.(
          "GM: 권태현이 ... 아니면 태현과",
          "GM: 권태현이 ... 아니면 태현과"
        );
        return {
          text: INCIDENT_TRUNCATED,
          finishReason: "stop",
          usage: usageFixture(),
        };
      },
    };
    const campaignId = await setupRoundOne(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다." });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = loadLatestRound(db, campaignId)!;

    assert.equal(snap.round.phase, "ERROR_RECOVERY");
    assert.equal(hasPendingGmResult(db, round.id), false);
    assert.equal(loadPendingGmResult(db, round.id), null);
    const gmMessage = db
      .prepare(`SELECT COUNT(*) AS n FROM trpg_gm_messages WHERE round_id=?`)
      .get(round.id) as { n: number };
    assert.equal(gmMessage.n, 0, "CANONICAL_GM_MESSAGE_WRITTEN=false");
    const stateLog = db
      .prepare(`SELECT COUNT(*) AS n FROM trpg_state_change_log WHERE round_id=?`)
      .get(round.id) as { n: number };
    assert.equal(stateLog.n, 0, "STATE_DELTA_APPLIED=false");
    assert.notEqual(round.phase, "ROUND_COMPLETE", "ROUND_COMPLETE=false");
    assert.equal(loadGmNarrationDraft(db, round.id), null, "FAILED_GENERATION_DRAFT_VISIBLE=false");
    const usageRow = db
      .prepare(`SELECT usage_json FROM trpg_rounds WHERE id=?`)
      .get(round.id) as { usage_json: string | null };
    const usage = JSON.parse(usageRow.usage_json ?? "[]") as TrpgModelUsage[];
    const gmUsage = usage.filter((entry) => entry.outputTokens === 450);
    assert.equal(gmUsage.length, 1, "PROVIDER_USAGE_ON_INTEGRITY_REJECT=true");
    assert.equal(gmUsage[0]?.modelId, TRPG_GM_MODEL);
    db.close();
  });

  it("generation-fenced cleanup: stale A cannot clear current B draft", () => {
    const db = memoryDb();
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id)
           VALUES (1, 1, 'GENERATING_NARRATION', 'token-a')`
        )
        .run().lastInsertRowid
    );
    saveGmNarrationDraftForGeneration(db, roundId, "token-a", {
      text: "stale-a",
      updatedAtMs: 1,
    });
    db.prepare(`UPDATE trpg_rounds SET gm_generation_id='token-b' WHERE id=?`).run(roundId);
    assert.equal(
      saveGmNarrationDraftForGeneration(db, roundId, "token-b", {
        text: "current-b",
        updatedAtMs: 2,
      }),
      true
    );
    assert.equal(clearGmNarrationDraftForGeneration(db, roundId, "token-a"), false);
    const draft = loadGmNarrationDraft(db, roundId);
    assert.equal(draft?.generationId, "token-b");
    assert.equal(draft?.text, "current-b", "NEW_OWNER_DRAFT_SURVIVES_STALE_CLEANUP=true");
    db.close();
  });
});

describe("gmCompletionIntegrity structured output owner counts", () => {
  it("wire-format primitives are defined once in gmStructuredOutput", () => {
    const prompt = fs.readFileSync("src/lib/trpg/gmPrompt.ts", "utf8");
    const integrity = fs.readFileSync("src/lib/trpg/gmCompletionIntegrity.ts", "utf8");
    const structured = fs.readFileSync("src/lib/trpg/gmStructuredOutput.ts", "utf8");
    const streamParser = fs.readFileSync("src/lib/trpg/gmStructuredStreamParser.ts", "utf8");
    assert.match(structured, /TRPG_GM_STRUCTURED_RESPONSE_FORMAT/);
    assert.match(structured, /buildTrpgGmResponseFormat/);
    assert.doesNotMatch(prompt, /Output format exactly:/);
    assert.doesNotMatch(integrity, /<<<NARRATION>>>/);
    assert.doesNotMatch(integrity, /<<<DELTA>>>/);
    assert.match(integrity, /from "\.\/gmStructuredOutput"/);
    assert.match(streamParser, /"narration"/);
    assert.equal((structured.match(/buildTrpgGmResponseFormat/g) ?? []).length, 1);
  });
});
