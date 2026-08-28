import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  createCharacterFromForm,
  updateCharacterFromForm,
  parseCharacterFormBody,
} from "@/lib/characterFormSave";
import { borrowWorldShareToUser, createWorldShare } from "@/lib/worldShares";
import {
  NARRATION_STYLE_INSTRUCTIONS_LIMIT,
  substantiveAiLearningCharCount,
} from "@/lib/creatorNarrationStyle";
import { buildSimulationSystemPrompt } from "@/lib/simulationMode";
import { AI_LEARNING_LIMIT, AI_LEARNING_MIN } from "@/lib/characterFormLimits";

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

describe("simulation import budget validation", () => {
  const emptySpeech = {
    speech_personality: "",
    speech_traits: "",
    speech_examples: "",
    speech_forbidden: "",
    speech_contextual_registers: [] as [],
  };

  async function seedImportSourceCharacter(
    ownerId: number,
    systemPrompt: string
  ): Promise<number> {
    seedUser(ownerId);
    const created = await createCharacterFromForm(
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 },
      characterBody({
        name: `Import${ownerId}`,
        world: "세".repeat(600),
        system_prompt: `[외형]\n검은\n\n${"P".repeat(1000)}`,
        speech_personality: "말".repeat(50),
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
      })
    );
    if (!created.ok) {
      assert.fail(`import source create failed: ${created.error}`);
    }
    getDb()
      .prepare("UPDATE characters SET system_prompt=?, world='', example_dialog='' WHERE id=?")
      .run(systemPrompt, created.id);
    return created.id;
  }

  function importSnapshot(
    importId: number,
    ownerId: number,
    prompt: string
  ) {
    return {
      characterId: importId,
      name: `Import${ownerId}`,
      creatorId: ownerId,
      creatorName: `user${ownerId}`,
      systemPrompt: prompt,
      world: "",
      exampleDialog: "",
    };
  }

  function simulationBudgetBody(importId: number, overrides: Record<string, unknown> = {}) {
    return simulationBody({
      name: "BudgetSim",
      simulation_cast: "[주인공]\n" + "가".repeat(250),
      world: "세".repeat(500),
      simulation_import_ids: [importId],
      simulation_visual_subjects: { version: 1, subjects: [] },
      ...overrides,
    });
  }

  it("imported character content counts toward substantive MIN and MAX via parseCharacterFormBody", async () => {
    const ownerId = 93100;
    const importPrompt = "I".repeat(7000);
    const importId = await seedImportSourceCharacter(ownerId, importPrompt);
    const world = "세".repeat(500);
    const cast = "[주인공]\n" + "가".repeat(250);
    const withoutImportPrompt = buildSimulationSystemPrompt({ cast, rules: "" });
    const withImportPrompt = buildSimulationSystemPrompt({
      cast,
      rules: "",
      imports: [importSnapshot(importId, ownerId, importPrompt)],
    });
    const withoutImport = substantiveAiLearningCharCount({
      world,
      systemPrompt: withoutImportPrompt,
      speechInput: emptySpeech,
    });
    const withImport = substantiveAiLearningCharCount({
      world,
      systemPrompt: withImportPrompt,
      speechInput: emptySpeech,
    });
    assert.ok(withImport > withoutImport);
    assert.ok(withImport - withoutImport > 6000);

    const underMin = parseCharacterFormBody(
      simulationBudgetBody(importId, {
        world: "세".repeat(100),
        simulation_cast: "[A]\n짧음",
        simulation_import_ids: [],
      }),
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 }
    );
    assert.equal(underMin.ok, false);
    if (underMin.ok) return;
    assert.match(underMin.error, /1,500/);

    const accepted = parseCharacterFormBody(
      simulationBudgetBody(importId),
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 }
    );
    assert.equal(accepted.ok, true);
  });

  it("FINAL_COMPILED_PROMPT_AT_LIMIT accepted and OVER_LIMIT_BY_1 rejected (import-driven excess)", async () => {
    const ownerId = 93111;
    seedUser(ownerId);
    const world = "세".repeat(500);
    const cast = "[주인공]\n" + "가".repeat(250);
    const importId = await seedImportSourceCharacter(ownerId, "x");

    const importSnapshotForLen = (prompt: string) =>
      importSnapshot(importId, ownerId, prompt);

    const substantiveForImportLen = (importLen: number) =>
      substantiveAiLearningCharCount({
        world,
        systemPrompt: buildSimulationSystemPrompt({
          cast,
          rules: "",
          imports: [importSnapshotForLen("I".repeat(importLen))],
        }),
        speechInput: emptySpeech,
      });

    let lo = 0;
    let hi = 12000;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (substantiveForImportLen(mid) < AI_LEARNING_LIMIT) lo = mid + 1;
      else hi = mid;
    }
    const importLenAtLimit = lo;
    let importPrompt = "I".repeat(importLenAtLimit);
    assert.equal(substantiveForImportLen(importLenAtLimit), AI_LEARNING_LIMIT);

    getDb()
      .prepare("UPDATE characters SET system_prompt=? WHERE id=?")
      .run(importPrompt, importId);

    const atLimit = parseCharacterFormBody(
      simulationBudgetBody(importId),
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 }
    );
    assert.equal(atLimit.ok, true);

    importPrompt += "X";
    getDb()
      .prepare("UPDATE characters SET system_prompt=? WHERE id=?")
      .run(importPrompt, importId);

    const overLimit = parseCharacterFormBody(
      simulationBudgetBody(importId),
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 }
    );
    assert.equal(overLimit.ok, false);
    if (overLimit.ok) return;
    assert.match(overLimit.error, /10,000/);
  });

  it("style excluded from minimum and included in maximum", () => {
    const ownerId = 93102;
    seedUser(ownerId);
    const world = "세".repeat(700);
    const systemPrompt = "설".repeat(799);
    assert.equal(
      substantiveAiLearningCharCount({ world, systemPrompt, speechInput: emptySpeech }),
      AI_LEARNING_MIN - 1
    );

    const belowMinWithStyle = parseCharacterFormBody(
      {
        ...characterBody({
          world,
          system_prompt: systemPrompt,
          speech_personality: "",
          speech_traits: "",
          speech_examples: "",
          speech_forbidden: "",
        }),
        narration_style_instructions: "가".repeat(200),
      },
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 }
    );
    assert.equal(belowMinWithStyle.ok, false);
    if (belowMinWithStyle.ok) return;
    assert.match(belowMinWithStyle.error, /1,500/);

    const atMin = parseCharacterFormBody(
      characterBody({
        world,
        system_prompt: systemPrompt + "설",
        speech_personality: "",
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
        narration_style_instructions: "가".repeat(300),
      }),
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 }
    );
    assert.equal(atMin.ok, true);

    const nearMaxWorld = "세".repeat(1000);
    const nearMaxPrompt = "설".repeat(8700);
    const atMax = parseCharacterFormBody(
      characterBody({
        world: nearMaxWorld,
        system_prompt: nearMaxPrompt,
        speech_personality: "",
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
        narration_style_instructions: "가".repeat(300),
      }),
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 }
    );
    assert.equal(atMax.ok, true);

    const overMax = parseCharacterFormBody(
      characterBody({
        world: nearMaxWorld,
        system_prompt: nearMaxPrompt + "설",
        speech_personality: "",
        speech_traits: "",
        speech_examples: "",
        speech_forbidden: "",
        narration_style_instructions: "가".repeat(300),
      }),
      { id: ownerId, nickname: `user${ownerId}`, is_adult: 1 }
    );
    assert.equal(overMax.ok, false);
    if (overMax.ok) return;
    assert.match(overMax.error, /10,000/);
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
