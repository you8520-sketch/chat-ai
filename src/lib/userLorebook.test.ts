/**
 * User Lorebook + subscription memory capability — zero provider calls.
 */
import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  ensureCreatorLorebookSchema,
  loadAttachedCreatorLorebooksPromptBlockFromActivation,
} from "@/lib/creatorLorebook";
import {
  buildLorebookActivationText,
  matchKeywordLorebookEntryDetails,
} from "@/lib/keywordLorebooks";
import { buildContext } from "@/services/contextBuilder";
import { isSubscribed } from "@/lib/auth-types";
import {
  FREE_CAPABILITY,
  SUBSCRIBED_CAPABILITY,
  resolveSubscriptionMemoryCapability,
} from "@/lib/subscriptionMemoryCapability";
import {
  applyUserLorebookTurnInjectionBudget,
  getOrCreateUserLorebookForChat,
  loadUserLorebookPromptBlockFromActivation,
  saveUserLorebookEntries,
  selectEffectiveActiveUserLorebookEntries,
  type UserLorebookStoredEntry,
} from "@/lib/userLorebook";
import {
  stripLegacyUserNoteReferenceZone,
  migrateUserNoteReferenceZoneCleanup,
} from "@/lib/userNoteReferenceCleanup";
import { USER_NOTE_ZONE_SEPARATOR } from "@/lib/userNoteStatusWindow";

const USER = 991001;
const CHAT = 991002;
const CHAR = 991003;
const CREATOR_LOREBOOK = 991004;

function seed(): void {
  const db = getDb();
  ensureCreatorLorebookSchema(db);
  db.prepare(`DELETE FROM _schema_flags WHERE key='user_note_reference_zone_cleanup_v1'`).run();
  db.prepare("DELETE FROM character_lorebook_attachments WHERE character_id=?").run(CHAR);
  db.prepare("DELETE FROM lorebook_active_entries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM keyword_lorebooks WHERE creator_id=? OR chat_id=?").run(USER, CHAT);
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);

  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash, sub_until, sub_plan) VALUES (?,?,?,?,?,?)`).run(
    USER,
    `ulore-${USER}@test.local`,
    "ulore-user",
    "x",
    null,
    null
  );
  db.prepare(`INSERT INTO characters (id, name, lorebook_id) VALUES (?,?,NULL)`).run(CHAR, "Char");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode, user_note) VALUES (?,?,?,'safe',?)`).run(
    CHAT,
    USER,
    CHAR,
    "FOCUS_ONLY"
  );
  db.prepare(
    `INSERT INTO keyword_lorebooks (id, creator_id, name, summary, entries_json, scope)
     VALUES (?, ?, 'creator book', '', ?, 'creator')`
  ).run(
    CREATOR_LOREBOOK,
    USER,
    JSON.stringify([{ keywords: ["CREATOR_KW"], content: "CREATOR_CONTENT" }])
  );
  db.prepare(
    `INSERT INTO character_lorebook_attachments (character_id, lorebook_id, position)
     VALUES (?, ?, 0)`
  ).run(CHAR, CREATOR_LOREBOOK);
}

function entry(content: string, keywords: string[], enabled = true): UserLorebookStoredEntry {
  return { content, keywords, enabled };
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(seed);

describe("subscription memory capability", () => {
  it("free vs active basic/pro vs expired", () => {
    const free = resolveSubscriptionMemoryCapability({ sub_until: null });
    assert.deepEqual(free, FREE_CAPABILITY);

    const activeBasic = resolveSubscriptionMemoryCapability({
      sub_until: new Date(Date.now() + 86_400_000).toISOString(),
      sub_plan: "basic",
    } as never);
    assert.deepEqual(activeBasic, SUBSCRIBED_CAPABILITY);

    const activePro = resolveSubscriptionMemoryCapability({
      sub_until: new Date(Date.now() + 86_400_000).toISOString(),
      sub_plan: "pro",
    } as never);
    assert.deepEqual(activePro, SUBSCRIBED_CAPABILITY);

    const expired = resolveSubscriptionMemoryCapability({
      sub_until: new Date(Date.now() - 86_400_000).toISOString(),
      sub_plan: "pro",
    } as never);
    assert.deepEqual(expired, FREE_CAPABILITY);

    const futureNoPlan = resolveSubscriptionMemoryCapability({
      sub_until: new Date(Date.now() + 86_400_000).toISOString(),
      sub_plan: null,
    } as never);
    assert.deepEqual(futureNoPlan, FREE_CAPABILITY);

    const futureInvalidPlan = resolveSubscriptionMemoryCapability({
      sub_until: new Date(Date.now() + 86_400_000).toISOString(),
      sub_plan: "trial",
    } as never);
    assert.deepEqual(futureInvalidPlan, FREE_CAPABILITY);

    assert.equal(
      isSubscribed({ sub_until: new Date(Date.now() - 1).toISOString() } as never),
      false
    );
  });
});

describe("effective active capacity", () => {
  it("FREE stops at 10 entries or 5K content", () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      entry(`BODY_${i}_${"x".repeat(400)}`, [`KW_${i}`])
    );
    const active = selectEffectiveActiveUserLorebookEntries(entries, FREE_CAPABILITY);
    assert.ok(active.length <= 10);
    assert.ok(active.reduce((n, e) => n + e.content.length, 0) <= 5000);
  });

  it("SUBSCRIBED stops at 50 entries or 20K content", () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      entry(`P_${i}_${"y".repeat(350)}`, [`P_${i}`])
    );
    const active = selectEffectiveActiveUserLorebookEntries(entries, SUBSCRIBED_CAPABILITY);
    assert.ok(active.length <= 50);
    assert.ok(active.reduce((n, e) => n + e.content.length, 0) <= 20_000);
  });
});

