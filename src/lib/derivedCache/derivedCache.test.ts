import Module from "module";

process.env.DISABLE_DERIVED_CACHE_WORKER = "1";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { createCharacterFromForm, updateCharacterFromForm } from "@/lib/characterFormSave";
import { deserializeCharacterChunks } from "@/utils/characterParser";
import {
  enqueueDerivedCacheJob,
  ensureDerivedCacheJobsTable,
} from "@/lib/derivedCache/jobs";
import { resolveAppearancePromptText } from "@/lib/derivedCache/appearanceCurrentness";
import {
  APPEARANCE_COMPILED_VERSION,
  hashAppearanceRaw,
  serializeAppearanceCompiledJson,
  emptyAppearanceCompiled,
} from "@/lib/appearanceCompiler";
import { koreanChunksTranslationFingerprint } from "@/lib/promptTranslation";
import { translateCharacterChunksForDerivedRefresh } from "@/lib/derivedCache/characterTranslation";
import { loadCurrentShareWorldEnglish, loadShareWorldEnglishForCharacter } from "@/lib/derivedCache/shareWorldEnglish";
import { TRANSLATION_DERIVATION_VERSION } from "@/lib/derivedCache/versions";

function seedUser(id: number) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
    )
    .run(id, `u${id}@test.local`, `user${id}`, "hash");
}

