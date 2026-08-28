import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDb } from "@/lib/db";
import {
  borrowWorldShareToUser,
  createWorldShare,
  getWorldShareBySlug,
  worldShareApplyPath,
} from "@/lib/worldShares";

function seedUser(id: number, nickname: string) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
    )
    .run(id, `user${id}@test.local`, nickname, "hash");
}

describe("worldShares", () => {
  it("creates share slug and borrows as read-only library reference", () => {
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

    const borrowed = borrowWorldShareToUser(912, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    assert.equal(borrowed.world.name, "테스트 세계");
    assert.equal(borrowed.world.sharedFromNickname, "world-sharer");
    assert.equal(borrowed.world.content, "본문 내용입니다.");
    assert.equal(borrowed.world.libraryKind, "borrowed");
    assert.equal(borrowed.world.readOnly, true);

    const importerWorldRows = db
      .prepare(`SELECT id FROM worlds WHERE creator_id = ?`)
      .all(912) as Array<{ id: number }>;
    assert.equal(importerWorldRows.length, 0);

    const borrowRow = db
      .prepare(`SELECT user_id, world_share_id FROM world_borrows WHERE id = ?`)
      .get(borrowed.borrow.id) as { user_id: number; world_share_id: number };
    assert.equal(borrowRow.user_id, 912);
    assert.equal(borrowRow.world_share_id, created.share.id);
  });
});
