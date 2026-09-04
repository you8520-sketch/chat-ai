import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { listCharacterAlbum, ensureCharacterImageAlbumTable } from "@/lib/chatImageAlbum";
import { getDb } from "@/lib/db";
import {
  ensureChatImageGenerationsTable,
  settleChatImageGenerationResult,
} from "@/lib/chatImageGenerationPersistence";
import {
  creditPointsWithIds,
  getPointBalance,
  InsufficientPointsError,
} from "@/lib/points";

const USER_ID_BASE = 990_200_000;
let nextUserId = USER_ID_BASE;
const uniqueUserId = () => ++nextUserId;

function seedUser(userId: number, points = 5000) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)`).run(
    userId,
    `persist-test-${userId}@example.com`,
    `persist-test-${userId}`,
    "hash"
  );
  creditPointsWithIds(db, userId, points, "FREE", "test seed");
}

function settleInput(userId: number, resultUrl: string, chargePoints = 120) {
  return {
    userId,
    chatId: 12,
    characterId: 3,
    personaId: 4,
    templateId: "comic",
    model: "gpt-image-2",
    optionsJson: { mode: "comic", panelCount: 3 },
    resultUrl,
    upstreamCostUsd: 0.01,
    exchangeRateKrwPerUsd: 1400,
    chargePoints,
    chargeReason: "comic settlement test",
    album: { mode: "comic" as const },
  };
}

describe("chatImageGenerationPersistence settlement", () => {
  before(() => {
    ensureChatImageGenerationsTable();
    ensureCharacterImageAlbumTable();
  });

  after(() => {
    const db = getDb();
    db.prepare(`DELETE FROM image_generation_creator_earnings WHERE consumer_user_id > ? OR creator_id > ?`).run(USER_ID_BASE, USER_ID_BASE);
    db.prepare(`DELETE FROM creator_point_logs WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM character_image_album WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM chat_image_generations WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM point_logs WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM point_transactions WHERE user_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM characters WHERE creator_id > ?`).run(USER_ID_BASE);
    db.prepare(`DELETE FROM users WHERE id > ?`).run(USER_ID_BASE);
  });

  it("C3: all succeed deducts once and writes history + album", () => {
    const userId = uniqueUserId();
    seedUser(userId);
    const before = getPointBalance(userId).total;
    const resultUrl = `/uploads/test-comic-${userId}.webp`;
    const settled = settleChatImageGenerationResult(settleInput(userId, resultUrl));
    assert.ok(settled.generationId > 0);
    assert.equal(settled.chargedPoints, 120);
    assert.equal(getPointBalance(userId).total, before - 120);

    const db = getDb();
    const row = db
      .prepare(`SELECT id, result_url FROM chat_image_generations WHERE id=?`)
      .get(settled.generationId) as { id: number; result_url: string };
    assert.equal(row.result_url, resultUrl);

    const album = listCharacterAlbum(userId, 3);
    assert.ok(album.some((entry) => entry.imageUrl === resultUrl && entry.mode === "comic"));
  });

  it("C1: album failure rolls back point deduction and history insert", () => {
    const userId = uniqueUserId();
    seedUser(userId);
    const before = getPointBalance(userId).total;
    const db = getDb();
    const resultUrl = `/uploads/test-comic-fail-album-${userId}.webp`;
    const historyBefore = (
      db.prepare(`SELECT COUNT(*) as c FROM chat_image_generations WHERE result_url=?`).get(resultUrl) as {
        c: number;
      }
    ).c;

    db.exec(`
      CREATE TRIGGER chat_image_album_settle_test_fail
      BEFORE INSERT ON character_image_album
      BEGIN
        SELECT RAISE(ABORT, 'album insert forced failure');
      END;
    `);

    try {
      assert.throws(
        () => settleChatImageGenerationResult(settleInput(userId, resultUrl)),
        /album insert forced failure/
      );
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS chat_image_album_settle_test_fail`);
    }

    assert.equal(getPointBalance(userId).total, before);
    const historyAfter = (
      db.prepare(`SELECT COUNT(*) as c FROM chat_image_generations WHERE result_url=?`).get(resultUrl) as {
        c: number;
      }
    ).c;
    assert.equal(historyAfter, historyBefore);
    assert.equal(listCharacterAlbum(userId, 3).some((entry) => entry.imageUrl === resultUrl), false);
  });

  it("C2: history failure rolls back point deduction and album insert", () => {
    const userId = uniqueUserId();
    seedUser(userId);
    const before = getPointBalance(userId).total;
    const db = getDb();
    const resultUrl = `/uploads/test-comic-fail-history-${userId}.webp`;

    db.exec(`
      CREATE TRIGGER chat_image_generations_settle_test_fail
      BEFORE INSERT ON chat_image_generations
      BEGIN
        SELECT RAISE(ABORT, 'history insert forced failure');
      END;
    `);

    try {
      assert.throws(
        () => settleChatImageGenerationResult(settleInput(userId, resultUrl)),
        /history insert forced failure/
      );
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS chat_image_generations_settle_test_fail`);
    }

    assert.equal(getPointBalance(userId).total, before);
    assert.equal(listCharacterAlbum(userId, 3).some((entry) => entry.imageUrl === resultUrl), false);
  });

  it("C4: insufficient points leaves no generation or album rows", () => {
    const userId = uniqueUserId();
    seedUser(userId, 50);
    const before = getPointBalance(userId).total;
    const resultUrl = `/uploads/test-comic-insufficient-${userId}.webp`;
    assert.throws(
      () => settleChatImageGenerationResult(settleInput(userId, resultUrl, 120)),
      (error: unknown) => error instanceof InsufficientPointsError
    );
    assert.equal(getPointBalance(userId).total, before);
    assert.equal(listCharacterAlbum(userId, 3).some((entry) => entry.imageUrl === resultUrl), false);
    const db = getDb();
    const historyCount = (
      db.prepare(`SELECT COUNT(*) as c FROM chat_image_generations WHERE result_url=?`).get(resultUrl) as {
        c: number;
      }
    ).c;
    assert.equal(historyCount, 0);
  });

  it("C6: committed settlement remains queryable after call returns", () => {
    const userId = uniqueUserId();
    seedUser(userId);
    const resultUrl = `/uploads/test-comic-durable-${userId}.webp`;
    const settled = settleChatImageGenerationResult(settleInput(userId, resultUrl));
    const db = getDb();
    const row = db
      .prepare(`SELECT id FROM chat_image_generations WHERE id=?`)
      .get(settled.generationId);
    assert.ok(row);
    assert.ok(listCharacterAlbum(userId, 3).some((entry) => entry.imageUrl === resultUrl));
  });

  it("credits a fixed 15CP once when the character owner is sprout tier or above", () => {
    const consumerUserId = uniqueUserId();
    const creatorId = uniqueUserId();
    seedUser(consumerUserId);
    seedUser(creatorId, 0);
    const db = getDb();
    db.prepare(`INSERT INTO characters (name, creator_id) VALUES (?,?), (?,?)`).run(
      `reward-a-${creatorId}`,
      creatorId,
      `reward-b-${creatorId}`,
      creatorId
    );

    const input = {
      ...settleInput(consumerUserId, `/uploads/test-reward-${consumerUserId}.webp`, 180),
      creatorReward: { creatorId, source: "character" as const },
    };
    const settled = settleChatImageGenerationResult(input);
    const creator = db.prepare(`SELECT creator_points FROM users WHERE id=?`).get(creatorId) as {
      creator_points: number;
    };
    assert.equal(creator.creator_points, 15);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS n FROM image_generation_creator_earnings WHERE generation_id=?`).get(settled.generationId) as { n: number }).n,
      1
    );
  });
});