function seedWorld(creatorId: number, content: string) {
  const info = getDb()
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
       VALUES (?, 'W', 's', ?, datetime('now'))`
    )
    .run(creatorId, content);
  return Number(info.lastInsertRowid);
}

const LONG_PROMPT = "설정".repeat(800);
const LONG_SPEECH = "말투".repeat(250);

function characterBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "character",
    name: "테스트 캐릭터",
    tagline: "한 줄 소개",
    description: "공개 소개",
    greeting: "안녕",
    system_prompt: `[외형]\n검은 머리\n\n${LONG_PROMPT}`,
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

function installHangingProviderFetch() {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Promise(() => {});
  }) as typeof fetch;
  return {
    get calls() {
      return calls;
    },
    restore() {
      globalThis.fetch = previousFetch;
    },
  };
}

describe("fast save — no provider before HTTP success", () => {
  afterEach(() => {
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
  });

  it("character create succeeds with hanging providers and enqueues durable job", async () => {
    const spy = installHangingProviderFetch();
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    try {
      seedUser(9001);
      const result = await createCharacterFromForm(
        { id: 9001, nickname: "user9001", is_adult: 1 },
        characterBody()
      );
      assert.ok(result.ok, !("ok" in result && result.ok) ? JSON.stringify(result) : "create failed");
      assert.equal(spy.calls, 0);

      const db = getDb();
      const row = db
        .prepare(`SELECT setting_chunks, prompt_translation_hash FROM characters WHERE id = ?`)
        .get((result as { id: number }).id) as {
        setting_chunks: string;
        prompt_translation_hash: string;
      };
      assert.ok(deserializeCharacterChunks(row.setting_chunks).length > 0);
      assert.ok(row.prompt_translation_hash);
      const jobs = db
        .prepare(
          `SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE entity_type='character'`
        )
        .get() as { c: number };
      assert.ok(jobs.c >= 1);
    } finally {
      spy.restore();
    }
  });

  it("character update succeeds with hanging providers", async () => {
    const spy = installHangingProviderFetch();
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    try {
      seedUser(9002);
      const created = await createCharacterFromForm(
        { id: 9002, nickname: "user9002", is_adult: 1 },
        characterBody({ name: "v1" })
      );
      assert.equal(created.ok, true);

      const updated = await updateCharacterFromForm(
        { id: 9002, nickname: "user9002", is_adult: 1 },
        (created as { id: number }).id,
        characterBody({ name: "v2", system_prompt: `[외형]\n파란 머리\n\n${LONG_PROMPT}` })
      );
      assert.equal(updated.ok, true);
      assert.equal(spy.calls, 0);
    } finally {
      spy.restore();
    }
  });
});

describe("appearance currentness", () => {
  it("R4 raw B after A compiled uses B raw not A compiled", () => {
    const rawA = "금발";
    const rawB = "흑발";
    const compiledA = serializeAppearanceCompiledJson({
      ...emptyAppearanceCompiled(),
      compiled_text: "blonde hair",
    });
    const text = resolveAppearancePromptText({
      raw: rawB,
      compiledJson: compiledA,
      compiledSourceHash: hashAppearanceRaw(rawA),
      compiledVersion: APPEARANCE_COMPILED_VERSION,
    });
    assert.equal(text, rawB);
  });
});

describe("share world english consumer", () => {
  it("uses share EN for world chunks without re-translating world text", async () => {
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(9010);
    const koreanWorld = "세계관 본문 {{user}}";
    const worldId = seedWorld(9010, koreanWorld);
    const db = getDb();
    const { worldContentFingerprint } = await import("@/lib/derivedCache/versions");
    const shareSlug = `share-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const shareInsert = db
      .prepare(
        `INSERT INTO world_shares (share_slug, user_id, world_id, name, summary, content, content_en, content_translation_fingerprint)
         VALUES (?, 9010, ?, 'W', 's', ?, 'World EN {{user}}', ?)`
      )
      .run(shareSlug, worldId, koreanWorld, worldContentFingerprint(koreanWorld));
    const shareId = Number(shareInsert.lastInsertRowid);

    const previousFetch = globalThis.fetch;
    let sawWorldKorean = false;
    globalThis.fetch = (async (_url, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("세계관 본문")) sawWorldKorean = true;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "⟦SEG 1⟧\ntranslated-identity\n⟦/SEG 1⟧" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const info = db
        .prepare(
          `INSERT INTO characters (name, system_prompt, world, source_world_share_id, setting_chunks, creator_id, creator_name)
           VALUES ('c','prompt',?, ?, '[]', 9010, 'u')`
        )
        .run(koreanWorld, shareId);
      const characterId = Number(info.lastInsertRowid);
      const chunks = [
        {
          id: "c-1",
          characterId: String(characterId),
          content: "identity",
          category: "identity" as const,
          importance: "CRITICAL" as const,
          tokenCount: 5,
          keywords: [],
        },
        {
          id: "c-2",
          characterId: String(characterId),
          content: koreanWorld,
          category: "world" as const,
          importance: "CRITICAL" as const,
          tokenCount: 10,
          keywords: [],
        },
      ];
      db.prepare(`UPDATE characters SET setting_chunks=?, prompt_translation_hash=? WHERE id=?`).run(
        JSON.stringify(chunks),
        koreanChunksTranslationFingerprint(chunks),
        characterId
      );

      assert.equal(loadCurrentShareWorldEnglish(shareId), "World EN {{user}}");
      assert.equal(loadShareWorldEnglishForCharacter(characterId), "World EN {{user}}");

      const ok = await translateCharacterChunksForDerivedRefresh(characterId, chunks);
      assert.equal(ok, true, "translateCharacterChunksForDerivedRefresh returned false");
      assert.equal(sawWorldKorean, false, "world Korean was sent to provider");
      const stored = db
        .prepare(`SELECT setting_chunks_en FROM characters WHERE id = ?`)
        .get(characterId) as { setting_chunks_en: string };
      const english = deserializeCharacterChunks(stored.setting_chunks_en);
      assert.equal(english.find((c) => c.category === "world")?.content, "World EN {{user}}");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe("job dedupe", () => {
  it("R6 identical enqueue does not duplicate jobs", () => {
    const db = getDb();
    ensureDerivedCacheJobsTable(db);
    const entityId = 900_000 + Math.floor(Math.random() * 100_000);
    const fp = "abc:v1";
    enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId,
      sourceFingerprint: fp,
      derivationVersion: TRANSLATION_DERIVATION_VERSION,
    });
    enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId,
      sourceFingerprint: fp,
      derivationVersion: TRANSLATION_DERIVATION_VERSION,
    });
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE entity_id=?`)
      .get(entityId) as { c: number };
    assert.equal(count.c, 1);
  });
});
