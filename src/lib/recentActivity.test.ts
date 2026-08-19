import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { fetchLatestSessionsPerCharacter } from "@/lib/recentChats";
import {
  characterChatsToActivity,
  compareActivityAtDesc,
  fetchRecentActivity,
  fetchRecentTrpgCampaigns,
  filterTrpgLobbyCampaigns,
  mergeRecentActivity,
  recentTrpgCampaignHref,
  type RecentCharacterChatEntry,
  type RecentTrpgCampaignEntry,
} from "./recentActivity";

function uniqueUserId(): number {
  return 9_720_000 + Math.floor(Math.random() * 90_000);
}

function seedCharacter(db: ReturnType<typeof getDb>, id: number, name: string): void {
  db.prepare(`INSERT OR REPLACE INTO characters (id, name, images) VALUES (?, ?, ?)`).run(
    id,
    name,
    JSON.stringify([`/uploads/${id}.webp`])
  );
}

function insertChat(
  db: ReturnType<typeof getDb>,
  userId: number,
  characterId: number,
  at: string
): number {
  const chatId = Number(
    db.prepare(`INSERT INTO chats (user_id, character_id, mode, created_at) VALUES (?, ?, 'safe', ?)`).run(
      userId,
      characterId,
      at
    ).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, created_at) VALUES (?, 'user', ?, 'test', ?)`
  ).run(chatId, `${characterId} 말`, at);
  return chatId;
}

function insertCampaign(
  db: ReturnType<typeof getDb>,
  opts: {
    userId: number;
    title: string;
    updatedAt: string;
    sourceCharacterId?: number;
    humans?: number;
    started?: boolean;
  }
): number {
  const campaignId = Number(
    db
      .prepare(
        `INSERT INTO trpg_campaigns (host_user_id, title, source_character_id, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(opts.userId, opts.title, opts.sourceCharacterId ?? null, opts.updatedAt, opts.updatedAt).lastInsertRowid
  );
  const humans = opts.humans ?? 1;
  for (let i = 0; i < humans; i++) {
    db.prepare(
      `INSERT INTO trpg_participants (campaign_id, slot_index, kind, user_id, display_name)
       VALUES (?, ?, 'human', ?, ?)`
    ).run(campaignId, i, i === 0 ? opts.userId : opts.userId + i + 50, `P${i}`);
  }
  if (opts.started !== false) {
    db.prepare(
      `INSERT INTO trpg_rounds (campaign_id, round_number, phase, updated_at)
       VALUES (?, 1, 'ROUND_COMPLETE', ?)`
    ).run(campaignId, opts.updatedAt);
  }
  return campaignId;
}

