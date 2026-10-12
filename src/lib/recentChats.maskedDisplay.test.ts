import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { shouldHideAdultListings } from "./adultVerification";
import { fetchRecentActivity, MASKED_RECENT_CHAT_HREF } from "./recentActivity";
import {
  chatPreviewLabel,
  fetchUserChatSessionsForRecentCharacters,
  groupSessionsByCharacter,
  MASKED_CHAT_NAME,
  MASKED_CHAT_PREVIEW,
  toDisplayChatSession,
} from "./recentChats";

const SECRET = {
  name: "ZZSECRET_NAME",
  title: "ZZSECRET_TITLE",
  emoji: "ZZSECRET_EMOJI",
  image: "/uploads/ZZSECRET_IMAGE_ONE.webp",
  image2: "/uploads/ZZSECRET_IMAGE_TWO.webp",
  narration: "ZZSECRET_NARRATION",
  dialogue: "ZZSECRET_DIALOGUE",
};

function seed(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT, emoji TEXT, hue INTEGER, nsfw INTEGER, images TEXT);
    CREATE TABLE chats (id INTEGER PRIMARY KEY, user_id INTEGER, character_id INTEGER, title TEXT DEFAULT '', created_at TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, role TEXT, content TEXT, model TEXT DEFAULT '', created_at TEXT);
  `);
  db.prepare("INSERT INTO characters VALUES (?,?,?,?,?,?)").run(1, "안전한 캐릭터", "🌿", 120, 0, JSON.stringify(["/uploads/safe.webp"]));
  db.prepare("INSERT INTO characters VALUES (?,?,?,?,?,?)").run(2, SECRET.name, SECRET.emoji, 300, 1, JSON.stringify([SECRET.image, SECRET.image2]));
  const chat = db.prepare("INSERT INTO chats VALUES (?,?,?,?,?)");
  const msg = db.prepare("INSERT INTO messages (chat_id, role, content, created_at) VALUES (?,?,?,?)");
  chat.run(10, 7, 1, "대화 하나", "2026-08-01 10:00:00");
  msg.run(10, "assistant", `안전한 서술 "안전한 대사"`, "2026-08-01 10:01:00");
  chat.run(20, 7, 2, SECRET.title, "2026-08-02 10:00:00");
  msg.run(20, "user", "시작", "2026-08-02 10:01:00");
  msg.run(20, "assistant", `${SECRET.narration} "${SECRET.dialogue}"`, "2026-08-02 10:02:00");
  chat.run(21, 7, 2, "", "2026-08-03 10:00:00");
  msg.run(21, "assistant", `${SECRET.narration} second room`, "2026-08-03 10:02:00");
  return db;
}

const leaks = (payload: unknown): string[] => {
  const text = JSON.stringify(payload);
  return Object.values(SECRET).filter((value) => text.includes(value));
};

describe("masked recent chat display model", () => {
  it("serializes zero sensitive strings for adult-hidden sidebar rows (RSC props proxy)", () => {
    const entries = fetchRecentActivity(seed(), 7, 40, { hideAdult: true, includeTrpg: false });
    assert.deepEqual(leaks(entries), []);
    const masked = entries.find((entry) => entry.kind === "character_chat" && entry.session.masked);
    assert.ok(masked && masked.kind === "character_chat");
    assert.equal(masked.href, MASKED_RECENT_CHAT_HREF);
    assert.equal(masked.title, MASKED_CHAT_NAME);
    assert.equal(masked.session.character_id, 2);
    assert.equal(masked.session.chat_id, 21);
    assert.equal(masked.session.last_content, null);
    assert.equal(masked.session.last_role, null);
    assert.equal(masked.session.images, "[]");
    assert.equal(masked.session.emoji, "");
    assert.equal(chatPreviewLabel(masked.session, masked.title), MASKED_CHAT_PREVIEW);
  });

  it("serializes zero sensitive strings for adult-hidden /chats groups, branches and every session", () => {
    const db = seed();
    const sessions = fetchUserChatSessionsForRecentCharacters(db, 7, 40).map((s) =>
      toDisplayChatSession(s, true)
    );
    const groups = groupSessionsByCharacter(sessions);
    assert.deepEqual(leaks({ sessions, groups }), []);
    const group = groups.find((g) => g.character_id === 2);
    assert.ok(group);
    assert.equal(group.masked, true);
    assert.equal(group.name, MASKED_CHAT_NAME);
    assert.equal(group.sessions.length, 2, "masked rooms stay in the list with their ids");
    assert.deepEqual(group.sessions.map((s) => s.chat_id).sort(), [20, 21]);
    assert.equal(group.total_turns, 1);
  });

  it("builds the masked row from an explicit allowlist, never by spreading the DB row", () => {
    const [raw] = fetchUserChatSessionsForRecentCharacters(seed(), 7, 40).filter((s) => s.character_id === 2);
    const display = toDisplayChatSession(raw!, true);
    assert.deepEqual(Object.keys(display).sort(), [
      "character_id",
      "character_session_count",
      "chat_created_at",
      "chat_id",
      "emoji",
      "hue",
      "images",
      "last_at",
      "last_content",
      "last_role",
      "masked",
      "name",
      "nsfw",
      "session_ordinal",
      "title",
      "user_turn_count",
    ]);
    const shown = toDisplayChatSession(raw!, false);
    assert.deepEqual(Object.keys(shown).sort(), Object.keys(display).sort());
  });

  it("keeps ordinary rooms and filter-OFF adult rooms fully readable", () => {
    const db = seed();
    const all = fetchUserChatSessionsForRecentCharacters(db, 7, 40);
    const shown = all.map((s) => toDisplayChatSession(s, false));
    assert.equal(shown.every((s) => !s.masked), true);
    const adultOff = shown.find((s) => s.chat_id === 21);
    assert.equal(adultOff?.name, SECRET.name);
    assert.match(adultOff?.last_content ?? "", /ZZSECRET_NARRATION/);
    const hiddenPolicy = all.map((s) => toDisplayChatSession(s, true));
    const safe = hiddenPolicy.find((s) => s.character_id === 1);
    assert.equal(safe?.masked, false);
    assert.equal(safe?.name, "안전한 캐릭터");
    assert.match(safe?.last_content ?? "", /안전한 대사/);
    assert.equal(safe?.emoji, "🌿");
  });

  it("keeps sort order and ids identical between masked and unmasked payloads", () => {
    const db = seed();
    const order = (hideAdult: boolean) =>
      fetchRecentActivity(db, 7, 40, { hideAdult, includeTrpg: false }).map((entry) =>
        entry.kind === "character_chat" ? [entry.session.chat_id, entry.lastActivityAt] : []
      );
    assert.deepEqual(order(true), order(false));
  });

  it("hides exactly when shouldHideAdultListings says so (policy owner unchanged)", () => {
    const std = { email: "u@x.test", is_adult: 0, is_admin: 0, nsfw_on: 0 };
    const adultFlag = { email: "u@x.test", is_adult: 1, is_admin: 0, nsfw_on: 1 };
    const adminOn = { email: "a@x.test", is_adult: 1, is_admin: 1, nsfw_on: 0 };
    const adminOff = { email: "a@x.test", is_adult: 1, is_admin: 1, nsfw_on: 1 };
    assert.deepEqual(
      [std, adultFlag, adminOn, adminOff].map((u) => shouldHideAdultListings(u)),
      [true, true, true, false]
    );
  });
});

describe("masked display wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("sidebar and /chats pass the policy result into the single transform", () => {
    const sidebar = read("src/components/Sidebar.tsx");
    const page = read("src/app/chats/page.tsx");
    assert.match(sidebar, /hideAdult: shouldHideAdultListings\(user\)/);
    assert.match(page, /toDisplayChatSession\(session, hideAdult\)/);
    assert.doesNotMatch(page, /blurNsfw/);
    assert.doesNotMatch(sidebar, /blurNsfw/);
  });

  it("client list components no longer receive the raw filter flag or draw adult media", () => {
    for (const file of [
      "src/components/ChatsPageGrid.tsx",
      "src/components/CharacterChatBranchModal.tsx",
      "src/components/SidebarRecentChatIcons.tsx",
      "src/components/SidebarShell.tsx",
    ]) {
      const src = read(file);
      assert.doesNotMatch(src, /blurNsfw/, file);
      assert.doesNotMatch(src, /blur-md/, file);
    }
  });

  it("never prefills or saves the neutral title when renaming a masked room", () => {
    const modal = read("src/components/CharacterChatBranchModal.tsx");
    assert.match(modal, /setEditingTitle\(session\.masked \? "" : getBranchDisplayTitle\(session\)\)/);
    assert.match(modal, /if \(session\.masked && !nextTitle\) return;/);
    assert.match(modal, /session\.masked \? session : \{ \.\.\.session, title:/);
    assert.match(modal, /b\.masked && !editingTitle\.trim\(\)/);
  });

  it("keeps masked rows free of D-2 markers and on the existing /verify entry", () => {
    const resume = read("src/lib/chatResumeTransition.ts");
    assert.match(resume, /if \(input\.hidden\) return \{\};/);
    const modal = read("src/components/CharacterChatBranchModal.tsx");
    assert.match(modal, /href: hidden \? "\/verify"/);
  });
});
