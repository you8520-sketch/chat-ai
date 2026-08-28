import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  createCharacterFromForm,
  updateCharacterFromForm,
  parseCharacterFormBody,
} from "@/lib/characterFormSave";
import { borrowWorldShareToUser, createWorldShare } from "@/lib/worldShares";
import { NARRATION_STYLE_INSTRUCTIONS_LIMIT } from "@/lib/creatorNarrationStyle";

const LONG_PROMPT = "설정".repeat(800);

function seedUser(id: number, nickname = `user${id}`) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
    )
    .run(id, `u${id}@test.local`, nickname, "hash");
}

function seedOwnedWorld(creatorId: number, content: string) {
  const info = getDb()
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
       VALUES (?, 'World', 'summary', ?, datetime('now'))`
    )
    .run(creatorId, content);
  return Number(info.lastInsertRowid);
}

function characterBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "character",
    name: "TestChar",
    tagline: "tag",
    description: "desc",
    greeting: "안녕",
    system_prompt: `[외형]\n검은 머리\n\n${LONG_PROMPT}`,
    world: "세계관".repeat(200),
    speech_personality: "말투".repeat(50),
    speech_traits: "",
    speech_examples: "",
    speech_forbidden: "",
    speech_contextual_registers: [],
    genres: ["로맨스"],
    gender: "female",
    visibility: "private",
    nsfw: false,
    participant_min_age: 20,
    assets: [{ url: "/uploads/test.webp", tag: "neutral" }],
    ...overrides,
  };
}

function simulationBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "simulation",
    name: "Sim",
    tagline: "sim",
    description: "sim desc",
    greeting: "시작",
    simulation_cast: LONG_PROMPT,
    simulation_rules: "",
    world: "세계".repeat(200),
    genres: ["로맨스"],
    visibility: "private",
    nsfw: false,
    participant_min_age: 20,
    assets: [{ url: "/uploads/sim.webp", tag: "neutral" }],
    simulation_visual_subjects: { version: 1, subjects: [] },
    ...overrides,
  };
}

describe("narration style form persistence", () => {
  it("character create roundtrip stores narration_style_instructions", async () => {
    seedUser(93001);
    const style = "3인칭 제한 시점";
    const created = await createCharacterFromForm(
      { id: 93001, nickname: "user93001", is_adult: 1 },
      characterBody({ narration_style_instructions: style })
    );
    assert.equal(created.ok, true);
    const row = getDb()
      .prepare("SELECT narration_style_instructions FROM characters WHERE id = ?")
      .get((created as { id: number }).id) as { narration_style_instructions: string };
    assert.equal(row.narration_style_instructions, style);
  });

  it("character edit roundtrip updates narration_style_instructions", async () => {
    seedUser(93002);
    const created = await createCharacterFromForm(
      { id: 93002, nickname: "user93002", is_adult: 1 },
      characterBody()
    );
    assert.equal(created.ok, true);
    const updated = await updateCharacterFromForm(
      { id: 93002, nickname: "user93002", is_adult: 1 },
      (created as { id: number }).id,
      characterBody({ narration_style_instructions: "건조한 문장" })
    );
    assert.equal(updated.ok, true);
    const row = getDb()
      .prepare("SELECT narration_style_instructions FROM characters WHERE id = ?")
      .get((created as { id: number }).id) as { narration_style_instructions: string };
    assert.equal(row.narration_style_instructions, "건조한 문장");
  });

  it("simulation create roundtrip stores narration_style_instructions", async () => {
    seedUser(93003);
    const created = await createCharacterFromForm(
      { id: 93003, nickname: "user93003", is_adult: 1 },
      simulationBody({ narration_style_instructions: "서사 밀도 낮게" })
    );
    assert.equal(created.ok, true);
    const row = getDb()
      .prepare("SELECT narration_style_instructions FROM characters WHERE id = ?")
      .get((created as { id: number }).id) as { narration_style_instructions: string };
    assert.equal(row.narration_style_instructions, "서사 밀도 낮게");
  });

  it("simulation edit roundtrip updates narration_style_instructions", async () => {
    seedUser(93006);
    const created = await createCharacterFromForm(
      { id: 93006, nickname: "user93006", is_adult: 1 },
      simulationBody()
    );
    assert.equal(created.ok, true);
    const updated = await updateCharacterFromForm(
      { id: 93006, nickname: "user93006", is_adult: 1 },
      (created as { id: number }).id,
      simulationBody({ narration_style_instructions: "대화 위주 서술" })
    );
    assert.equal(updated.ok, true);
    const row = getDb()
      .prepare("SELECT narration_style_instructions FROM characters WHERE id = ?")
      .get((created as { id: number }).id) as { narration_style_instructions: string };
    assert.equal(row.narration_style_instructions, "대화 위주 서술");
  });

  it("301 chars rejected on parse", () => {
    const parsed = parseCharacterFormBody(
      characterBody({ narration_style_instructions: "가".repeat(301) }),
      { id: 93004, nickname: "user93004", is_adult: 1 }
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.status, 400);
    assert.match(parsed.error, /300/);
  });

  it("style-only edit does not enqueue new derived job when EN cache exists", async () => {
    seedUser(93005);
    const created = await createCharacterFromForm(
      { id: 93005, nickname: "user93005", is_adult: 1 },
      characterBody()
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;
    const db = getDb();
    db.prepare(
      `UPDATE characters SET setting_chunks_en='[{"id":"1"}]', prompt_translation_hash='abc', setting_chunks='[{"id":"1"}]' WHERE id=?`
    ).run(characterId);
    const jobsBefore = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE entity_id=?`)
        .get(characterId) as { c: number }
    ).c;
    const before = db
      .prepare(
        `SELECT setting_chunks, setting_chunks_en, prompt_translation_hash, appearance_compiled FROM characters WHERE id=?`
      )
      .get(characterId) as {
      setting_chunks: string;
      setting_chunks_en: string;
      prompt_translation_hash: string;
      appearance_compiled: string;
    };
    const updated = await updateCharacterFromForm(
      { id: 93005, nickname: "user93005", is_adult: 1 },
      characterId,
      characterBody({ narration_style_instructions: "새 문체" })
    );
    assert.equal(updated.ok, true);
    const after = db
      .prepare(
        `SELECT setting_chunks, setting_chunks_en, prompt_translation_hash, appearance_compiled, narration_style_instructions FROM characters WHERE id=?`
      )
      .get(characterId) as {
      setting_chunks: string;
      setting_chunks_en: string;
      prompt_translation_hash: string;
      appearance_compiled: string;
      narration_style_instructions: string;
    };
    assert.equal(after.setting_chunks, before.setting_chunks);
    assert.equal(after.setting_chunks_en, before.setting_chunks_en);
    assert.equal(after.prompt_translation_hash, before.prompt_translation_hash);
    assert.equal(after.appearance_compiled, before.appearance_compiled);
    assert.equal(after.narration_style_instructions, "새 문체");
    const jobsAfter = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE entity_id=?`)
        .get(characterId) as { c: number }
    ).c;
    assert.equal(jobsAfter, jobsBefore);
  });
});

describe("borrow snapshot style-only edit", () => {
  it("preserves frozen world snapshot and source_world_share_id", async () => {
    seedUser(93010, "owner-a");
    seedUser(93011, "creator-b");
    const worldId = seedOwnedWorld(93010, "Borrowed canon body ".repeat(40));
    const created = createWorldShare(93010, worldId);
    assert.ok(!("error" in created));
    const borrowed = borrowWorldShareToUser(93011, created.share.share_slug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    const charCreated = await createCharacterFromForm(
      { id: 93011, nickname: "creator-b", is_adult: 1 },
      characterBody({
        world_borrow_id: borrowed.borrow.id,
        world: "forged attempt",
        name: "Borrowed Char",
      })
    );
    assert.equal(charCreated.ok, true);
    if (!charCreated.ok) return;
    const characterId = charCreated.id;
    const before = getDb()
      .prepare("SELECT world, source_world_share_id, world_id FROM characters WHERE id=?")
      .get(characterId) as {
      world: string;
      source_world_share_id: number | null;
      world_id: number | null;
    };

    const updated = await updateCharacterFromForm(
      { id: 93011, nickname: "creator-b", is_adult: 1 },
      characterId,
      characterBody({
        world_borrow_id: borrowed.borrow.id,
        world: before.world,
        name: "Borrowed Char",
        narration_style_instructions: "차분한 서술",
      })
    );
    assert.equal(updated.ok, true);
    const after = getDb()
      .prepare(
        "SELECT world, source_world_share_id, world_id, narration_style_instructions FROM characters WHERE id=?"
      )
      .get(characterId) as {
      world: string;
      source_world_share_id: number | null;
      world_id: number | null;
      narration_style_instructions: string;
    };
    assert.equal(after.world, before.world);
    assert.equal(after.source_world_share_id, before.source_world_share_id);
    assert.equal(after.world_id, before.world_id);
    assert.equal(after.narration_style_instructions, "차분한 서술");
  });
});

describe("privacy", () => {
  it("owner GET JSON includes narration_style_instructions (creator endpoint contract)", async () => {
    seedUser(93020);
    const created = await createCharacterFromForm(
      { id: 93020, nickname: "user93020", is_adult: 1 },
      characterBody({ narration_style_instructions: "비공개 문체", visibility: "public" })
    );
    assert.equal(created.ok, true);
    const row = getDb()
      .prepare("SELECT narration_style_instructions FROM characters WHERE id=?")
      .get((created as { id: number }).id) as { narration_style_instructions: string };
    assert.equal(row.narration_style_instructions, "비공개 문체");
    assert.equal(NARRATION_STYLE_INSTRUCTIONS_LIMIT, 300);
  });
});
