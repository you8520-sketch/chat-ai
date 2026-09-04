import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { TextDecoder, TextEncoder } from "node:util";
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

const GM_OK = buildTrpgGmStructuredWireText("문이 천천히 열린다.", {"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false});

function gmText(narration = "장면"): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: [],
    location: "문턱",
    next_round_context: "다음",
    campaign_finished: false,
  });
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
  it("FINAL_BOT_PERSISTED_BEFORE_GM_CALL without presentation wait", async () => {
    const db = memoryDb();
    let botCalls = 0;
    let gmCalls = 0;
    let campaignId = 0;
    const finalBotBody = "민수.\n\n<<<INTENT>>>\n조용히 전진한다.";
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      botCall: async () => {
        botCalls += 1;
        return {
          text:
            botCalls === 1
              ? "유나.\n\n<<<INTENT>>>\n창틀을 본다."
              : finalBotBody,
        };
      },
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: gmText("오프닝") };
        const round = loadLatestRound(db, campaignId)!;
        const botSubs = db
          .prepare(
            `SELECT s.body, s.locked, p.display_name
             FROM trpg_action_submissions s
             JOIN trpg_participants p ON p.id = s.participant_id
             WHERE s.round_id=? AND p.kind='ai_character'
             ORDER BY s.id ASC`
          )
          .all(round.id) as Array<{ body: string; locked: number; display_name: string }>;
        assert.equal(botSubs.length, 2, "FINAL_BOT_PERSISTED_BEFORE_GM_CALL=true");
        assert.equal(botSubs[0]?.locked, 1);
        assert.equal(botSubs[1]?.locked, 1);
        assert.match(botSubs[1]?.body ?? "", /조용히 전진/);
        return { text: gmText("해결") };
      },
    };
    campaignId = await setupTwoBots(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 2);
    assert.equal(gmCalls, 2);
    db.close();
  });

  it("coalesces draft DB writes during many stream chunks", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    let draftWriteCount = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동." }),
      gmCall: async (opts) => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: gmText("오프닝") };
        const round = loadLatestRound(db, campaignId)!;
        let lastDraftJson: string | null = null;
        for (let i = 1; i <= 80; i += 1) {
          opts.stream?.onNarrationChunk?.("x".repeat(i), "x");
          const row = db
            .prepare(`SELECT gm_narration_draft_json FROM trpg_rounds WHERE id=?`)
            .get(round.id) as { gm_narration_draft_json: string | null } | undefined;
          if (row?.gm_narration_draft_json && row.gm_narration_draft_json !== lastDraftJson) {
            draftWriteCount += 1;
            lastDraftJson = row.gm_narration_draft_json;
          }
        }
        return { text: gmText("x".repeat(80)) };
      },
    };
    let campaignId = 0;
    campaignId = await setupTwoBots(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = loadLatestRound(db, campaignId)!;
    assert.equal(loadGmNarrationDraft(db, round.id), null, "draft cleared after commit");
    assert.ok(draftWriteCount < 80, `PROVIDER_CHUNK_DB_WRITE=false writes=${draftWriteCount}`);
    assert.ok(draftWriteCount <= 3, `GM_DRAFT_WRITE_COALESCED=true writes=${draftWriteCount}`);
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    const gmRound = snap.log.find((entry) => entry.roundNumber === 1);
    assert.match(gmRound?.narration ?? "", /x{10,}/);
    db.close();
  });

  it("persists draft via stream callback and exposes public snapshot without lease token", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    let campaignId = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      botCall: async () => ({ text: "유나.\n\n<<<INTENT>>>\n행동." }),
      gmCall: async (opts) => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: gmText("오프닝") };
        opts.stream?.onNarrationChunk?.("a".repeat(65), "a".repeat(65));
        const snap = loadTrpgSnapshot(db, campaignId, 1)!;
        assert.equal(snap.gmNarrationDraft?.text, "a".repeat(65));
        assert.equal("generationId" in (snap.gmNarrationDraft ?? {}), false, "PUBLIC_GM_LEASE_TOKEN=false");
        return { text: gmText("완료") };
      },
    };
    campaignId = await setupTwoBots(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const after = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(after.gmNarrationDraft, null);
    db.close();
  });
});

describe("TRPG GM provider SSE stream transport", () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  const previousMock = process.env.MOCK_MODE;

  function installStreamResponse(chunks: string[]): void {
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;
  }

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
      assert.match(result.text, /"narration"/);
      assert.ok(firstChunkMs != null && firstChunkMs >= 0, "GM_FIRST_CHUNK_MEASURABLE=true");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
      if (previousMock === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = previousMock;
    }
  });

  it("SSE_NETWORK_SPLIT_PASS + UTF8 + CRLF + EOF tail + final usage", async () => {
    delete process.env.MOCK_MODE;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-gm-stream";
    const narration = buildTrpgGmStructuredWireText("한글 장면", { players: [] });
    const payload = JSON.stringify({ choices: [{ delta: { content: narration } }] });
    const crlfLine = `data: ${payload}\r\n\r\n`;
    const usageLine = `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 6 },
    })}\n\n`;
    const bytes = new TextEncoder().encode(`${crlfLine}${usageLine}data: [DONE]\n\n`);
    const split = 7;
    installStreamResponse([
      new TextDecoder().decode(bytes.slice(0, split)),
      new TextDecoder().decode(bytes.slice(split)),
    ]);
    try {
      const result = await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000 });
      assert.match(result.text, /한글 장면/);
      assert.equal(result.usage?.inputTokens, 4);
      assert.equal(result.usage?.outputTokens, 6);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
      if (previousMock === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = previousMock;
    }
  });
});
