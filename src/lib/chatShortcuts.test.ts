import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { CHAT_MESSAGE_MAX } from "./chatModels";
import {
  CHAT_SHORTCUT_CONTENT_MAX,
  CHAT_SHORTCUT_NAME_MAX,
  shortcutComposerChangeAfterComposition,
  validateChatShortcutDraft,
} from "./chatShortcutComposer";
import {
  createChatShortcut,
  deleteChatShortcut,
  ensureChatShortcutsSchema,
  listChatShortcuts,
  updateChatShortcut,
} from "./chatShortcuts";
import { mergeShortcutList } from "./chatShortcutListSync";

describe("chat shortcut ownership", () => {
  test("stores personal shortcuts per user and hides other accounts", () => {
    const db = new Database(":memory:");
    const created = createChatShortcut(db, 7, {
      name: "인사",
      description: "첫 마디",
      content: "안녕",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const renamed = updateChatShortcut(db, 7, created.shortcut.id, {
      content: "안녕하세요",
      favorite: true,
    });
    assert.equal(renamed.ok, true);
    if (!renamed.ok) return;
    assert.equal(renamed.shortcut.favorite, true);
    assert.equal(renamed.shortcut.content, "안녕하세요");

    assert.deepEqual(listChatShortcuts(db, 8), []);
    assert.equal(updateChatShortcut(db, 8, created.shortcut.id, { name: "훔침" }).ok, false);
    assert.equal(deleteChatShortcut(db, 8, created.shortcut.id).ok, false);
    assert.equal(listChatShortcuts(db, 7)[0]?.content, "안녕하세요");
    assert.equal(deleteChatShortcut(db, 7, created.shortcut.id).ok, true);
    assert.deepEqual(listChatShortcuts(db, 7), []);
    db.close();
  });

  test("content limit is 500 and independent of the chat message limit", () => {
    assert.equal(CHAT_SHORTCUT_CONTENT_MAX, 500);
    assert.notEqual(CHAT_SHORTCUT_CONTENT_MAX, CHAT_MESSAGE_MAX);
    for (const [length, ok] of [
      [499, true],
      [500, true],
      [501, false],
    ] as const) {
      const parsed = validateChatShortcutDraft({ name: "김", content: "가".repeat(length) });
      assert.equal(parsed.ok, ok, `content ${length}`);
      if (!parsed.ok) assert.equal(parsed.error, "단축어 내용은 500자까지입니다.");
    }
  });

  test("name limit is 30 and description stays at 80", () => {
    assert.equal(CHAT_SHORTCUT_NAME_MAX, 30);
    assert.equal(validateChatShortcutDraft({ name: "가".repeat(30), content: "x" }).ok, true);
    const longName = validateChatShortcutDraft({ name: "가".repeat(31), content: "x" });
    assert.equal(longName.ok, false);
    if (!longName.ok) assert.equal(longName.error, "단축어 이름은 30자까지입니다.");
    assert.equal(
      validateChatShortcutDraft({ name: "가", description: "나".repeat(80), content: "x" }).ok,
      true
    );
    assert.equal(
      validateChatShortcutDraft({ name: "가", description: "나".repeat(81), content: "x" }).ok,
      false
    );
  });

  test("server create and patch enforce the 500 boundary", () => {
    const db = new Database(":memory:");
    const at500 = createChatShortcut(db, 1, { name: "경계", content: "가".repeat(500) });
    assert.equal(at500.ok, true);
    const at501 = createChatShortcut(db, 1, { name: "초과", content: "가".repeat(501) });
    assert.equal(at501.ok, false);
    if (at501.ok) return;
    assert.equal(at501.status, 400);
    assert.equal(at501.error, "단축어 내용은 500자까지입니다.");
    if (!at500.ok) return;
    const patched = updateChatShortcut(db, 1, at500.shortcut.id, { content: "가".repeat(501) });
    assert.equal(patched.ok, false);
    assert.equal(listChatShortcuts(db, 1)[0]?.content.length, 500);
    db.close();
  });

  test("legacy over-limit rows are neither truncated nor blocked from unrelated edits", () => {
    const db = new Database(":memory:");
    ensureChatShortcutsSchema(db);
    const legacyContent = "나".repeat(900);
    const legacyName = "긴".repeat(38);
    db.prepare(
      "INSERT INTO user_chat_shortcuts (user_id, name, description, content, favorite) VALUES (1, ?, '', ?, 0)"
    ).run(legacyName, legacyContent);
    const id = listChatShortcuts(db, 1)[0]!.id;

    const starred = updateChatShortcut(db, 1, id, { favorite: true });
    assert.equal(starred.ok, true);
    const sameFields = updateChatShortcut(db, 1, id, {
      name: legacyName,
      description: "설명만 추가",
      content: legacyContent,
    });
    assert.equal(sameFields.ok, true);
    assert.equal(listChatShortcuts(db, 1)[0]?.content, legacyContent);
    assert.equal(listChatShortcuts(db, 1)[0]?.name, legacyName);

    const longer = updateChatShortcut(db, 1, id, { content: `${legacyContent}!` });
    assert.equal(longer.ok, false);
    const shorter = updateChatShortcut(db, 1, id, { content: "가".repeat(500) });
    assert.equal(shorter.ok, true);
    db.close();
  });
});

describe("mergeShortcutList", () => {
  test("keeps a local create when an older list response is empty", () => {
    const created = {
      id: 9,
      favorite: false,
      updatedAt: "2026-10-20 00:00:00",
      name: "늦음",
    };
    const merged = mergeShortcutList(
      [],
      new Map([[created.id, created]]),
      new Set()
    );
    assert.deepEqual(merged, [created]);
  });

  test("does not restore a row deleted while the list request was in flight", () => {
    const server = [{ id: 3, favorite: false, updatedAt: "2026-10-20 00:00:00" }];
    const merged = mergeShortcutList(server, new Map(), new Set([3]));
    assert.deepEqual(merged, []);
  });
});

describe("shortcutComposerChangeAfterComposition", () => {
  test("ignores only the armed composition echo, not a later edit with the same text", () => {
    assert.deepEqual(
      shortcutComposerChangeAfterComposition({
        echoArmed: true,
        inputType: "insertCompositionText",
      }),
      { echoArmed: false, ignoreChange: true }
    );
    assert.deepEqual(
      shortcutComposerChangeAfterComposition({
        echoArmed: true,
        inputType: "deleteContentBackward",
      }),
      { echoArmed: false, ignoreChange: false }
    );
    assert.deepEqual(
      shortcutComposerChangeAfterComposition({
        echoArmed: false,
        inputType: "insertCompositionText",
      }),
      { echoArmed: false, ignoreChange: false }
    );
  });
});

describe("chat shortcut routes stay off the provider path", () => {
  test("shortcut route modules do not import chat generation or billing", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const files = [
      "src/app/api/chat/shortcuts/route.ts",
      "src/app/api/chat/shortcuts/[id]/route.ts",
      "src/lib/chatShortcuts.ts",
      "src/lib/chatShortcutComposer.ts",
      "src/lib/chatShortcutChips.ts",
      "src/components/ChatShortcutsDock.tsx",
    ];
    const banned = ["openrouter", "deductPoints", "chargePoints", "system_prompt", "/api/chat\""];
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      for (const token of banned) {
        assert.equal(source.includes(token), false, `${file} includes ${token}`);
      }
    }
  });
});