describe("turn injection budget", () => {
  it("FREE full-entry only <= 2500", () => {
    const matches = [800, 800, 800, 800, 800, 800].map((size, i) => ({
      entryKey: `e${i}`,
      content: "x".repeat(size),
      keyword: `k${i}`,
      source: "current_user" as const,
    }));
    const selected = applyUserLorebookTurnInjectionBudget(matches, 2500);
    assert.ok(selected.reduce((n, m) => n + m.content.length, 0) <= 2500);
    for (const match of selected) {
      assert.ok(match.content.length === 800);
    }
  });

  it("PAID full-entry only <= 4000", () => {
    const matches = [800, 800, 800, 800, 800, 800].map((size, i) => ({
      entryKey: `e${i}`,
      content: "x".repeat(size),
      keyword: `k${i}`,
      source: "current_user" as const,
    }));
    const selected = applyUserLorebookTurnInjectionBudget(matches, 4000);
    assert.ok(selected.reduce((n, m) => n + m.content.length, 0) <= 4000);
  });
});

describe("shared activation engine", () => {
  it("creator and user both match same activation source", () => {
    const db = getDb();
    getOrCreateUserLorebookForChat(db, CHAT, USER);
    saveUserLorebookEntries(db, CHAT, USER, [
      entry("USER_LORE_BODY", ["SHARED_KW"]),
    ]);
    const activation = buildLorebookActivationText({
      currentUserMessage: "hello CREATOR_KW SHARED_KW world",
    });
    const creatorExclude = new Set<string>();
    const creator = loadAttachedCreatorLorebooksPromptBlockFromActivation(db, CHAR, activation, {
      chatId: CHAT,
      currentTurn: 1,
      onMatch: (match) => creatorExclude.add(match.content.trim()),
    });
    const user = loadUserLorebookPromptBlockFromActivation(db, {
      chatId: CHAT,
      userId: USER,
      capability: FREE_CAPABILITY,
      activation,
      currentTurn: 1,
      excludeContents: creatorExclude,
    });
    assert.match(creator, /CREATOR_CONTENT/);
    assert.match(user, /USER_LORE_BODY/);
    assert.doesNotMatch(user, /CREATOR_CONTENT/);
  });
});

describe("reference data cleanup", () => {
  it("preserves focus and deletes reference suffix", () => {
    const raw = `FOCUS700${USER_NOTE_ZONE_SEPARATOR}${"R".repeat(3000)}`;
    assert.equal(stripLegacyUserNoteReferenceZone(raw), "FOCUS700");
  });

  it("legacy no-separator keeps first 1000 only", () => {
    assert.equal(stripLegacyUserNoteReferenceZone("F".repeat(1600)).length, 1000);
  });

  it("migration clears reference chars in DB", () => {
    const db = getDb();
    db.prepare(`UPDATE users SET user_note=? WHERE id=?`).run(
      `KEEP${USER_NOTE_ZONE_SEPARATOR}${"X".repeat(100)}`,
      USER
    );
    const stats = migrateUserNoteReferenceZoneCleanup(db);
    assert.ok(stats.usersUpdated >= 0);
    const row = db.prepare(`SELECT user_note FROM users WHERE id=?`).get(USER) as { user_note: string };
    assert.equal(row.user_note, "KEEP");
    assert.ok(!row.user_note.includes(USER_NOTE_ZONE_SEPARATOR));
  });
});

describe("prompt assembly", () => {
  it("uses user-lorebook section instead of reference RAG", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [],
      userNickname: "U",
      userNote: "FOCUS_TEXT",
      focusMaxChars: 1000,
      userLorebookBlock: "[USER LOREBOOK - 개인 키워드 매칭, 원문 그대로 적용]\nUSER_BLOCK",
      keywordLorebookBlock: "[KEYWORD LOREBOOK - 최근 visible 대화/현재 입력 키워드 매칭, 원문 그대로 적용]\nCREATOR_BLOCK",
      shortTermHistory: [],
      currentUserMessage: "hi",
      nsfw: false,
      modelId: "google/gemini-2.5-flash",
      provider: "openrouter",
    });
    const ids = (built.meta?.trackedSections ?? []).map((s) => s.id);
    assert.ok(ids.includes("user-lorebook"));
    assert.ok(!ids.includes("user-note-reference"));
    assert.equal(ids.filter((id) => id === "user-lorebook").length, 1);
  });
});

describe("carryover isolation", () => {
  it("creator entry A and user entry A do not collide", () => {
    const db = getDb();
    db.prepare(`UPDATE keyword_lorebooks SET entries_json=? WHERE id=?`).run(
      JSON.stringify([{ keywords: ["KW_A"], content: "CREATOR_A_BODY" }]),
      CREATOR_LOREBOOK
    );
    const userBook = getOrCreateUserLorebookForChat(db, CHAT, USER);
    saveUserLorebookEntries(db, CHAT, USER, [entry("USER_A_BODY", ["KW_A"])]);
    const activation = buildLorebookActivationText({ currentUserMessage: "KW_A" });
    loadAttachedCreatorLorebooksPromptBlockFromActivation(db, CHAR, activation, {
      chatId: CHAT,
      currentTurn: 2,
    });
    loadUserLorebookPromptBlockFromActivation(db, {
      chatId: CHAT,
      userId: USER,
      capability: FREE_CAPABILITY,
      activation,
      currentTurn: 2,
    });
    const rows = db
      .prepare(`SELECT lorebook_id, content FROM lorebook_active_entries WHERE chat_id=?`)
      .all(CHAT) as Array<{ lorebook_id: number; content: string }>;
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.lorebook_id === CREATOR_LOREBOOK));
    assert.ok(rows.some((r) => r.lorebook_id === userBook.id));
  });
});