describe("unified recent activity", () => {
  it("keeps one latest chat per character and one entry per campaign", () => {
    const db = getDb();
    const userId = uniqueUserId();
    const busy = 9_820_001;
    const quiet = 9_820_002;
    seedCharacter(db, busy, "분기다수");
    seedCharacter(db, quiet, "오래된캐릭");
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)`).run(
      userId,
      `act-${userId}@test.local`,
      `act${userId}`,
      "x"
    );
    insertChat(db, userId, quiet, "2026-07-01 10:00:00");
    insertChat(db, userId, busy, "2026-07-28 12:00:00");
    insertChat(db, userId, busy, "2026-07-28 13:00:00");
    const campA = insertCampaign(db, {
      userId,
      title: "안개 캠페인",
      updatedAt: "2026-07-28 14:00:00",
      sourceCharacterId: busy,
    });
    insertCampaign(db, {
      userId,
      title: "초안",
      updatedAt: "2026-07-29 09:00:00",
      started: false,
      humans: 1,
    });

    const chats = fetchLatestSessionsPerCharacter(db, userId, 40);
    assert.equal(chats.filter((row) => row.character_id === busy).length, 1);
    assert.equal(chats.filter((row) => row.character_id === quiet).length, 1);

    const campaigns = fetchRecentTrpgCampaigns(db, userId, 40);
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0]?.campaignId, campA);
    assert.equal(campaigns[0]?.href, `/trpg/${campA}`);
    assert.equal(campaigns[0]?.kind, "trpg_campaign");
  });

  it("merges character chats and campaigns by lastActivityAt DESC", () => {
    const olderChat: RecentCharacterChatEntry = {
      kind: "character_chat",
      lastActivityAt: "2026-07-01 10:00:00",
      href: "/chat/1?chat=1",
      title: "오래된",
      session: {
        chat_id: 1,
        character_id: 1,
        name: "오래된",
        emoji: "🙂",
        hue: 1,
        nsfw: 0,
        images: "[]",
        last_content: "hi",
        last_role: "user",
        last_at: "2026-07-01 10:00:00",
        msg_count: 1,
        user_turn_count: 1,
        character_session_count: 1,
        session_ordinal: 1,
        chat_created_at: "2026-07-01 10:00:00",
        title: "",
      },
    };
    const newerChat: RecentCharacterChatEntry = {
      ...olderChat,
      lastActivityAt: "2026-07-28 13:00:00",
      href: "/chat/2?chat=2",
      title: "최근",
      session: { ...olderChat.session, chat_id: 2, character_id: 2, name: "최근" },
    };
    const campaign: RecentTrpgCampaignEntry = {
      kind: "trpg_campaign",
      lastActivityAt: "2026-07-28 12:00:00",
      href: "/trpg/9",
      title: "캠페인",
      campaignId: 9,
      thumbUrl: null,
    };
    const merged = mergeRecentActivity([olderChat, newerChat], [campaign], 10);
    assert.deepEqual(
      merged.map((entry) => entry.kind),
      ["character_chat", "trpg_campaign", "character_chat"]
    );
    assert.equal(merged[0]?.title, "최근");
    assert.equal(merged[1]?.kind === "trpg_campaign" ? merged[1].campaignId : 0, 9);
    assert.ok(compareActivityAtDesc("2026-07-28 13:00:00", "2026-07-28 12:00:00") < 0);
    assert.equal(recentTrpgCampaignHref(21), "/trpg/21");
    assert.equal(characterChatsToActivity([newerChat.session])[0]?.kind, "character_chat");
  });

  it("filters lobby campaigns by title without changing activity order", () => {
    const rows = [
      { id: 2, title: "안개 회랑" },
      { id: 1, title: "석문 공성" },
    ];
    assert.deepEqual(
      filterTrpgLobbyCampaigns(rows, "").map((row) => row.id),
      [2, 1]
    );
    assert.deepEqual(
      filterTrpgLobbyCampaigns(rows, "석문").map((row) => row.title),
      ["석문 공성"]
    );
  });

  it("loads mixed activity from the database in last-activity order", () => {
    const db = getDb();
    const userId = uniqueUserId();
    const charId = 9_820_011;
    seedCharacter(db, charId, "렌");
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)`).run(
      userId,
      `mix-${userId}@test.local`,
      `mix${userId}`,
      "x"
    );
    insertChat(db, userId, charId, "2026-08-01 10:00:00");
    const campaignId = insertCampaign(db, {
      userId,
      title: "QA 1H+2Bot",
      updatedAt: "2026-08-02 10:00:00",
      sourceCharacterId: charId,
    });
    const entries = fetchRecentActivity(db, userId, 40);
    assert.equal(entries[0]?.kind, "trpg_campaign");
    assert.equal(entries[0]?.href, `/trpg/${campaignId}`);
    assert.equal(entries[1]?.kind, "character_chat");
    assert.equal(entries.filter((entry) => entry.kind === "character_chat").length, 1);
    assert.equal(entries.filter((entry) => entry.kind === "trpg_campaign").length, 1);
    const chatsOnly = fetchRecentActivity(db, userId, 40, { includeTrpg: false });
    assert.equal(chatsOnly.every((entry) => entry.kind === "character_chat"), true);
  });

  it("uses 최근 활동 in the sidebar and keeps lobby continue compact", () => {
    const sidebar = readFileSync("src/components/SidebarRecentChatIcons.tsx", "utf8");
    const owner = readFileSync("src/components/Sidebar.tsx", "utf8");
    const lobby = readFileSync("src/app/trpg/TrpgLobbyClient.tsx", "utf8");
    const ownerPage = readFileSync("src/app/trpg/page.tsx", "utf8");
    assert.match(sidebar, /최근 활동/);
    assert.match(sidebar, /data-trpg-recent-kind/);
    assert.match(sidebar, /trpg_campaign/);
    assert.doesNotMatch(sidebar, />최근 대화</);
    assert.match(owner, /fetchRecentActivity/);
    assert.match(lobby, /filterTrpgLobbyCampaigns/);
    assert.match(lobby, /data-trpg-lobby-search/);
    assert.match(lobby, /method="get"/);
    assert.match(lobby, /name="q"/);
    assert.match(ownerPage, /initialCampaignQuery/);
    assert.doesNotMatch(lobby, /w-full items-center justify-center rounded-xl bg-violet-600/);
  });
});
