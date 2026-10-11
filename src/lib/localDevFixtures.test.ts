import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { listableWhere } from "@/lib/characterVisibility";
import {
  ensureLocalUiFixtures,
  LOCAL_DRAFT_ID,
  LOCAL_KANG_ID,
  LOCAL_LUCIAN_ID,
  LOCAL_SYNTHETIC_COUNT,
  LOCAL_UI_ADMIN_EMAIL,
  LOCAL_UI_CREATOR_EMAIL,
  LOCAL_UI_FIXTURES_META_KEY,
  LOCAL_UI_OFFICIAL_STUDIO_EMAIL,
  LOCAL_UI_ROMANCE_STUDIO_EMAIL,
  LOCAL_UI_USER_EMAIL,
  shouldInstallLocalUiFixtures,
} from "@/lib/localDevFixtures";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

describe("local UI fixtures", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  it("does not auto-install during regular tests", () => {
    assert.equal(process.env.HAV_LOCAL_UI_FIXTURES, undefined);
    assert.equal(shouldInstallLocalUiFixtures(), false);
  });

  it("installs official public rows and synthetic density without duplicating", () => {
    const db = getDb();
    const first = ensureLocalUiFixtures(db, { allowNetwork: false });
    const second = ensureLocalUiFixtures(db, { allowNetwork: false });

    assert.equal(first.officialIds.length, 2);
    assert.equal(first.syntheticIds.length, LOCAL_SYNTHETIC_COUNT);
    assert.deepEqual(first.officialIds, second.officialIds);
    assert.deepEqual(first.syntheticIds, second.syntheticIds);

    const emails = db.prepare("SELECT email FROM users").all() as { email: string }[];
    const fixtureEmails = emails
      .map((row) => row.email)
      .filter((email) => email.endsWith(".invalid") || email.endsWith("@test.local"));
    assert.ok(fixtureEmails.includes(LOCAL_UI_USER_EMAIL));
    assert.ok(fixtureEmails.includes(LOCAL_UI_ADMIN_EMAIL));
    assert.ok(fixtureEmails.includes(LOCAL_UI_CREATOR_EMAIL));
    assert.ok(fixtureEmails.includes(LOCAL_UI_OFFICIAL_STUDIO_EMAIL));
    assert.ok(fixtureEmails.includes(LOCAL_UI_ROMANCE_STUDIO_EMAIL));
    assert.equal(
      emails.filter((row) => !row.email.endsWith(".invalid") && !row.email.endsWith("@test.local")).length,
      0
    );

    const published = db
      .prepare("SELECT id, name, official, visibility, creator_id FROM characters WHERE id IN (?,?)")
      .all(LOCAL_KANG_ID, LOCAL_LUCIAN_ID) as Array<{
      id: number;
      name: string;
      official: number;
      visibility: string;
      creator_id: number | null;
    }>;
    assert.equal(published.length, 2);
    const kangRow = published.find((row) => row.id === LOCAL_KANG_ID);
    const lucianRow = published.find((row) => row.id === LOCAL_LUCIAN_ID);
    assert.equal(kangRow?.official, 0);
    assert.equal(lucianRow?.official, 1);
    assert.ok(published.every((row) => row.visibility === "public" && row.creator_id != null));

    const listable = db
      .prepare(`SELECT COUNT(*) AS c FROM characters WHERE ${listableWhere()}`)
      .get() as { c: number };
    assert.ok(listable.c >= 2 + LOCAL_SYNTHETIC_COUNT);

    const draft = db
      .prepare("SELECT visibility, official FROM characters WHERE id=?")
      .get(LOCAL_DRAFT_ID) as { visibility: string; official: number };
    assert.equal(draft.visibility, "private");
    assert.equal(draft.official, 0);

    const listedDraft = db
      .prepare(`SELECT COUNT(*) AS c FROM characters WHERE id=? AND ${listableWhere()}`)
      .get(LOCAL_DRAFT_ID) as { c: number };
    assert.equal(listedDraft.c, 0);

    const kang = db.prepare("SELECT images, assets FROM characters WHERE id=?").get(LOCAL_KANG_ID) as {
      images: string;
      assets: string;
    };
    assert.match(kang.images, /uploads\/daf5931a-b453-4e53-adc3-c5c018dc0509\.png|hav\.chat\/uploads/);
    assert.match(kang.assets, /representativeRank/);

    const userCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM users WHERE email IN (?,?,?,?,?)`
      )
      .get(
        LOCAL_UI_USER_EMAIL,
        LOCAL_UI_ADMIN_EMAIL,
        LOCAL_UI_CREATOR_EMAIL,
        LOCAL_UI_OFFICIAL_STUDIO_EMAIL,
        LOCAL_UI_ROMANCE_STUDIO_EMAIL
      ) as { c: number };
    assert.equal(userCount.c, 5);

    const chatCount = db
      .prepare("SELECT COUNT(*) AS c FROM chats WHERE title='[local-fixture] ranking'")
      .get() as { c: number };
    assert.equal(chatCount.c, 3);

    const meta = db
      .prepare("SELECT value FROM app_meta WHERE key=?")
      .get(LOCAL_UI_FIXTURES_META_KEY) as { value: string };
    assert.equal(meta.value, "1");

    const worlds = db
      .prepare("SELECT COUNT(*) AS c FROM worlds WHERE name='로컬 TRPG 테스트 월드'")
      .get() as { c: number };
    assert.equal(worlds.c, 1);
  });
});
