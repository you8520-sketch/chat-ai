import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { fetchLatestSessionsPerCharacter } from "@/lib/recentChats";
import {
  SIDEBAR_SOLO_SETUP_VISIBLE,
  TRPG_RECENT_ICON,
  TRPG_SOURCE_THUMB,
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
    status?: string;
    phase?: string;
  }
): number {
  const campaignId = Number(
    db
      .prepare(
        `INSERT INTO trpg_campaigns (host_user_id, title, status, source_character_id, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        opts.userId,
        opts.title,
        opts.status ?? (opts.started === false ? "CHARACTER_SETUP" : "ROUND_COMPLETE"),
        opts.sourceCharacterId ?? null,
        opts.updatedAt,
        opts.updatedAt
      ).lastInsertRowid
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
       VALUES (?, 1, ?, ?)`
    ).run(campaignId, opts.phase ?? "ROUND_COMPLETE", opts.updatedAt);
  } else if (opts.phase) {
    db.prepare(
      `INSERT INTO trpg_rounds (campaign_id, round_number, phase, updated_at)
       VALUES (?, 0, ?, ?)`
    ).run(campaignId, opts.phase, opts.updatedAt);
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
    assert.equal(campaigns.length, 2);
    assert.equal(campaigns.some((row) => row.campaignId === campA), true);
    assert.equal(campaigns[0]?.href.startsWith("/trpg/"), true);
    assert.equal(campaigns.every((row) => row.kind === "trpg_campaign"), true);
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

  it("uses 최근 활동 in the sidebar and does not duplicate campaigns on the TRPG lobby", () => {
    const sidebar = readFileSync("src/components/SidebarRecentChatIcons.tsx", "utf8");
    const owner = readFileSync("src/components/Sidebar.tsx", "utf8");
    const lobby = readFileSync("src/app/trpg/TrpgLobbyClient.tsx", "utf8");
    const ownerPage = readFileSync("src/app/trpg/page.tsx", "utf8");
    assert.match(sidebar, /최근 활동/);
    assert.match(sidebar, /data-trpg-recent-kind/);
    assert.match(sidebar, /trpg_campaign/);
    assert.doesNotMatch(sidebar, />최근 대화</);
    assert.match(owner, /fetchRecentActivity/);
    assert.doesNotMatch(lobby, /내 캠페인/);
    assert.doesNotMatch(lobby, /filterTrpgLobbyCampaigns/);
    assert.doesNotMatch(lobby, /data-trpg-lobby-search/);
    assert.doesNotMatch(lobby, /data-trpg-reenter-cta/);
    assert.doesNotMatch(ownerPage, /initialCampaignQuery/);
    assert.doesNotMatch(ownerPage, /listTrpgCampaigns/);
    assert.match(lobby, /초대 링크·코드로 참가/);
  });

  it("includes TRPG campaigns in the desktop and mobile conversation list", () => {
    const page = readFileSync("src/app/chats/page.tsx", "utf8");
    const grid = readFileSync("src/components/ChatsPageGrid.tsx", "utf8");
    assert.match(page, /fetchRecentTrpgCampaigns/);
    assert.match(page, /campaigns=\{campaigns\}/);
    assert.match(page, /개 TRPG/);
    assert.match(grid, /data-chat-list-kind="trpg_campaign"/);
    assert.match(grid, /compareActivityAtDesc/);
    assert.match(grid, /TRPG 방으로 돌아가기/);
    assert.match(grid, /href=\{campaign\.href\}/);
    assert.match(grid, /grid-cols-1/);
    assert.match(grid, /@min-\[30rem\]\/chats:grid-cols-2/);
  });

  it("includes solo setup, solo waiting, and started campaigns in recent", () => {
    assert.equal(SIDEBAR_SOLO_SETUP_VISIBLE, true);
    const db = getDb();
    const userId = uniqueUserId();
    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)`).run(
      userId,
      `setup-${userId}@test.local`,
      `setup${userId}`,
      "x"
    );
    const setupId = insertCampaign(db, {
      userId,
      title: "솔로 셋업",
      updatedAt: "2026-08-03 09:00:00",
      started: false,
      humans: 1,
      status: "CHARACTER_SETUP",
    });
    const waitingId = insertCampaign(db, {
      userId,
      title: "솔로 대기",
      updatedAt: "2026-08-03 10:00:00",
      started: false,
      humans: 1,
      status: "WAITING_FOR_PLAYERS",
    });
    const startedId = insertCampaign(db, {
      userId,
      title: "진행 중",
      updatedAt: "2026-08-03 11:00:00",
      started: true,
      humans: 1,
      status: "ACTION_INPUT",
    });
    const campaigns = fetchRecentTrpgCampaigns(db, userId, 40);
    const ids = campaigns.map((row) => row.campaignId);
    assert.equal(ids.includes(setupId), true, "SOLO_CHARACTER_SETUP_IN_RECENT");
    assert.equal(ids.includes(waitingId), true, "SOLO_WAITING_CAMPAIGN_IN_RECENT");
    assert.equal(ids.includes(startedId), true, "STARTED_CAMPAIGN_IN_RECENT");
    assert.equal(campaigns.length, 3);
  });

  it("locks TRPG recent to the D20 glyph and drops the 전체 link", () => {
    assert.equal(TRPG_RECENT_ICON, "D20", "TRPG_RECENT_USES_D20_GLYPH");
    assert.equal(TRPG_SOURCE_THUMB, false, "TRPG_RECENT_DOES_NOT_LOAD_SOURCE_THUMB");
    const activity = readFileSync("src/lib/recentActivity.ts", "utf8");
    const sidebar = readFileSync("src/components/SidebarRecentChatIcons.tsx", "utf8");
    assert.doesNotMatch(activity, /resolveCampaignThumb/);
    assert.doesNotMatch(activity, /parseRecentThumb/);
    assert.doesNotMatch(activity, /sanitizeWorldCoverUrl/);
    assert.doesNotMatch(activity, /thumbUrl/);
    assert.doesNotMatch(activity, /source_character_id/);
    assert.doesNotMatch(activity, /source_world_id/);
    assert.match(sidebar, /TrpgRecentGlyph/);
    assert.match(sidebar, /data-trpg-recent-icon="d20"/);
    assert.doesNotMatch(sidebar, /entry\.thumbUrl/);
    assert.doesNotMatch(sidebar, />전체</);
    assert.doesNotMatch(sidebar, /href="\/chats"/);
    assert.equal(sidebar.includes(">전체<") === false, true, "RECENT_ACTIVITY_HEADER_HAS_NO_MISLEADING_ALL_LINK");
  });
});
