import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { resolveEffectiveUserAuthoringFromChatColumn } from "@/lib/userCoauthorState";
import { resolveUserImpersonationAllowance } from "@/lib/userImpersonationPolicy";
import { buildContext } from "@/services/contextBuilder";
import { matchesModelPickerSnapshotCache } from "@/services/modelPickerInputSnapshot";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/services/modelPickerInputSnapshot.ts"),
  "utf8"
);

function fixture(level: string, legacyOoc = "", persistentMode = "OFF", legacyInNote = false) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_authoring_level TEXT NOT NULL DEFAULT 'LIMITED',
      user_coauthor_mode TEXT NOT NULL DEFAULT 'OFF'
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      user_coauthor_semantics_version INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare("INSERT INTO chats (id, user_authoring_level, user_coauthor_mode) VALUES (1, ?, ?)")
    .run(level, persistentMode);
  if (persistentMode !== "OFF") {
    db.prepare("INSERT INTO messages (chat_id, role, content, user_coauthor_semantics_version) VALUES (1, 'user', 'OOC: 내 캐릭터 전권.', 2)").run();
  }
  const delegation = resolveEffectiveUserAuthoringFromChatColumn(db, 1, "").delegation;
  const legacy = resolveUserImpersonationAllowance(
    legacyInNote ? { userNote: legacyOoc } : { personaDescription: legacyOoc }
  );
  const build = (useCanonical: boolean) => buildContext({
    charName: "리오",
    chunks: [],
    userNickname: "유저",
    shortTermHistory: [],
    currentUserMessage: "",
    nsfw: false,
    provider: "openrouter",
    userImpersonation: legacy,
    ...(useCanonical ? { currentTurnAuthoringDelegation: delegation } : {}),
  });
  const prompt = (useCanonical: boolean) => build(useCanonical).systemPrompt;
  return { db, delegation, legacy, build, prompt };
}

describe("model picker authoring owner parity", () => {
  it("LIMITED without OOC keeps the same assembled authoring prompt", () => {
    const f = fixture("LIMITED");
    assert.equal(f.prompt(false), f.prompt(true));
    f.db.close();
  });

  it("reproduces the old direct-caller mismatch for NORMAL, ALLOW, persistent OOC and legacy OOC text", () => {
    for (const [level, legacyOoc, persistentMode] of [
      ["NORMAL", "", "OFF"],
      ["ALLOW", "", "OFF"],
      ["LIMITED", "", "ABSOLUTE"],
      ["LIMITED", "(OOC: 유저 사칭 허용)", "OFF"],
    ]) {
      const f = fixture(level, legacyOoc, persistentMode);
      assert.notEqual(f.prompt(false), f.prompt(true), `${level}/${persistentMode}/${legacyOoc}`);
      const oldTokens = f.build(false).meta.promptAudit?.totalAssembledTokens;
      const canonicalTokens = f.build(true).meta.promptAudit?.totalAssembledTokens;
      assert.ok(typeof oldTokens === "number" && oldTokens > 0);
      assert.ok(typeof canonicalTokens === "number" && canonicalTokens > 0);
      assert.notEqual(oldTokens, canonicalTokens);
      f.db.close();
    }
    const note = fixture("LIMITED", "(OOC: 유저 사칭 허용)", "OFF", true);
    assert.notEqual(note.prompt(false), note.prompt(true));
    note.db.close();
  });

  it("routes picker assembly through the same canonical delegation as Main RP", () => {
    assert.match(source, /resolveEffectiveUserAuthoringFromChatColumn\(/);
    assert.match(source, /currentTurnAuthoringDelegation:\s*effectiveUserAuthoring\.delegation/);
    assert.match(source, /coNarrationEnabled: effectiveUserAuthoring\.delegation\.allowDialogue === true/);
    assert.doesNotMatch(source, /resolveUserImpersonationAllowance/);
  });

  it("includes effective authoring state in the snapshot cache dependency", () => {
    assert.match(source, /cached\.authoringFingerprint === current\.authoringFingerprint/);
    assert.match(source, /matchesModelPickerSnapshotCache\(cached,/);
    assert.match(source, /if \(!opts\.refresh && cacheMatches\)/);
  });

  it("LIMITED/NORMAL/ALLOW, persistent OOC and legacy text use canonical prompt authority", () => {
    for (const [level, note, mode, dialogue, actions, innerPov, fate] of [
      ["LIMITED", "", "OFF", false, false, false, false],
      ["NORMAL", "", "OFF", true, true, false, false],
      ["ALLOW", "", "OFF", true, true, true, false],
      ["LIMITED", "", "ABSOLUTE", true, true, true, true],
      ["LIMITED", "(OOC: 유저 사칭 허용)", "OFF", false, false, false, false],
    ] as const) {
      const f = fixture(level, note, mode);
      assert.equal(f.delegation.allowDialogue, dialogue);
      assert.equal(f.delegation.allowMajorActions, actions);
      assert.equal(f.delegation.allowInnerPov, innerPov);
      assert.equal(f.delegation.allowIrreversibleFate, fate);
      assert.equal(f.delegation.allowAiCastIrreversibleExpansion, level === "ALLOW" || fate);
      if (note) assert.equal(f.legacy, true);
      assert.match(f.prompt(true), /USER AUTHORING|NO GODMODDING|유저/);
      f.db.close();
    }
    const note = fixture("LIMITED", "(OOC: 유저 사칭 허용)", "OFF", true);
    assert.equal(note.legacy, true);
    assert.equal(note.delegation.active, false);
    note.db.close();
  });

  it("slider and epoch reset miss cache even when message count does not change", () => {
    const key = (db: Database.Database) => ({
      messageCount: 1,
      chatMode: "safe",
      personaId: null,
      userNote: "",
      targetResponseChars: 2500,
      authoringFingerprint: JSON.stringify(
        resolveEffectiveUserAuthoringFromChatColumn(db, 1, "").delegation
      ),
    });
    const slider = fixture("NORMAL");
    const beforeSlider = { ...key(slider.db), tokensByModel: {} };
    assert.equal(matchesModelPickerSnapshotCache(beforeSlider, key(slider.db)), true);
    slider.db.prepare("UPDATE chats SET user_authoring_level='ALLOW' WHERE id=1").run();
    assert.equal(matchesModelPickerSnapshotCache(beforeSlider, key(slider.db)), false);
    slider.db.close();

    const epoch = fixture("NORMAL", "", "ABSOLUTE");
    const beforeReset = { ...key(epoch.db), tokensByModel: {} };
    epoch.db.prepare("UPDATE chats SET user_authoring_level='ALLOW', user_coauthor_mode='OFF' WHERE id=1").run();
    epoch.db.prepare("UPDATE messages SET user_coauthor_semantics_version=0 WHERE chat_id=1").run();
    assert.equal(matchesModelPickerSnapshotCache(beforeReset, key(epoch.db)), false);
    const afterReset = { ...key(epoch.db), tokensByModel: {} };
    assert.equal(matchesModelPickerSnapshotCache(afterReset, key(epoch.db)), true);
    epoch.db.close();
  });

  it("canonical resolver reads an already-migrated database without writes", () => {
    const f = fixture("NORMAL");
    f.db.pragma("query_only = ON");
    assert.equal(resolveEffectiveUserAuthoringFromChatColumn(f.db, 1, "").delegation.allowDialogue, true);
    f.db.close();
  });
});
