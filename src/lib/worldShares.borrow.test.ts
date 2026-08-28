import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { getDb } from "@/lib/db";
import {
  createCharacterFromForm,
  parseCharacterFormBody,
  updateCharacterFromForm,
} from "@/lib/characterFormSave";
import { canUseWorldForTrpg } from "@/lib/trpg/worldAccess";
import { loadTrpgCatalog } from "@/lib/trpg/catalog";
import { insertScenarioTemplate } from "@/lib/trpg/scenarioTemplates";
import { canEditWorld, canShareWorld, loadOwnedWorldRow } from "@/lib/worldPermissions";
import { loadUserWorldLibrary } from "@/lib/worldLibrary";
import { isBorrowAvailableForNewUse } from "@/lib/worlds";
import {
  borrowWorldShareToUser,
  createWorldShare,
  getWorldShareBySlug,
  removeWorldBorrow,
  revokeWorldShare,
} from "@/lib/worldShares";

function seedUser(id: number, nickname: string) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
    )
    .run(id, `user${id}@test.local`, nickname, "hash");
}

function seedOwnedWorld(creatorId: number, name: string, content: string, summary = "요약") {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
    .run(creatorId, name, summary, content);
  return Number(info.lastInsertRowid);
}

const LONG_PROMPT = "설정".repeat(800);
const LONG_SPEECH = "말투".repeat(250);

function minimalCharacterBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "character",
    name: "테스트 캐릭터",
    tagline: "한 줄 소개",
    description: "공개 소개",
    greeting: "안녕",
    system_prompt: LONG_PROMPT,
    world: "",
    speech_personality: LONG_SPEECH,
    speech_traits: LONG_SPEECH,
    speech_examples: LONG_SPEECH,
    speech_forbidden: "",
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral" }],
    ...overrides,
  };
}

function minimalSimulationBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "simulation",
    name: "시뮬",
    tagline: "한 줄 소개",
    description: "공개 소개",
    greeting: "안녕",
    simulation_cast: LONG_PROMPT,
    world: "",
    genres: ["로맨스"],
    gender: "other",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral" }],
    ...overrides,
  };
}

