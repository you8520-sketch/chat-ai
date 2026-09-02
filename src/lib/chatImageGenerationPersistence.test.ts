import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { listCharacterAlbum, ensureCharacterImageAlbumTable } from "@/lib/chatImageAlbum";
import { getDb } from "@/lib/db";
import {
  ensureChatImageGenerationsTable,
  persistChatImageGenerationResult,
} from "@/lib/chatImageGenerationPersistence";
import {
  creditPointsWithIds,
  deductPointsOnDb,
  getPointBalance,
} from "@/lib/points";
import { refundDeductionSlices } from "@/lib/refund";

const USER_ID_BASE = 990_200_000;
let nextUserId = USER_ID_BASE;
const uniqueUserId = () => ++nextUserId;

function seedUser(userId: number) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)`).run(
    userId,
    `persist-test-${userId}@example.com`,
    `persist-test-${userId}`,
    "hash"
  );
  creditPointsWithIds(db, userId, 5000, "FREE", "test seed");
}

describe("chatImageGenerationPersistence", () => {
  before(() => {
    ensureChatImageGenerationsTable();
    ensureCharacterImageAlbumTable();
  });

  after(() => {
    const db = getDb();
    db.prepare(`DELETE FROM character_image_album WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM chat_image_generations WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM point_logs WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM point_transactions WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM users WHERE id > ?`).run(USER_ID_BASE);
  });

  it("C3: durable persist writes history and album atomically", () => {
    const userId = uniqueUserId();
    seedUser(userId);
    const resultUrl = `/uploads/test-comic-${userId}.webp`;
    const persisted = persistChatImageGenerationResult({
      userId,
      chatId: 12,
      characterId: 3,
      personaId: 4,
      templateId: "comic",
      model: "gpt-image-2",
      optionsJson: { mode: "comic", panelCount: 3 },
      resultUrl,
      upstreamCostUsd: 0.01,
      chargedPoints: 120,
      deductionSlices: [],
      exchangeRateKrwPerUsd: 1400,
      album: { mode: "comic" },
    });
    assert.ok(persisted.generationId > 0);

    const db = getDb();
    const row = db
      .prepare(`SELECT id, result_url FROM chat_image_generations WHERE id=?`)
      .get(persisted.generationId) as { id: number; result_url: string };
    assert.equal(row.result_url, resultUrl);

    const album = listCharacterAlbum(userId, 3);
    assert.ok(album.some((entry) => entry.imageUrl === resultUrl && entry.mode === "comic"));
  });

  it("C1: album failure rolls back history insert", () => {
    const userId = uniqueUserId();
    seedUser(userId);
    const db = getDb();
    const resultUrl = `/uploads/test-comic-fail-${userId}.webp`;
    const beforeCount = (
      db.prepare(`SELECT COUNT(*) as c FROM chat_image_generations WHERE result_url=?`).get(resultUrl) as {
        c: number;
      }
    ).c;

    db.exec(`
      CREATE TRIGGER chat_image_album_persist_test_fail
      BEFORE INSERT ON character_image_album
      BEGIN
        SELECT RAISE(ABORT, 'album insert forced failure');
      END;
    `);

    try {
      assert.throws(
        () =>
          persistChatImageGenerationResult({
            userId,
            chatId: 12,
            characterId: 3,
            personaId: 4,
            templateId: "comic",
            model: "gpt-image-2",
            optionsJson: { mode: "comic", panelCount: 2 },
            resultUrl,
            upstreamCostUsd: null,
            chargedPoints: 80,
            deductionSlices: [],
            exchangeRateKrwPerUsd: 1400,
            album: { mode: "comic" },
          }),
        /album insert forced failure/
      );
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS chat_image_album_persist_test_fail`);
    }

    const afterCount = (
      db.prepare(`SELECT COUNT(*) as c FROM chat_image_generations WHERE result_url=?`).get(resultUrl) as {
        c: number;
      }
    ).c;
    assert.equal(afterCount, beforeCount);
  });

  it("C8: refundDeductionSlices restores deducted points exactly once", () => {
    const userId = uniqueUserId();
    seedUser(userId);
    const db = getDb();
    const before = getPointBalance(userId).total;
    const deducted = db.transaction(() =>
      deductPointsOnDb(db, userId, 120, "comic test charge")
    )();
    assert.ok(deducted.total > 0);
    assert.ok(before - getPointBalance(userId).total >= 120);

    const restored = refundDeductionSlices(
      userId,
      deducted.slices,
      deducted.total,
      "comic persistence failure refund"
    );
    assert.equal(restored.total, before);
  });
});
