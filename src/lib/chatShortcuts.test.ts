import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { CHAT_MESSAGE_MAX } from "./chatModels";
import {
  CHAT_SHORTCUT_INSERT_DEFERRED_MESSAGE,
  CHAT_SHORTCUT_INSERT_LOCKED_MESSAGE,
  CHAT_SHORTCUT_INSERT_TOO_LONG_MESSAGE,
  planChatShortcutInsert,
  validateChatShortcutDraft,
} from "./chatShortcutComposer";
import {
  createChatShortcut,
  deleteChatShortcut,
  listChatShortcuts,
  updateChatShortcut,
} from "./chatShortcuts";

describe("planChatShortcutInsert", () => {
  test("inserts at the caret and keeps the surrounding draft", () => {
    const plan = planChatShortcutInsert({
      composing: false,
      draft: "가나다",
      selectionStart: 1,
      selectionEnd: 2,
      insert: "!",
    });
    assert.equal(plan.action, "apply");
    if (plan.action !== "apply") return;
    assert.equal(plan.next, "가!나다");
    assert.equal(plan.caret, 2);
  });

  test("uses the committed DOM draft after Hangul composition", () => {
    const deferred = planChatShortcutInsert({
      composing: true,
      draft: "안",
      selectionStart: 1,
      selectionEnd: 1,
      insert: "!",
    });
    assert.deepEqual(deferred, { action: "defer", message: CHAT_SHORTCUT_INSERT_DEFERRED_MESSAGE });

    const plan = planChatShortcutInsert({
      composing: false,
      draft: "안",
      domDraft: "안녕",
      selectionStart: 2,
      selectionEnd: 2,
      insert: "!",
    });
    assert.equal(plan.action, "apply");
    if (plan.action !== "apply") return;
    assert.equal(plan.next, "안녕!");
  });

  test("refuses overflow without slicing the draft", () => {
    const draft = "가".repeat(CHAT_MESSAGE_MAX - 2);
    const plan = planChatShortcutInsert({
      composing: false,
      draft,
      selectionStart: draft.length,
      selectionEnd: draft.length,
      insert: "다다다",
    });
    assert.deepEqual(plan, {
      action: "reject",
      message: CHAT_SHORTCUT_INSERT_TOO_LONG_MESSAGE,
      draft,
    });
  });

  test("rejects insert while send is locked", () => {
    const plan = planChatShortcutInsert({
      composing: false,
      locked: true,
      draft: "초안",
      selectionStart: 2,
      selectionEnd: 2,
      insert: "!",
    });
    assert.equal(plan.action, "reject");
    if (plan.action !== "reject") return;
    assert.equal(plan.message, CHAT_SHORTCUT_INSERT_LOCKED_MESSAGE);
    assert.equal(plan.draft, "초안");
  });
});

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

  test("rejects a shortcut longer than the composer limit", () => {
    const parsed = validateChatShortcutDraft({
      name: "김",
      content: "가".repeat(CHAT_MESSAGE_MAX + 1),
    });
    assert.equal(parsed.ok, false);
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