describe("world borrow ownership foundation", () => {
  it("W1 owner creates world with owner=A", () => {
    seedUser(1001, "owner-a");
    const worldId = seedOwnedWorld(1001, "A 세계", "A 본문");
    const row = loadOwnedWorldRow(1001, worldId);
    assert.ok(row);
    assert.equal(row!.creator_id, 1001);
  });

  it("W2 share snapshot is exact Korean copy at share time", () => {
    seedUser(1002, "share-a");
    const worldId = seedOwnedWorld(1002, "스냅샷 세계", "v1 본문", "v1 요약");
    const created = createWorldShare(1002, worldId);
    assert.ok(!("error" in created));
    const pub = getWorldShareBySlug(created.share.share_slug);
    assert.ok(pub);
    assert.equal(pub!.name, "스냅샷 세계");
    assert.equal(pub!.content, "v1 본문");
    assert.equal(pub!.summary, "v1 요약");
  });

  it("W3 borrow creates reference not worlds row", () => {
    seedUser(1003, "share-a");
    seedUser(1004, "borrower-b");
    const worldId = seedOwnedWorld(1003, "빌릴 세계", "공유 본문");
    const created = createWorldShare(1003, worldId);
    assert.ok(!("error" in created));

    const beforeWorldCount = (
      getDb().prepare("SELECT COUNT(*) AS c FROM worlds WHERE creator_id = ?").get(1004) as { c: number }
    ).c;

    const borrowed = borrowWorldShareToUser(1004, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const afterWorldCount = (
      getDb().prepare("SELECT COUNT(*) AS c FROM worlds WHERE creator_id = ?").get(1004) as { c: number }
    ).c;
    assert.equal(afterWorldCount, beforeWorldCount);
    assert.equal(borrowed.world.libraryKind, "borrowed");
    assert.equal(borrowed.world.readOnly, true);

    const borrowCount = (
      getDb()
        .prepare("SELECT COUNT(*) AS c FROM world_borrows WHERE user_id = ? AND world_share_id = ?")
        .get(1004, created.share.id) as { c: number }
    ).c;
    assert.equal(borrowCount, 1);
  });

  it("W4 duplicate borrow is idempotent", () => {
    seedUser(1005, "share-a");
    seedUser(1006, "borrower-b");
    const worldId = seedOwnedWorld(1005, "중복 빌림", "본문");
    const created = createWorldShare(1005, worldId);
    assert.ok(!("error" in created));

    const first = borrowWorldShareToUser(1006, created.share.share_slug);
    const second = borrowWorldShareToUser(1006, created.share.share_slug);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.alreadyInLibrary, true);

    const borrowCount = (
      getDb()
        .prepare("SELECT COUNT(*) AS c FROM world_borrows WHERE user_id = ? AND world_share_id = ?")
        .get(1006, created.share.id) as { c: number }
    ).c;
    assert.equal(borrowCount, 1);
  });

  it("W5 borrower cannot edit borrowed or source world", () => {
    seedUser(1007, "share-a");
    seedUser(1008, "borrower-b");
    const worldId = seedOwnedWorld(1007, "읽기전용", "본문");
    const created = createWorldShare(1007, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1008, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    assert.equal(canEditWorld(1008, worldId), false);
  });

  it("W6 borrower removes borrow without touching source", () => {
    seedUser(1009, "share-a");
    seedUser(1010, "borrower-b");
    const worldId = seedOwnedWorld(1009, "제거 테스트", "본문");
    const created = createWorldShare(1009, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1010, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const removed = removeWorldBorrow(1010, borrowed.borrow.id);
    assert.equal(removed.ok, true);
    assert.ok(loadOwnedWorldRow(1009, worldId));
    assert.ok(getWorldShareBySlug(created.share.share_slug));
  });

  it("W7 borrower cannot re-share borrowed world", () => {
    seedUser(1011, "share-a");
    seedUser(1012, "borrower-b");
    const worldId = seedOwnedWorld(1011, "재공유 금지", "본문");
    const created = createWorldShare(1011, worldId);
    assert.ok(!("error" in created));
    borrowWorldShareToUser(1012, created.share.share_slug);
    assert.equal(canShareWorld(1012, worldId), false);
  });

  it("W8 character save snapshots borrowed share Korean content", () => {
    seedUser(1013, "share-a");
    seedUser(1014, "borrower-b");
    const worldId = seedOwnedWorld(1013, "캐릭터용", "스냅샷 대상 본문");
    const created = createWorldShare(1013, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1014, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const parsed = parseCharacterFormBody(
      minimalCharacterBody({ world_borrow_id: borrowed.borrow.id }),
      { id: 1014, nickname: "borrower-b", is_adult: 1 }
    );
    assert.equal(parsed.ok, true, !parsed.ok ? parsed.error : "");
    if (!parsed.ok) return;
    assert.equal(parsed.data.world, "스냅샷 대상 본문");
    assert.equal(parsed.data.worldId, null);
    assert.equal(parsed.data.sourceWorldShareId, created.share.id);
  });

  it("W9 simulation can use borrowed world", () => {
    seedUser(1015, "share-a");
    seedUser(1016, "borrower-b");
    const worldId = seedOwnedWorld(1015, "시뮬용", "시뮬 본문");
    const created = createWorldShare(1015, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1016, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const parsed = parseCharacterFormBody(
      minimalSimulationBody({ world_borrow_id: borrowed.borrow.id }),
      { id: 1016, nickname: "borrower-b", is_adult: 1 }
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.world, "시뮬 본문");
  });

  it("W10 TRPG rejects legacy borrowed and borrowed paths", () => {
    seedUser(1017, "legacy-owner");
    const db = getDb();
    const legacyId = Number(
      db
        .prepare(
          `INSERT INTO worlds (creator_id, name, summary, content, shared_from_nickname, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(1017, "레거시", "요약", "레거시 본문", "original-author").lastInsertRowid
    );
    const legacyRow = loadOwnedWorldRow(1017, legacyId)!;
    assert.equal(canUseWorldForTrpg(legacyRow, 1017), false);
    assert.throws(
      () =>
        insertScenarioTemplate(db, 1017, {
          title: "시나리오",
          summary: "요약",
          content: "내용",
          worldId: legacyId,
        }),
      /TRPG/
    );
  });

  it("W11 owner TRPG on own non-legacy world passes", () => {
    seedUser(1018, "owner-trpg");
    const worldId = seedOwnedWorld(1018, "TRPG 가능", "본문");
    const row = loadOwnedWorldRow(1018, worldId)!;
    assert.equal(canUseWorldForTrpg(row, 1018), true);
  });

  it("W12 source edit does not mutate existing share snapshot", () => {
    seedUser(1019, "share-a");
    seedUser(1020, "borrower-b");
    const worldId = seedOwnedWorld(1019, "버전 세계", "v1");
    const created = createWorldShare(1019, worldId);
    assert.ok(!("error" in created));
    borrowWorldShareToUser(1020, created.share.share_slug);

    getDb()
      .prepare(`UPDATE worlds SET content = ?, updated_at = datetime('now') WHERE id = ?`)
      .run("v2", worldId);

    const pub = getWorldShareBySlug(created.share.share_slug);
    assert.equal(pub!.content, "v1");
    const library = loadUserWorldLibrary(1020);
    const borrowedItem = library.find((w) => w.libraryKind === "borrowed");
    assert.equal(borrowedItem?.content, "v1");
  });

  it("W13 revoke blocks new character use but keeps saved snapshot text", () => {
    seedUser(1021, "share-a");
    seedUser(1022, "borrower-b");
    const worldId = seedOwnedWorld(1021, "철회", "철회 전 본문");
    const created = createWorldShare(1021, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1022, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const saved = parseCharacterFormBody(
      minimalCharacterBody({ world_borrow_id: borrowed.borrow.id, name: "저장됨" }),
      { id: 1022, nickname: "borrower-b", is_adult: 1 }
    );
    assert.equal(saved.ok, true, !saved.ok ? saved.error : "");
    if (!saved.ok) return;
    const frozenWorld = saved.data.world;

    revokeWorldShare(1021, created.share.share_slug);
    const blocked = parseCharacterFormBody(
      minimalCharacterBody({ world_borrow_id: borrowed.borrow.id, name: "차단" }),
      { id: 1022, nickname: "borrower-b", is_adult: 1 }
    );
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /더 이상 사용할 수 없/);
    assert.equal(frozenWorld, "철회 전 본문");
  });

  it("W14 source delete makes share unavailable for new use", () => {
    seedUser(1023, "share-a");
    seedUser(1024, "borrower-b");
    const worldId = seedOwnedWorld(1023, "삭제될 세계", "삭제 전");
    const created = createWorldShare(1023, worldId);
    assert.ok(!("error" in created));

    getDb().prepare("DELETE FROM worlds WHERE id = ?").run(worldId);
    const pub = getWorldShareBySlug(created.share.share_slug);
    assert.ok(pub);
    assert.equal(pub!.available, false);

    const blocked = borrowWorldShareToUser(1024, created.share.share_slug);
    assert.equal(blocked.ok, false);
  });

  it("W15 legacy imported row stays read-only without destructive conversion", () => {
    seedUser(1025, "legacy-user");
    const db = getDb();
    const legacyId = Number(
      db
        .prepare(
          `INSERT INTO worlds (creator_id, name, summary, content, shared_from_nickname, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(1025, "레거시 유지", "요약", "레거시 내용", "old-author").lastInsertRowid
    );
    const library = loadUserWorldLibrary(1025);
    const legacy = library.find((w) => w.id === legacyId);
    assert.ok(legacy);
    assert.equal(legacy!.libraryKind, "legacy_borrowed");
    assert.equal(legacy!.readOnly, true);
    assert.equal(canEditWorld(1025, legacyId), false);
    assert.equal(canShareWorld(1025, legacyId), false);
  });

  it("C1 forged modified borrow content is rejected for character save", () => {
    seedUser(1030, "share-a");
    seedUser(1031, "borrower-b");
    const worldId = seedOwnedWorld(1030, "위조 테스트", "원본 세계관");
    const created = createWorldShare(1030, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1031, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const parsed = parseCharacterFormBody(
      minimalCharacterBody({
        world_borrow_id: borrowed.borrow.id,
        world: "공격자가 수정한 세계관",
      }),
      { id: 1031, nickname: "borrower-b", is_adult: 1 }
    );
    assert.equal(parsed.ok, true, !parsed.ok ? parsed.error : "");
    if (!parsed.ok) return;
    assert.equal(parsed.data.world, "원본 세계관");
    assert.notEqual(parsed.data.world, "공격자가 수정한 세계관");
  });

  it("C2 forged modified borrow content is rejected for simulation save", () => {
    seedUser(1032, "share-a");
    seedUser(1033, "borrower-b");
    const worldId = seedOwnedWorld(1032, "시뮬 위조", "원본 시뮬 세계관");
    const created = createWorldShare(1032, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1033, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const parsed = parseCharacterFormBody(
      minimalSimulationBody({
        world_borrow_id: borrowed.borrow.id,
        world: "공격자가 수정한 세계관",
      }),
      { id: 1033, nickname: "borrower-b", is_adult: 1 }
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.world, "원본 시뮬 세계관");
  });

  it("C2b createCharacterFromForm persists forged simulation borrow as canonical snapshot", async () => {
    seedUser(1066, "share-a");
    seedUser(1067, "borrower-b");
    const worldId = seedOwnedWorld(1066, "시뮬 DB", "원본 시뮬 스냅샷");
    const created = createWorldShare(1066, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1067, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const result = await createCharacterFromForm(
      { id: 1067, nickname: "borrower-b", is_adult: 1 },
      minimalSimulationBody({
        world_borrow_id: borrowed.borrow.id,
        world: "공격자가 수정한 본문",
        name: "시뮬 스냅샷",
      })
    );
    assert.equal(result.ok, true, !result.ok ? result.error : "");
    if (!result.ok) return;

    const row = getDb()
      .prepare(
        "SELECT content_kind, world, source_world_share_id, world_id FROM characters WHERE id = ?"
      )
      .get(result.id) as {
      content_kind: string;
      world: string;
      source_world_share_id: number | null;
      world_id: number | null;
    };
    assert.equal(row.content_kind, "simulation");
    assert.equal(row.world, "원본 시뮬 스냅샷");
    assert.notEqual(row.world, "공격자가 수정한 본문");
    assert.equal(row.source_world_share_id, created.share.id);
    assert.equal(row.world_id, null);
  });

  it("C3 createCharacterFromForm persists borrowed snapshot and provenance", async () => {
    seedUser(1034, "share-a");
    seedUser(1035, "borrower-b");
    const worldId = seedOwnedWorld(1034, "DB 생성", "DB 스냅샷 본문");
    const created = createWorldShare(1034, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1035, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const result = await createCharacterFromForm(
      { id: 1035, nickname: "borrower-b", is_adult: 1 },
      minimalCharacterBody({
        world_borrow_id: borrowed.borrow.id,
        world: "위조 시도 본문",
        name: "빌린 스냅샷 캐릭터",
      })
    );
    assert.equal(result.ok, true, !result.ok ? result.error : "");
    if (!result.ok) return;

    const row = getDb()
      .prepare("SELECT world, source_world_share_id, world_id FROM characters WHERE id = ?")
      .get(result.id) as { world: string; source_world_share_id: number | null; world_id: number | null };
    assert.equal(row.world, "DB 스냅샷 본문");
    assert.equal(row.source_world_share_id, created.share.id);
    assert.equal(row.world_id, null);
  });

  it("C4 saved borrowed snapshot edit survives share revoke", async () => {
    seedUser(1036, "share-a");
    seedUser(1037, "borrower-b");
    const worldId = seedOwnedWorld(1036, "철회 후 편집", "철회 전 스냅샷");
    const created = createWorldShare(1036, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1037, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const createdChar = await createCharacterFromForm(
      { id: 1037, nickname: "borrower-b", is_adult: 1 },
      minimalCharacterBody({
        world_borrow_id: borrowed.borrow.id,
        name: "철회 생존 캐릭터",
      })
    );
    assert.equal(createdChar.ok, true);
    if (!createdChar.ok) return;

    revokeWorldShare(1036, created.share.share_slug);

    const updated = await updateCharacterFromForm(
      { id: 1037, nickname: "borrower-b", is_adult: 1 },
      createdChar.id,
      minimalCharacterBody({
        name: "철회 생존 캐릭터",
        tagline: "수정된 한 줄 소개",
        world_library_ref: `saved-share:${created.share.id}`,
        world: "위조 수정 시도",
      })
    );
    assert.equal(updated.ok, true, !updated.ok ? updated.error : "");
    if (!updated.ok) return;

    const row = getDb()
      .prepare("SELECT world, source_world_share_id, tagline FROM characters WHERE id = ?")
      .get(createdChar.id) as { world: string; source_world_share_id: number | null; tagline: string };
    assert.equal(row.world, "철회 전 스냅샷");
    assert.equal(row.source_world_share_id, created.share.id);
    assert.equal(row.tagline, "수정된 한 줄 소개");
  });

  it("C5 saved borrowed snapshot edit survives source world delete", async () => {
    seedUser(1038, "share-a");
    seedUser(1039, "borrower-b");
    const worldId = seedOwnedWorld(1038, "삭제 후 편집", "삭제 전 스냅샷");
    const created = createWorldShare(1038, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1039, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const createdChar = await createCharacterFromForm(
      { id: 1039, nickname: "borrower-b", is_adult: 1 },
      minimalCharacterBody({
        world_borrow_id: borrowed.borrow.id,
        name: "삭제 생존 캐릭터",
      })
    );
    assert.equal(createdChar.ok, true);
    if (!createdChar.ok) return;

    getDb().prepare("DELETE FROM worlds WHERE id = ?").run(worldId);

    const updated = await updateCharacterFromForm(
      { id: 1039, nickname: "borrower-b", is_adult: 1 },
      createdChar.id,
      minimalCharacterBody({
        name: "삭제 생존 캐릭터",
        tagline: "소스 삭제 후 수정",
        world_library_ref: `saved-share:${created.share.id}`,
      })
    );
    assert.equal(updated.ok, true, !updated.ok ? updated.error : "");
    if (!updated.ok) return;

    const row = getDb()
      .prepare("SELECT world, source_world_share_id FROM characters WHERE id = ?")
      .get(createdChar.id) as { world: string; source_world_share_id: number | null };
    assert.equal(row.world, "삭제 전 스냅샷");
    assert.equal(row.source_world_share_id, created.share.id);
  });

  it("C6 explicit owned world replacement clears borrow provenance", async () => {
    seedUser(1040, "share-a");
    seedUser(1041, "borrower-b");
    const sharedWorldId = seedOwnedWorld(1040, "공유 원본", "빌린 본문");
    const ownedWorldId = seedOwnedWorld(1041, "내 세계", "내 소유 본문");
    const created = createWorldShare(1040, sharedWorldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1041, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const createdChar = await createCharacterFromForm(
      { id: 1041, nickname: "borrower-b", is_adult: 1 },
      minimalCharacterBody({
        world_borrow_id: borrowed.borrow.id,
        name: "교체 테스트",
      })
    );
    assert.equal(createdChar.ok, true);
    if (!createdChar.ok) return;

    const updated = await updateCharacterFromForm(
      { id: 1041, nickname: "borrower-b", is_adult: 1 },
      createdChar.id,
      minimalCharacterBody({
        name: "교체 테스트",
        world_library_ref: `world:${ownedWorldId}`,
        world: "내 소유 본문",
      })
    );
    assert.equal(updated.ok, true, !updated.ok ? updated.error : "");
    if (!updated.ok) return;

    const row = getDb()
      .prepare("SELECT world, source_world_share_id, world_id FROM characters WHERE id = ?")
      .get(createdChar.id) as { world: string; source_world_share_id: number | null; world_id: number | null };
    assert.equal(row.world, "내 소유 본문");
    assert.equal(row.source_world_share_id, null);
    assert.equal(row.world_id, ownedWorldId);
  });

  it("C7 explicit borrowed S1 to S2 replacement updates snapshot and provenance", async () => {
    seedUser(1042, "share-a");
    seedUser(1043, "borrower-b");
    const world1 = seedOwnedWorld(1042, "S1 세계", "S1 본문");
    const world2 = seedOwnedWorld(1042, "S2 세계", "S2 본문");
    const share1 = createWorldShare(1042, world1);
    const share2 = createWorldShare(1042, world2);
    assert.ok(!("error" in share1));
    assert.ok(!("error" in share2));
    const borrow1 = borrowWorldShareToUser(1043, share1.share.share_slug);
    const borrow2 = borrowWorldShareToUser(1043, share2.share.share_slug);
    assert.equal(borrow1.ok, true);
    assert.equal(borrow2.ok, true);
    if (!borrow1.ok || !borrow2.ok) return;

    const createdChar = await createCharacterFromForm(
      { id: 1043, nickname: "borrower-b", is_adult: 1 },
      minimalCharacterBody({
        world_borrow_id: borrow1.borrow.id,
        name: "S1→S2 교체",
      })
    );
    assert.equal(createdChar.ok, true);
    if (!createdChar.ok) return;

    const updated = await updateCharacterFromForm(
      { id: 1043, nickname: "borrower-b", is_adult: 1 },
      createdChar.id,
      minimalCharacterBody({
        name: "S1→S2 교체",
        world_borrow_id: borrow2.borrow.id,
        world_library_ref: `borrow:${borrow2.borrow.id}`,
        world: "위조 S2",
      })
    );
    assert.equal(updated.ok, true, !updated.ok ? updated.error : "");
    if (!updated.ok) return;

    const row = getDb()
      .prepare("SELECT world, source_world_share_id FROM characters WHERE id = ?")
      .get(createdChar.id) as { world: string; source_world_share_id: number | null };
    assert.equal(row.world, "S2 본문");
    assert.equal(row.source_world_share_id, share2.share.id);
  });

  it("C8 explicit direct input detach clears borrowed snapshot without auto-copy", async () => {
    seedUser(1044, "share-a");
    seedUser(1045, "borrower-b");
    const worldId = seedOwnedWorld(1044, "분리 테스트", "빌린 고정 본문");
    const created = createWorldShare(1044, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1045, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const createdChar = await createCharacterFromForm(
      { id: 1045, nickname: "borrower-b", is_adult: 1 },
      minimalCharacterBody({
        world_borrow_id: borrowed.borrow.id,
        name: "직접입력 전환",
      })
    );
    assert.equal(createdChar.ok, true);
    if (!createdChar.ok) return;

    const updated = await updateCharacterFromForm(
      { id: 1045, nickname: "borrower-b", is_adult: 1 },
      createdChar.id,
      minimalCharacterBody({
        name: "직접입력 전환",
        world_library_ref: "",
        world_detach: true,
        world: "새 직접 입력 본문",
      })
    );
    assert.equal(updated.ok, true, !updated.ok ? updated.error : "");
    if (!updated.ok) return;

    const row = getDb()
      .prepare("SELECT world, source_world_share_id, world_id FROM characters WHERE id = ?")
      .get(createdChar.id) as { world: string; source_world_share_id: number | null; world_id: number | null };
    assert.equal(row.world, "새 직접 입력 본문");
    assert.equal(row.source_world_share_id, null);
    assert.equal(row.world_id, null);
    assert.notEqual(row.world, "빌린 고정 본문");
  });

  it("C9 revoked public share is unavailable for apply page boundary", () => {
    seedUser(1046, "share-a");
    const worldId = seedOwnedWorld(1046, "공개 철회", "비공개 본문");
    const created = createWorldShare(1046, worldId);
    assert.ok(!("error" in created));

    const live = getWorldShareBySlug(created.share.share_slug);
    assert.ok(live?.available);

    revokeWorldShare(1046, created.share.share_slug);
    const revoked = getWorldShareBySlug(created.share.share_slug);
    assert.ok(revoked);
    assert.equal(revoked!.available, false);
  });

  it("T2 other user public trpg-enabled world passes scenario create", () => {
    seedUser(1047, "world-owner");
    seedUser(1048, "scenario-author");
    const db = getDb();
    const publicWorldId = Number(
      db
        .prepare(
          `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, updated_at)
           VALUES (?, ?, ?, ?, 1, 'public', datetime('now'))`
        )
        .run(1047, "공개 TRPG", "요약", "TRPG 본문").lastInsertRowid
    );
    const row = loadOwnedWorldRow(1047, publicWorldId)!;
    assert.equal(canUseWorldForTrpg(row, 1048), true);
    const id = insertScenarioTemplate(db, 1048, {
      title: "공개 세계 시나리오",
      summary: "요약",
      content: "내용",
      worldId: publicWorldId,
    });
    assert.ok(id > 0);
  });

  it("T3 other user private world fails scenario create", () => {
    seedUser(1049, "world-owner");
    seedUser(1050, "scenario-author");
    const db = getDb();
    const privateWorldId = seedOwnedWorld(1049, "비공개 TRPG", "본문");
    assert.throws(
      () =>
        insertScenarioTemplate(db, 1050, {
          title: "거부 시나리오",
          summary: "요약",
          content: "내용",
          worldId: privateWorldId,
        }),
      /TRPG/
    );
  });

  it("T-catalog-A legacy borrowed public TRPG world is hidden from publicWorlds catalog", () => {
    seedUser(1068, "legacy-owner");
    seedUser(1069, "viewer");
    const db = getDb();
    const legacyId = Number(
      db
        .prepare(
          `INSERT INTO worlds (creator_id, name, summary, content, shared_from_nickname, trpg_enabled, trpg_visibility, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 'public', datetime('now'))`
        )
        .run(1068, "레거시 공개 TRPG", "요약", "레거시 본문", "old-author").lastInsertRowid
    );
    assert.equal(
      canUseWorldForTrpg(
        {
          creator_id: 1068,
          trpg_enabled: 1,
          trpg_visibility: "public",
          shared_from_nickname: "old-author",
        },
        1069
      ),
      false
    );
    const catalog = loadTrpgCatalog(db, 1069);
    assert.equal(catalog.publicWorlds.some((w) => w.id === legacyId), false);
  });

  it("T-catalog-B normal other-user public TRPG world stays in publicWorlds catalog", () => {
    seedUser(1070, "pub-owner");
    seedUser(1071, "viewer");
    const db = getDb();
    const publicId = Number(
      db
        .prepare(
          `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled, trpg_visibility, updated_at)
           VALUES (?, ?, ?, ?, 1, 'public', datetime('now'))`
        )
        .run(1070, "정상 공개 TRPG", "요약", "공개 본문").lastInsertRowid
    );
    const catalog = loadTrpgCatalog(db, 1071);
    assert.ok(catalog.publicWorlds.some((w) => w.id === publicId));
  });

  it("T-catalog-C own normal world stays in myWorlds catalog", () => {
    seedUser(1072, "owner");
    const ownId = seedOwnedWorld(1072, "내 TRPG 세계", "소유 본문");
    const catalog = loadTrpgCatalog(getDb(), 1072);
    assert.ok(catalog.myWorlds.some((w) => w.id === ownId));
  });

  it("T5 forged borrow id as worldId fails scenario create", () => {
    seedUser(1051, "share-a");
    seedUser(1052, "attacker");
    const worldId = seedOwnedWorld(1051, "위조 대상", "본문");
    const created = createWorldShare(1051, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1052, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const db = getDb();
    assert.throws(
      () =>
        insertScenarioTemplate(db, 1052, {
          title: "위조 worldId",
          summary: "요약",
          content: "내용",
          worldId: borrowed.borrow.id,
        }),
      /TRPG/
    );
  });

  it("security: forged borrow id for another user fails closed", () => {
    seedUser(1026, "share-a");
    seedUser(1027, "borrower-b");
    seedUser(1028, "attacker-c");
    const worldId = seedOwnedWorld(1026, "보안", "본문");
    const created = createWorldShare(1026, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1027, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const forged = parseCharacterFormBody(
      minimalCharacterBody({ world_borrow_id: borrowed.borrow.id, name: "위조" }),
      { id: 1028, nickname: "attacker-c", is_adult: 1 }
    );
    assert.equal(forged.ok, false);
  });

  it("U2 source-deleted borrow is unavailable for new use but remains in library", () => {
    seedUser(1053, "share-a");
    seedUser(1054, "borrower-b");
    const worldId = seedOwnedWorld(1053, "삭제 후 빌림", "삭제 전 본문");
    const created = createWorldShare(1053, worldId);
    assert.ok(!("error" in created));
    borrowWorldShareToUser(1054, created.share.share_slug);
    getDb().prepare("DELETE FROM worlds WHERE id = ?").run(worldId);

    const library = loadUserWorldLibrary(1054);
    const borrowed = library.find((w) => w.libraryKind === "borrowed");
    assert.ok(borrowed);
    assert.equal(borrowed!.shareAvailable, false);
    assert.equal(isBorrowAvailableForNewUse(borrowed!), false);

    const blocked = parseCharacterFormBody(
      minimalCharacterBody({ world_borrow_id: borrowed!.borrowId, name: "차단" }),
      { id: 1054, nickname: "borrower-b", is_adult: 1 }
    );
    assert.equal(blocked.ok, false);
  });

  it("U3 unavailable borrow entries are not selectable for new creation", () => {
    seedUser(1055, "share-a");
    seedUser(1056, "borrower-b");
    const worldId = seedOwnedWorld(1055, "UI 차단", "본문");
    const created = createWorldShare(1055, worldId);
    assert.ok(!("error" in created));
    borrowWorldShareToUser(1056, created.share.share_slug);
    revokeWorldShare(1055, created.share.share_slug);

    const library = loadUserWorldLibrary(1056);
    const borrowed = library.find((w) => w.libraryKind === "borrowed");
    assert.ok(borrowed);
    assert.equal(isBorrowAvailableForNewUse(borrowed!), false);

    const createCharacter = fs.readFileSync("src/components/CreateCharacter.tsx", "utf8");
    assert.match(createCharacter, /isBorrowAvailableForNewUse/);
    assert.match(createCharacter, /공유 종료 · 사용 불가/);
    assert.match(createCharacter, /disabled=\{unavailable\}/);
  });

  it("U4 initialWorldBorrowId unavailable does not auto-apply content", () => {
    seedUser(1057, "share-a");
    seedUser(1058, "borrower-b");
    const worldId = seedOwnedWorld(1057, "URL 차단", "자동 주입 금지");
    const created = createWorldShare(1057, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1058, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;
    revokeWorldShare(1057, created.share.share_slug);

    const item = loadUserWorldLibrary(1058).find((w) => w.borrowId === borrowed.borrow.id);
    assert.ok(item);
    assert.equal(isBorrowAvailableForNewUse(item!), false);

    const createCharacter = fs.readFileSync("src/components/CreateCharacter.tsx", "utf8");
    assert.match(createCharacter, /initialBorrowUnavailable/);
    assert.match(createCharacter, /isBorrowAvailableForNewUse\(picked\)/);
  });

  it("U5 saved character snapshot edit still passes after share revoke", async () => {
    seedUser(1059, "share-a");
    seedUser(1060, "borrower-b");
    const worldId = seedOwnedWorld(1059, "U5 스냅샷", "U5 고정 본문");
    const created = createWorldShare(1059, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(1060, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const createdChar = await createCharacterFromForm(
      { id: 1060, nickname: "borrower-b", is_adult: 1 },
      minimalCharacterBody({ world_borrow_id: borrowed.borrow.id, name: "U5 캐릭터" })
    );
    assert.equal(createdChar.ok, true);
    if (!createdChar.ok) return;

    revokeWorldShare(1059, created.share.share_slug);

    const updated = await updateCharacterFromForm(
      { id: 1060, nickname: "borrower-b", is_adult: 1 },
      createdChar.id,
      minimalCharacterBody({
        name: "U5 캐릭터",
        tagline: "U5 수정됨",
        world_library_ref: `saved-share:${created.share.id}`,
      })
    );
    assert.equal(updated.ok, true, !updated.ok ? updated.error : "");
    if (!updated.ok) return;

    const row = getDb()
      .prepare("SELECT world, source_world_share_id FROM characters WHERE id = ?")
      .get(createdChar.id) as { world: string; source_world_share_id: number | null };
    assert.equal(row.world, "U5 고정 본문");
    assert.equal(row.source_world_share_id, created.share.id);
  });

  it("U6 WorldApply success CTA links create with borrowId preselect", () => {
    const worldApply = fs.readFileSync("src/components/WorldApplyClient.tsx", "utf8");
    assert.match(worldApply, /borrowId/);
    assert.match(worldApply, /\/create\?worldBorrowId=\$\{borrowId\}/);
    assert.match(worldApply, /kind=simulation&worldBorrowId=\$\{borrowId\}/);
  });

  it("T1 trpg catalog and scenarioTemplates have no static import cycle", () => {
    const catalog = fs.readFileSync("src/lib/trpg/catalog.ts", "utf8");
    const scenario = fs.readFileSync("src/lib/trpg/scenarioTemplates.ts", "utf8");
    const worldAccess = fs.readFileSync("src/lib/trpg/worldAccess.ts", "utf8");
    assert.doesNotMatch(worldAccess, /scenarioTemplates/);
    assert.doesNotMatch(worldAccess, /from "\.\/catalog"/);
    assert.doesNotMatch(scenario, /from "\.\/catalog"/);
    assert.match(scenario, /from "@\/lib\/trpg\/worldAccess"/);
    assert.match(catalog, /from "\.\/worldAccess"/);
  });
});
