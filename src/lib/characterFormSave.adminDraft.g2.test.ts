import assert from "node:assert/strict";
import fs from "node:fs";
import { before, after, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, assertIsolatedTestDatabaseActive, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { createCharacterFromForm, updateCharacterFromForm, updateCharacterPublicProfileFromForm, parseCharacterFormBody } from "@/lib/characterFormSave";
import { buildOfficialCharacterFormBody } from "@/lib/officialSupply/characterText";
import { insertCreatorLorebookForOwner, listCharacterCreatorLorebookAttachmentIds } from "@/lib/creatorLorebook";
import { canAccessCharacter } from "@/lib/characterVisibility";
import { storePrivateMedia, writeMediaManifest } from "@/lib/mediaStorage";

const ADMIN = { id: 97381, nickname: "G2 관리자", email: "g2-admin@test.local", is_adult: 1, is_admin: 1 };
const USER = { id: 97382, nickname: "G2 일반", email: "g2-user@test.local", is_adult: 1, is_admin: 0 };
const root = "docs/official-supply/reviews/g2-2026-10-28/g1-original/";
const first = JSON.parse(fs.readFileSync(`${root}first-generation.json`, "utf8"));
const automatic = JSON.parse(fs.readFileSync(`${root}automatic-final-reconstructed.json`, "utf8"));
function body(draft = first.draft, overrides: Record<string, unknown> = {}) {
  return { ...buildOfficialCharacterFormBody({ draft, appearanceBlock: "", assets: [] }), ...overrides };
}

before(() => {
  installIsolatedTestDatabase();
  assertIsolatedTestDatabaseActive();
  const db = getDb();
  for (const user of [ADMIN, USER]) db.prepare("INSERT INTO users (id,email,nickname,pw_hash,is_adult,is_admin) VALUES (?,?,?,?,?,?)").run(user.id, user.email, user.nickname, "fixture", 1, user.is_admin);
});
after(uninstallIsolatedTestDatabase);

describe("G2 admin-owned image-free private draft in isolated SQLite", () => {
  it("rejects normal users, client admin flags, reviewer accounts, simulations and public/link requests", () => {
    for (const visibility of ["private", "public", "link"]) {
      const parsed = parseCharacterFormBody(body(first.draft, { visibility, isAdmin: true, is_admin: 1 }), USER);
      assert.equal(parsed.ok, false, visibility);
      if (!parsed.ok) assert.match(parsed.error, /이미지/);
    }
    for (const visibility of ["public", "link"]) assert.equal(parseCharacterFormBody(body(first.draft, { visibility }), ADMIN).ok, false);
    assert.equal(parseCharacterFormBody(body(), { ...ADMIN, account_kind: "portone_reviewer" }).ok, false);
    const simulation = parseCharacterFormBody(body(first.draft, { content_kind: "simulation", simulation_cast: "가상의 두 인물이 탐색한다. ".repeat(150) }), ADMIN);
    assert.equal(simulation.ok, false);
  });

  for (const [label, draft] of [["first manuscript", first.draft], ["automatic reconstructed candidate", automatic.draft]] as const) {
    it(`creates, reloads and edits the ${label} with original prose and no official status`, async () => {
      const db = getDb();
      const lore = insertCreatorLorebookForOwner(db, { creatorId: ADMIN.id, name: "G2 검증용 로어북", summary: "검증용", keywords: "정제탑", content: "격리 DB의 원문 보존 검증용 항목이다." });
      assert.ok(lore.ok);
      const payload = body(draft, { lorebook_ids: [lore.id] });
      const created = await createCharacterFromForm(ADMIN, payload);
      assert.ok(created.ok, !created.ok ? created.error : "");
      const id = created.id;
      const read = () => db.prepare("SELECT * FROM characters WHERE id=?").get(id) as Record<string, any>;
      const initial = read();
      assert.equal(initial.creator_id, ADMIN.id);
      assert.equal(initial.visibility, "private");
      assert.equal(initial.official, 0);
      assert.equal(initial.assets, "[]");
      assert.equal(initial.images, "[]");
      assert.equal(initial.description, draft.description);
      assert.equal(initial.greeting, draft.greeting);
      assert.equal(initial.creator_comment, payload.creator_comment);
      assert.equal(initial.system_prompt, payload.system_prompt);
      assert.equal(initial.world, payload.world);
      assert.ok(initial.example_dialog.includes(draft.speech.examples));
      assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(db, id), [lore.id]);
      assert.deepEqual(canAccessCharacter(initial as any, ADMIN.id), { ok: true });
      assert.equal(canAccessCharacter(initial as any, USER.id).ok, false);
      const chatId = Number(db.prepare("INSERT INTO chats (user_id,character_id) VALUES (?,?)").run(ADMIN.id, id).lastInsertRowid);
      db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,'assistant',?)").run(chatId, draft.greeting);

      assert.ok((await updateCharacterFromForm(ADMIN, id, payload)).ok);
      assert.ok((await updateCharacterPublicProfileFromForm(ADMIN, id, payload)).ok);
      assert.equal((await updateCharacterFromForm(USER, id, payload)).ok, false);
      assert.equal((await updateCharacterFromForm(ADMIN, id, { ...payload, visibility: "public" })).ok, false);
      assert.equal((await updateCharacterPublicProfileFromForm(ADMIN, id, { ...payload, visibility: "public" })).ok, false);

      // A real local upload, never a persisted placeholder or fake representative.
      const sharp = (await import("sharp")).default;
      const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#8a765a" } }).png().toBuffer();
      const stored = await storePrivateMedia(bytes, "image/png", ADMIN.id);
      const assets = [{ url: stored.url, mediaId: stored.mediaId, tag: "검증 이미지", representativeRank: 1 }];
      assert.ok((await updateCharacterFromForm(ADMIN, id, { ...payload, assets })).ok);
      assert.equal((await updateCharacterFromForm(ADMIN, id, { ...payload, assets, visibility: "public" })).ok, false, "pending image still needs moderation");
      await writeMediaManifest(`${stored.mediaId}.webp`, { uploadedBy: ADMIN.id, createdAt: new Date().toISOString(), contentType: "image/webp", moderationStatus: "checked", adultFlagged: false, moderationReject: false, nippleExposure: "none" });
      const publicResult = await updateCharacterFromForm(ADMIN, id, { ...payload, assets, visibility: "public" });
      assert.ok(publicResult.ok, !publicResult.ok ? publicResult.error : "");
      const final = read();
      for (const key of ["id", "system_prompt", "greeting", "world", "example_dialog", "creator_comment", "description"]) assert.equal(final[key], initial[key], key);
      assert.equal(final.official, 0);
      // The private draft exception cannot erase an official row's locked images
      // through the admin editor's preserveListingState mode.
      db.prepare("UPDATE characters SET official=1 WHERE id=?").run(id);
      const adminEdit = { actor: "official_admin" as const, adminUser: ADMIN, preserveListingState: true };
      assert.equal((await updateCharacterFromForm(ADMIN, id, payload, adminEdit)).ok, false);
      assert.equal((await updateCharacterPublicProfileFromForm(ADMIN, id, payload, adminEdit)).ok, false);
      assert.equal(read().assets, final.assets);
      assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(db, id), [lore.id]);
      assert.equal((db.prepare("SELECT content FROM messages WHERE chat_id=?").get(chatId) as { content: string }).content, draft.greeting);
    });
  }
});
