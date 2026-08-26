import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  listCharactersForModeration,
  reviewCharacterListing,
} from "./characterModerationAdmin";
import { decideCharacterListing } from "./characterListingModeration";
import type { CharacterAsset } from "./characterAssets";

const cleanAsset: CharacterAsset = {
  url: "/uploads/face.webp",
  tag: "무표정",
  adultFlagged: false,
  moderationReject: false,
};
const adultAsset: CharacterAsset = {
  url: "/uploads/nsfw.webp",
  tag: "침실",
  adultFlagged: true,
  moderationReject: false,
};
const legacyUnknownAsset: CharacterAsset = {
  url: "/uploads/legacy.webp",
  tag: "기쁨",
};

function setupDb(withUpdatedAt = true): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nsfw INTEGER NOT NULL DEFAULT 0,
      official INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'public',
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      moderation_note TEXT NOT NULL DEFAULT '',
      creator_id INTEGER,
      creator_name TEXT NOT NULL DEFAULT '',
      assets TEXT NOT NULL DEFAULT '[]',
      images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT '2026-01-01',
      ${withUpdatedAt ? "updated_at TEXT NOT NULL DEFAULT ''," : ""}
      share_slug TEXT
    );
  `);
  return db;
}

function insertCharacter(
  db: Database.Database,
  input: {
    name: string;
    nsfw?: number;
    official?: number;
    visibility?: string;
    moderation_status?: string;
    moderation_note?: string;
    assets?: CharacterAsset[];
    creator_id?: number | null;
  }
): number {
  const info = db
    .prepare(
      `INSERT INTO characters
        (name, nsfw, official, visibility, moderation_status, moderation_note, assets, images, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.nsfw ?? 1,
      input.official ?? 0,
      input.visibility ?? "public",
      input.moderation_status ?? "pending",
      input.moderation_note ?? "",
      JSON.stringify(input.assets ?? []),
      JSON.stringify((input.assets ?? []).map((a) => a.url)),
      input.creator_id ?? null
    );
  return Number(info.lastInsertRowid);
}

describe("admin listing moderation queue", () => {
  it("A. ambiguous asset is pending, listed, and reviewable", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [adultAsset],
    });
    assert.equal(decided.moderationStatus, "pending");

    const db = setupDb();
    const id = insertCharacter(db, {
      name: "성인플래그",
      moderation_status: decided.moderationStatus,
      moderation_note: decided.moderationNote,
      assets: [adultAsset],
    });
    const pending = listCharactersForModeration(db, "pending");
    const row = pending.find((item) => item.id === id);
    assert.ok(row);
    assert.equal(row.assets.some((asset) => asset.adultFlagged === true), true);
    const approved = reviewCharacterListing(db, id, 1, "approve", "확인");
    assert.equal(approved.ok, true);
    assert.equal(listCharactersForModeration(db, "pending").some((item) => item.id === id), false);
  });

  it("B. safe asset is approved and stays out of the pending queue", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [cleanAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    const db = setupDb();
    const id = insertCharacter(db, {
      name: "안전",
      moderation_status: decided.moderationStatus,
      assets: [cleanAsset],
    });
    assert.equal(listCharactersForModeration(db, "pending").some((item) => item.id === id), false);
  });

  it("C. legacy unknown is not fake adult-image pending", () => {
    const decided = decideCharacterListing({
      requestedVisibility: "public",
      nsfw: true,
      assets: [legacyUnknownAsset],
    });
    assert.equal(decided.moderationStatus, "approved");
    assert.doesNotMatch(decided.moderationNote, /성인 에셋 검열/);
    assert.match(decided.moderationNote, /레거시/);
    const db = setupDb();
    const id = insertCharacter(db, {
      name: "레거시",
      moderation_status: decided.moderationStatus,
      assets: [legacyUnknownAsset],
    });
    assert.equal(listCharactersForModeration(db, "pending").some((item) => item.id === id), false);
  });

  it("D. leftover official pending is still visible and reviewable", () => {
    const db = setupDb();
    const id = insertCharacter(db, {
      name: "공식잔여",
      official: 1,
      moderation_status: "pending",
      assets: [adultAsset],
    });
    const pending = listCharactersForModeration(db, "pending");
    assert.ok(pending.some((item) => item.id === id));
    const result = reviewCharacterListing(db, id, 1, "approve", "공식 잔여 해소");
    assert.equal(result.ok, true);
  });

  it("E. approve removes the row from pending", () => {
    const db = setupDb();
    const id = insertCharacter(db, {
      name: "승인대상",
      moderation_status: "pending",
      assets: [adultAsset],
    });
    assert.equal(reviewCharacterListing(db, id, 1, "approve", "").ok, true);
    assert.equal(listCharactersForModeration(db, "pending").length, 0);
  });

  it("F. reject sets rejected + private", () => {
    const db = setupDb();
    const id = insertCharacter(db, {
      name: "반려대상",
      visibility: "public",
      moderation_status: "pending",
      assets: [adultAsset],
    });
    assert.equal(reviewCharacterListing(db, id, 1, "reject", "반려 메모").ok, true);
    const after = db
      .prepare(`SELECT visibility, moderation_status, share_slug FROM characters WHERE id=?`)
      .get(id) as { visibility: string; moderation_status: string; share_slug: string | null };
    assert.equal(after.visibility, "private");
    assert.equal(after.moderation_status, "rejected");
    assert.equal(after.share_slug, null);
    assert.equal(listCharactersForModeration(db, "pending").length, 0);
    assert.equal(listCharactersForModeration(db, "rejected").some((item) => item.id === id), true);
  });

  it("still lists pending when characters.updated_at is missing", () => {
    const db = setupDb(false);
    const id = insertCharacter(db, {
      name: "컬럼없음",
      moderation_status: "pending",
      assets: [adultAsset],
    });
    const pending = listCharactersForModeration(db, "pending");
    assert.ok(pending.some((item) => item.id === id));
    assert.equal(pending[0]?.assets[0]?.adultFlagged, true);
  });
});
