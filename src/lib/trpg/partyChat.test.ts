import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { postTrpgPartyChat } from "./partyChat";
import { ensureTrpgTables } from "./schema";
import { TRPG_PARTY_CHAT_MAX_CHARS } from "./types";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function startDeps(): TrpgEngineDeps {
  return {
    skipBilling: true,
    rollD20: () => 12,
    gmCall: async () => ({
      text: `<<<NARRATION>>>
문이 열린다. 당신은 다음 한 수를 고른다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false}`,
    }),
    botCall: async () => ({ text: "조심스럽게 문틀을 짚는다." }),
  };
}

describe("TRPG party chat", () => {
  it("rejects party chat until the campaign has started", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    assert.throws(() => postTrpgPartyChat(db, { campaignId, userId: 1, body: "로비에서" }), /시작된 뒤/);
    db.close();
  });

  it("lets human players talk without touching scenario actions", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: startDeps() });
    postTrpgPartyChat(db, { campaignId, userId: 1, body: "  잠깐만 화장실  " });
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.partyChat.length, 1);
    assert.equal(snap?.partyChat[0]?.body, "잠깐만 화장실");
    assert.equal(snap?.partyChat[0]?.isSelf, true);
    assert.equal(snap?.partyChat[0]?.name, "렌");
    db.close();
  });

  it("rejects empty messages and non-participants", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    assert.throws(() => postTrpgPartyChat(db, { campaignId, userId: 1, body: "   " }), /메시지를 입력/);
    assert.throws(() => postTrpgPartyChat(db, { campaignId, userId: 99, body: "안녕" }), /참가자가 아닙니다/);
    db.close();
  });

  it("does not feed party chat into GM or bot prompts", async () => {
    const db = memoryDb();
    const seen: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async ({ user }) => {
        seen.push(user);
        return {
          text: `<<<NARRATION>>>
문이 열린다. 당신은 다음 한 수를 고른다.
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false}`,
        };
      },
      botCall: async (_system, user) => {
        seen.push(user);
        return { text: "조심스럽게 문틀을 짚는다." };
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    postTrpgPartyChat(db, { campaignId, userId: 1, body: "OOC비밀토큰XYZ파티잡담" });
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 민다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.ok(seen.length >= 2);
    for (const block of seen) {
      assert.doesNotMatch(block, /OOC비밀토큰XYZ파티잡담/);
    }
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.partyChat.some((m) => m.body.includes("OOC비밀토큰XYZ파티잡담")), true);
    db.close();
  });

  it("clips party chat to the max length", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: startDeps() });
    postTrpgPartyChat(db, { campaignId, userId: 1, body: "가".repeat(TRPG_PARTY_CHAT_MAX_CHARS + 40) });
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.partyChat[0]?.body.length, TRPG_PARTY_CHAT_MAX_CHARS);
    db.close();
  });
});
