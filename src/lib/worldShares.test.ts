import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDb } from "@/lib/db";
import {
  createWorldShare,
  getWorldShareBySlug,
  importWorldShareToUser,
  worldShareApplyPath,
} from "@/lib/worldShares";

function seedUser(id: number, nickname: string) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,0)"
    )
    .run(id, `user${id}@test.local`, nickname, "hash");
}

describe("worldShares", () => {
  it("creates share slug and imports as shared world for another user", () => {
    seedUser(911, "world-sharer");
    seedUser(912, "world-importer");
    const db = getDb();
    const info = db
      .prepare(
        `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .run(911, "테스트 세계", "요약", "본문 내용입니다.");
    const worldId = Number(info.lastInsertRowid);

    const created = createWorldShare(911, worldId);
    assert.ok(!("error" in created));
    if ("error" in created) return;

    assert.equal(created.applyPath, worldShareApplyPath(created.share.share_slug));
    const pub = getWorldShareBySlug(created.share.share_slug);
    assert.ok(pub);
    assert.equal(pub!.authorNickname, "world-sharer");
    assert.equal(pub!.name, "테스트 세계");
    assert.equal(pub!.content, "본문 내용입니다.");

    const imported = importWorldShareToUser(912, created.share.share_slug, "내 복사본");
    assert.equal(imported.ok, true);
    if (!imported.ok) return;

    assert.equal(imported.world.name, "내 복사본");
    assert.equal(imported.world.sharedFromNickname, "world-sharer");
    assert.equal(imported.world.content, "본문 내용입니다.");

    const row = db
      .prepare(
        `SELECT creator_id, name, shared_from_nickname FROM worlds WHERE id = ?`
      )
      .get(imported.world.id) as {
      creator_id: number;
      name: string;
      shared_from_nickname: string;
    };
    assert.equal(row.creator_id, 912);
    assert.equal(row.name, "내 복사본");
    assert.equal(row.shared_from_nickname, "world-sharer");
  });
});
