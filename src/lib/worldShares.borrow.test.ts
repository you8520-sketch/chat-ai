import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { parseCharacterFormBody } from "@/lib/characterFormSave";
import { canUseWorldForTrpg } from "@/lib/trpg/catalog";
import { insertScenarioTemplate } from "@/lib/trpg/scenarioTemplates";
import { canEditWorld, canShareWorld, loadOwnedWorldRow } from "@/lib/worldPermissions";
import { loadUserWorldLibrary } from "@/lib/worldLibrary";
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
});
