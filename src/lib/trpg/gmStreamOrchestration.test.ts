import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { mockReadableStreamFromText, buildMockOpenRouterStreamChunks } from "@/lib/mockApiMode";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { callTrpgGm } from "./gmCall";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { loadGmNarrationDraft } from "./gmNarrationDraft";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { insertParticipant, loadLatestRound } from "./store";
import { ensureTrpgTables } from "./schema";

const GM_OK = `<<<NARRATION>>>
문이 천천히 열린다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false}`;

function gmText(narration = "장면"): string {
  return `<<<NARRATION>>>\n${narration}\n<<<DELTA>>>\n${JSON.stringify({
    players: [],
    location: "문턱",
    next_round_context: "다음",
    campaign_finished: false,
  })}`;
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

async function setupTwoBots(db: Database.Database, deps: TrpgEngineDeps) {
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

describe("TRPG GM stream orchestration", () => {
  it("starts GM provider immediately after final bot persist without presentation wait", async () => {
    const db = memoryDb();
    let botPersistCount = 0;
    let bot2PersistAt: number | null = null;
    let gmProviderStartAt: number | null = null;
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      botCall: async () => {
        botPersistCount += 1;
        if (botPersistCount === 2) bot2PersistAt = Date.now();
        return { text: `봇${botPersistCount}.\n\n<<<INTENT>>>\n행동.` };
      },
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: gmText("오프닝") };
        gmProviderStartAt = Date.now();
        return { text: gmText("해결") };
      },
    };
    const campaignId = await setupTwoBots(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.ok(bot2PersistAt, "BOT2_PERSIST_RECORDED");
    assert.ok(gmProviderStartAt, "GM_PROVIDER_START_RECORDED");
    const deltaMs = gmProviderStartAt! - bot2PersistAt!;
    assert.ok(deltaMs >= 0 && deltaMs < 500, `GM_PROVIDER_START_AFTER_BOT2_PERSIST_MS=${deltaMs}`);
    assert.equal(botPersistCount, 2);
    db.close();
  });

  it("persists narration draft chunks during streamed GM generation", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동." }),
      gmCall: async (opts) => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: gmText("오프닝") };
        opts.stream?.onNarrationChunk?.("부분1", "부분1");
        opts.stream?.onNarrationChunk?.("부분1 텍스트", " 텍스트");
        return { text: gmText("부분1 텍스트") };
      },
    };
    const campaignId = await setupTwoBots(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = loadLatestRound(db, campaignId)!;
    assert.equal(loadGmNarrationDraft(db, round.id), null, "draft cleared after commit");
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.match(snap.currentNarration ?? snap.log.at(-1)?.narration ?? "", /부분1 텍스트/);
    db.close();
  });

  it("persists draft via stream callback and exposes it on snapshot", async () => {
    const db = memoryDb();
    let draftDuringGm: string | null = null;
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동." }),
      gmCall: async (opts) => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: gmText("오프닝") };
        opts.stream?.onNarrationChunk?.("스트리밍 중", "스트리밍 중");
        const round = loadLatestRound(db, 1)!;
        draftDuringGm = loadGmNarrationDraft(db, round.id)?.text ?? null;
        const snap = loadTrpgSnapshot(db, 1, 1)!;
        assert.equal(snap.gmNarrationDraft?.text, "스트리밍 중");
        return { text: gmText("완료") };
      },
    };
    const campaignId = await setupTwoBots(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(draftDuringGm, "스트리밍 중");
    const after = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(after.gmNarrationDraft, null);
    db.close();
  });
});

describe("TRPG GM provider SSE stream transport", () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  const previousMock = process.env.MOCK_MODE;

  it("uses stream=true and records first-chunk timing", async () => {
    delete process.env.MOCK_MODE;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-stream";
    const chunks = buildMockOpenRouterStreamChunks(GM_OK, "deepseek-v4-pro-0813");
    let sawStreamTrue = false;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sawStreamTrue = body.stream === true;
      return new Response(mockReadableStreamFromText(chunks), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    try {
      let firstChunkMs: number | null = null;
      const result = await callTrpgGm({
        system: "sys",
        user: "장면",
        timeoutMs: 5_000,
        stream: {
          onProviderTimings: (timings) => {
            if (timings.firstChunkAtMs != null && timings.startAtMs != null) {
              firstChunkMs = timings.firstChunkAtMs - timings.startAtMs;
            }
          },
        },
      });
      assert.equal(sawStreamTrue, true, "GM_PROVIDER_STREAM=true");
      assert.match(result.text, /<<<NARRATION>>>/);
      assert.ok(firstChunkMs != null && firstChunkMs >= 0, "GM_FIRST_CHUNK_MEASURABLE=true");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
      if (previousMock === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = previousMock;
    }
  });
});
