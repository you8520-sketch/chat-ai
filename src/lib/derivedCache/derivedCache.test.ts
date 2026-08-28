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
import {
  loadCharacterChunksForPrompt,
  type CharacterSettingRow,
} from "@/lib/characterChunks";
import { deserializeCharacterChunks } from "@/utils/characterParser";
import type { CharacterChunk } from "@/types";
import {
  enqueueDerivedCacheJob,
  ensureDerivedCacheJobsTable,
  recoverStaleDerivedCacheLeases,
  type DerivedCacheJobRow,
  type DerivedEntityType,
  type DerivedJobKind,
} from "@/lib/derivedCache/jobs";
import { resolveAppearancePromptText } from "@/lib/derivedCache/appearanceCurrentness";
import {
  APPEARANCE_COMPILED_VERSION,
  hashAppearanceRaw,
  serializeAppearanceCompiledJson,
  emptyAppearanceCompiled,
} from "@/lib/appearanceCompiler";
import {
  koreanChunksTranslationFingerprint,
  loadEnglishChunks,
  TRANSLATION_PLACEHOLDER_TOKENS,
} from "@/lib/promptTranslation";
import { translateCharacterChunksForDerivedRefresh } from "@/lib/derivedCache/characterTranslation";
import { loadOwnedWorldEnglishForCharacter } from "@/lib/derivedCache/ownedWorldEnglish";
import {
  loadCurrentShareWorldEnglish,
  loadShareWorldEnglishForCharacter,
} from "@/lib/derivedCache/shareWorldEnglish";
import { enqueueWorldTranslationJob } from "@/lib/derivedCache/worldTranslation";
import { TRANSLATION_DERIVATION_VERSION, worldContentFingerprint } from "@/lib/derivedCache/versions";
import { characterCanonicalSourceFingerprintFromRow } from "@/lib/derivedCache/characterSourceFingerprint";
import {
  loadCharacterSettingRow,
  processDerivedCacheJob,
} from "@/lib/derivedCache/worker";
import {
  borrowWorldShareToUser,
  createWorldShare,
} from "@/lib/worldShares";

function seedUser(id: number, nickname = `user${id}`) {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
    )
    .run(id, `u${id}@test.local`, nickname, "hash");
}

function seedWorld(creatorId: number, content: string, name = "W") {
  const info = getDb()
    .prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
       VALUES (?, ?, 's', ?, datetime('now'))`
    )
    .run(creatorId, name, content);
  return Number(info.lastInsertRowid);
}

function createWorldLikeApi(creatorId: number, content: string) {
  const db = getDb();
  const worldId = seedWorld(creatorId, content);
  enqueueWorldTranslationJob(db, worldId, content);
  return worldId;
}

function updateWorldLikeApi(worldId: number, creatorId: number, content: string) {
  const db = getDb();
  db.prepare(
    `UPDATE worlds SET content = ?, content_en = '', content_translation_fingerprint = '', updated_at = datetime('now')
     WHERE id = ? AND creator_id = ?`
  ).run(content, worldId, creatorId);
  enqueueWorldTranslationJob(db, worldId, content);
}

const LONG_PROMPT = "설정".repeat(800);
const LONG_SPEECH = "말투".repeat(250);
const SIMULATION_WORLD = "시뮬 세계관 배경".repeat(20);

function characterBodyWithAppearance(appearance: string, overrides: Record<string, unknown> = {}) {
  return characterBody({
    system_prompt: `[외형]\n${appearance}\n\n[성격]\n${LONG_PROMPT}`,
    ...overrides,
  });
}

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

function simulationBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "simulation",
    name: "시뮬",
    tagline: "한 줄 소개",
    description: "공개 소개",
    greeting: "안녕",
    simulation_cast: LONG_PROMPT,
    world: SIMULATION_WORLD,
    genres: ["로맨스"],
    gender: "other",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral" }],
    ...overrides,
  };
}

function mockSegmentedTranslationResponse(segments: string[]) {
  const content = segments
    .map((segment, index) => `⟦SEG ${index + 1}⟧\n${segment}\n⟦/SEG ${index + 1}⟧`)
    .join("\n");
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function mockAppearanceCompileResponse(compiledText = "compiled blonde hair") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              body: "",
              hair: compiledText,
              eyes: "",
              face: "",
              lips_makeup: "",
              clothing: "",
              impression: "",
              compiled_text: compiledText,
            }),
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
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

type DeferredFetchController = {
  readonly calls: number;
  readonly bodies: string[];
  readonly pendingCount: number;
  resolveNext(response: Response): void;
  resolveAll(response: Response): void;
  restore(): void;
};

function countTranslationSegments(body: string): number {
  const payload = extractFetchPayloadText(body);
  const segNums = [...payload.matchAll(/⟦SEG (\d+)⟧/g)].map((match) => Number(match[1]));
  return segNums.length > 0 ? Math.max(...segNums) : 1;
}

function extractFetchPayloadText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { messages?: { content?: string }[] };
    return parsed.messages?.map((message) => message.content ?? "").join("\n") ?? body;
  } catch {
    return body;
  }
}

function countPlaceholders(text: string, token: string): number {
  let count = 0;
  let idx = 0;
  while (idx <= text.length) {
    const found = text.indexOf(token, idx);
    if (found < 0) break;
    count += 1;
    idx = found + token.length;
  }
  return count;
}

function mockTranslationResponseForBody(body: string, prefix = "EN") {
  const payload = extractFetchPayloadText(body);
  const segments: string[] = [];
  let index = 1;
  while (true) {
    const segRe = new RegExp(`⟦SEG ${index}⟧\\n([\\s\\S]*?)\\n⟦/SEG ${index}⟧`);
    const source = payload.match(segRe)?.[1];
    if (!source) break;
    let translated = `${prefix}-seg-${index}`;
    for (const token of TRANSLATION_PLACEHOLDER_TOKENS) {
      const occurrences = countPlaceholders(source, token);
      for (let i = 0; i < occurrences; i += 1) {
        translated += ` ${token}`;
      }
    }
    segments.push(translated);
    index += 1;
  }
  if (segments.length === 0) segments.push(`${prefix}-seg-1`);
  return mockSegmentedTranslationResponse(segments);
}

function claimJobForEntity(
  db: ReturnType<typeof getDb>,
  filter: {
    jobKind: DerivedJobKind;
    entityType: DerivedEntityType;
    entityId: number;
    sourceFingerprint?: string;
  }
): DerivedCacheJobRow | null {
  ensureDerivedCacheJobsTable(db);
  recoverStaleDerivedCacheLeases(db);
  const candidate = db
    .prepare(
      `SELECT id FROM derived_cache_jobs
       WHERE status = 'pending'
         AND datetime(run_after) <= datetime('now')
         AND job_kind = ?
         AND entity_type = ?
         AND entity_id = ?
         ${filter.sourceFingerprint ? "AND source_fingerprint = ?" : ""}
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(
      ...(filter.sourceFingerprint
        ? [filter.jobKind, filter.entityType, filter.entityId, filter.sourceFingerprint]
        : [filter.jobKind, filter.entityType, filter.entityId])
    ) as { id: number } | undefined;
  if (!candidate) return null;

  const claimed = db
    .prepare(
      `UPDATE derived_cache_jobs
       SET status = 'processing',
           locked_at = datetime('now'),
           attempts = attempts + 1,
           updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    )
    .run(candidate.id);
  if (claimed.changes === 0) return null;

  return db.prepare(`SELECT * FROM derived_cache_jobs WHERE id = ?`).get(candidate.id) as DerivedCacheJobRow;
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function resolveDeferredFetchBody(deferred: DeferredFetchController, body: string): void {
  if (isAppearanceFetchBody(body)) {
    deferred.resolveNext(mockAppearanceCompileResponse("compiled appearance EN"));
  } else {
    deferred.resolveNext(mockTranslationResponseForBody(body));
  }
}

async function processEntityJobWithDeferred(
  filter: {
    jobKind: DerivedJobKind;
    entityType: DerivedEntityType;
    entityId: number;
    sourceFingerprint?: string;
  },
  deferred: DeferredFetchController
): Promise<boolean> {
  const db = getDb();
  const job = claimJobForEntity(db, filter);
  if (!job) return false;
  const workerPromise = processDerivedCacheJob(db, job);
  while (true) {
    while (deferred.pendingCount > 0) {
      const body = deferred.bodies[deferred.calls - deferred.pendingCount] ?? "";
      resolveDeferredFetchBody(deferred, body);
    }
    const raced = await Promise.race([
      workerPromise.then(() => "done" as const),
      new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 15)),
    ]);
    if (raced === "done") break;
  }
  await workerPromise;
  return true;
}

async function runDeferredRaceAfterSave(input: {
  db: ReturnType<typeof getDb>;
  job: DerivedCacheJobRow;
  deferred: DeferredFetchController;
  save: () => Promise<unknown>;
}): Promise<void> {
  const workerPromise = processDerivedCacheJob(input.db, input.job);
  await waitFor(() => input.deferred.pendingCount > 0);
  await input.save();
  while (input.deferred.pendingCount > 0) {
    const body = input.deferred.bodies[input.deferred.calls - input.deferred.pendingCount] ?? "";
    resolveDeferredFetchBody(input.deferred, body);
  }
  await workerPromise;
}

function installDeferredProviderFetch(
  onCall?: (body: string, callIndex: number) => Response | null | undefined
): DeferredFetchController {
  const previousFetch = globalThis.fetch;
  const pending: Array<(response: Response) => void> = [];
  let calls = 0;
  const bodies: string[] = [];

  globalThis.fetch = (async (_url, init) => {
    calls += 1;
    const body = String(init?.body ?? "");
    bodies.push(body);
    const direct = onCall?.(body, calls);
    if (direct) return direct;
    return new Promise<Response>((resolve) => {
      pending.push(resolve);
    });
  }) as typeof fetch;

  return {
    get calls() {
      return calls;
    },
    get bodies() {
      return bodies;
    },
    get pendingCount() {
      return pending.length;
    },
    resolveNext(response: Response) {
      const resolve = pending.shift();
      if (!resolve) throw new Error("no deferred fetch pending");
      resolve(response);
    },
    resolveAll(response: Response) {
      while (pending.length > 0) pending.shift()?.(response);
    },
    restore() {
      globalThis.fetch = previousFetch;
    },
  };
}

function countDedicatedWorldTranslationCalls(bodies: string[], marker: string): number {
  return bodies.filter((body) => {
    const payload = extractFetchPayloadText(body);
    if (!payload.includes(marker)) return false;
    if (payload.includes(LONG_PROMPT.slice(0, 80))) return false;
    return countTranslationSegments(body) === 1;
  }).length;
}

function isAppearanceFetchBody(body: string): boolean {
  return extractFetchPayloadText(body).includes("외형 속성 JSON");
}

function loadCharacterRow(characterId: number): CharacterSettingRow {
  const row = getDb()
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks,
              setting_chunks_en, prompt_translation_hash, speech_profile,
              creator_compiled_description_json, appearance_raw, appearance_compiled,
              appearance_compiled_source_hash, appearance_compiled_version
       FROM characters WHERE id = ?`
    )
    .get(characterId) as CharacterSettingRow | undefined;
  assert.ok(row, `character ${characterId} missing`);
  return row!;
}

describe("fast save — no provider before HTTP success", () => {
  afterEach(() => {
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
  });

  it("FAST_SAVE_CHARACTER_CREATE — Korean saved, hash empty, job enqueued, 0 provider calls", async () => {
    const userId = 92001;
    const spy = installHangingProviderFetch();
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    let providerCallsBeforeSaveReturn = 0;
    try {
      seedUser(userId);
      const result = await createCharacterFromForm(
        { id: userId, nickname: `user${userId}`, is_adult: 1 },
        characterBody()
      );
      providerCallsBeforeSaveReturn = spy.calls;
      assert.equal(result.ok, true);
      assert.equal(providerCallsBeforeSaveReturn, 0);

      const db = getDb();
      const characterId = (result as { id: number }).id;
      const row = db
        .prepare(`SELECT setting_chunks, prompt_translation_hash FROM characters WHERE id = ?`)
        .get(characterId) as { setting_chunks: string; prompt_translation_hash: string };
      assert.ok(deserializeCharacterChunks(row.setting_chunks).length > 0);
      assert.equal(row.prompt_translation_hash, "");
      const jobs = db
        .prepare(
          `SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE entity_type='character' AND entity_id=?`
        )
        .get(characterId) as { c: number };
      assert.ok(jobs.c >= 1);
    } finally {
      spy.restore();
    }
  });

  it("FAST_SAVE_CHARACTER_UPDATE — save succeeds with 0 provider calls before return", async () => {
    const userId = 92002;
    const spy = installHangingProviderFetch();
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    let providerCallsBeforeSaveReturn = 0;
    try {
      seedUser(userId);
      const created = await createCharacterFromForm(
        { id: userId, nickname: `user${userId}`, is_adult: 1 },
        characterBody({ name: "v1" })
      );
      assert.equal(created.ok, true);
      spy.calls; // reset counter semantics — hanging fetch increments per call only

      const updated = await updateCharacterFromForm(
        { id: userId, nickname: `user${userId}`, is_adult: 1 },
        (created as { id: number }).id,
        characterBody({ name: "v2", system_prompt: `[외형]\n파란 머리\n\n${LONG_PROMPT}` })
      );
      providerCallsBeforeSaveReturn = spy.calls;
      assert.equal(updated.ok, true);
      assert.equal(providerCallsBeforeSaveReturn, 0);
    } finally {
      spy.restore();
    }
  });

  it("FAST_SAVE_SIMULATION_CREATE — simulation_cast saved, job exists, 0 provider calls", async () => {
    const userId = 92003;
    const spy = installHangingProviderFetch();
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    let providerCallsBeforeSaveReturn = 0;
    try {
      seedUser(userId);
      const result = await createCharacterFromForm(
        { id: userId, nickname: `user${userId}`, is_adult: 1 },
        simulationBody()
      );
      providerCallsBeforeSaveReturn = spy.calls;
      assert.equal(result.ok, true);
      assert.equal(providerCallsBeforeSaveReturn, 0);

      const db = getDb();
      const characterId = (result as { id: number }).id;
      const row = db
        .prepare(`SELECT content_kind, simulation_cast, setting_chunks, prompt_translation_hash FROM characters WHERE id = ?`)
        .get(characterId) as {
        content_kind: string;
        simulation_cast: string;
        setting_chunks: string;
        prompt_translation_hash: string;
      };
      assert.equal(row.content_kind, "simulation");
      assert.ok(row.simulation_cast.includes("설정"));
      assert.ok(deserializeCharacterChunks(row.setting_chunks).length > 0);
      assert.equal(row.prompt_translation_hash, "");
      const jobs = db
        .prepare(`SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE entity_type='character' AND entity_id=?`)
        .get(characterId) as { c: number };
      assert.ok(jobs.c >= 1);
    } finally {
      spy.restore();
    }
  });

  it("FAST_SAVE_SIMULATION_UPDATE — save succeeds with 0 provider calls before return", async () => {
    const userId = 92004;
    const spy = installHangingProviderFetch();
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    let providerCallsBeforeSaveReturn = 0;
    try {
      seedUser(userId);
      const created = await createCharacterFromForm(
        { id: userId, nickname: `user${userId}`, is_adult: 1 },
        simulationBody({ name: "sim-v1" })
      );
      assert.equal(created.ok, true);

      const updated = await updateCharacterFromForm(
        { id: userId, nickname: `user${userId}`, is_adult: 1 },
        (created as { id: number }).id,
        simulationBody({ name: "sim-v2", simulation_cast: `${LONG_PROMPT}\n추가` })
      );
      providerCallsBeforeSaveReturn = spy.calls;
      assert.equal(updated.ok, true);
      assert.equal(providerCallsBeforeSaveReturn, 0);
    } finally {
      spy.restore();
    }
  });

  it("FAST_SAVE_WORLD_CREATE — insert world + enqueueWorldTranslationJob like API, 0 provider calls", async () => {
    const userId = 92005;
    const spy = installHangingProviderFetch();
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    let providerCallsBeforeSaveReturn = 0;
    try {
      seedUser(userId);
      const content = "세계관 신규 본문".repeat(40);
      const worldId = createWorldLikeApi(userId, content);
      providerCallsBeforeSaveReturn = spy.calls;
      assert.equal(providerCallsBeforeSaveReturn, 0);

      const db = getDb();
      const row = db
        .prepare(`SELECT content, content_en, content_translation_fingerprint FROM worlds WHERE id = ?`)
        .get(worldId) as {
        content: string;
        content_en: string;
        content_translation_fingerprint: string;
      };
      assert.equal(row.content, content);
      assert.equal(row.content_en, "");
      assert.equal(row.content_translation_fingerprint, "");
      const jobs = db
        .prepare(
          `SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE job_kind='world_translate' AND entity_id=?`
        )
        .get(worldId) as { c: number };
      assert.equal(jobs.c, 1);
    } finally {
      spy.restore();
    }
  });

  it("FAST_SAVE_WORLD_UPDATE — content update enqueues job, 0 provider calls before return", async () => {
    const userId = 92006;
    const spy = installHangingProviderFetch();
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    let providerCallsBeforeSaveReturn = 0;
    try {
      seedUser(userId);
      const worldId = createWorldLikeApi(userId, "v1 세계관".repeat(30));
      const nextContent = "v2 세계관".repeat(30);
      updateWorldLikeApi(worldId, userId, nextContent);
      providerCallsBeforeSaveReturn = spy.calls;
      assert.equal(providerCallsBeforeSaveReturn, 0);

      const db = getDb();
      const row = db.prepare(`SELECT content FROM worlds WHERE id = ?`).get(worldId) as { content: string };
      assert.equal(row.content, nextContent);
      const jobs = db
        .prepare(
          `SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE job_kind='world_translate' AND entity_id=?`
        )
        .get(worldId) as { c: number };
      assert.equal(jobs.c, 2);
    } finally {
      spy.restore();
    }
  });
});

describe("english hash semantics (E1/E2/E3)", () => {
  it("E1 — v1 english current, save v2 without worker, loadEnglishChunks null, uses Korean", async () => {
    const userId = 92101;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const created = await createCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      characterBody({ name: "e1-v1" })
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;

    const rowV1 = loadCharacterRow(characterId);
    const koreanV1 = deserializeCharacterChunks(rowV1.setting_chunks ?? "[]");
    const englishV1 = koreanV1
      .filter((c) => c.category !== "speech")
      .map((c) => ({ ...c, content: `EN-${c.content.slice(0, 24)}` }));
    const hashV1 = koreanChunksTranslationFingerprint(koreanV1);
    getDb()
      .prepare(`UPDATE characters SET setting_chunks_en=?, prompt_translation_hash=? WHERE id=?`)
      .run(JSON.stringify(englishV1), hashV1, characterId);

    const updated = await updateCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      characterId,
      characterBody({ name: "e1-v2", system_prompt: `[외형]\n은발\n\n${LONG_PROMPT}\n변경` })
    );
    assert.equal(updated.ok, true);

    const rowV2 = loadCharacterRow(characterId);
    const koreanV2 = deserializeCharacterChunks(rowV2.setting_chunks ?? "[]");
    assert.equal(loadEnglishChunks(rowV2, koreanV2), null);
    const loaded = loadCharacterChunksForPrompt(rowV2, "페르소나", "유저");
    assert.equal(loaded.usedEnglish, false);
    assert.ok(loaded.chunks.some((c) => c.content.includes("설정")));
  });

  it("E2 — after v2 worker CAS, english layer is current", async () => {
    const userId = 92102;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const created = await createCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      characterBody({ name: "e2-v1" })
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;

    const updated = await updateCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      characterId,
      characterBody({ name: "e2-v2", system_prompt: `[외형]\n단발\n\n[성격]\n${LONG_PROMPT}\nE2` })
    );
    assert.equal(updated.ok, true);

    const db = getDb();
    const settingRow = loadCharacterSettingRow(db, characterId);
    assert.ok(settingRow);
    const fingerprint = characterCanonicalSourceFingerprintFromRow(settingRow!);

    const deferred = installDeferredProviderFetch();
    try {
      const processed = await processEntityJobWithDeferred(
        {
          jobKind: "character_derived_refresh",
          entityType: "character",
          entityId: characterId,
          sourceFingerprint: fingerprint,
        },
        deferred
      );
      assert.equal(processed, true);
    } finally {
      deferred.restore();
    }

    const row = loadCharacterRow(characterId);
    const korean = deserializeCharacterChunks(row.setting_chunks ?? "[]");
    const english = loadEnglishChunks(row, korean);
    assert.ok(english);
    assert.notEqual(english!.find((c) => c.category === "identity")?.content, "");
    const loaded = loadCharacterChunksForPrompt(row, "페르소나", "유저");
    assert.equal(loaded.usedEnglish, true);
  });

  it("E3 — v1 deferred translation completes after v2 save, CAS fails (no stale publish)", async () => {
    const userId = 92103;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const created = await createCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      simulationBody({ name: "e3-v1" })
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;

    const db = getDb();
    const job = claimJobForEntity(db, {
      jobKind: "character_derived_refresh",
      entityType: "character",
      entityId: characterId,
    });
    assert.ok(job);

    const deferred = installDeferredProviderFetch();
    try {
      await runDeferredRaceAfterSave({
        db,
        job: job!,
        deferred,
        save: () =>
          updateCharacterFromForm(
            { id: userId, nickname: `user${userId}`, is_adult: 1 },
            characterId,
            simulationBody({ name: "e3-v2", simulation_cast: `${LONG_PROMPT}\nE3-NEW` })
          ),
      });
    } finally {
      deferred.restore();
    }

    const row = loadCharacterRow(characterId);
    const korean = deserializeCharacterChunks(row.setting_chunks ?? "[]");
    assert.equal(loadEnglishChunks(row, korean), null);
    assert.ok(!row.setting_chunks_en?.includes("STALE-V1-EN"));
  });
});

describe("race — stale worker CAS (R1/R2/R3)", () => {
  it("R1 — character translation v1 job, save v2, v1 completes — no publish", async () => {
    const userId = 92201;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const created = await createCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      simulationBody({ name: "r1-v1" })
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;

    const db = getDb();
    const job = claimJobForEntity(db, {
      jobKind: "character_derived_refresh",
      entityType: "character",
      entityId: characterId,
    });
    assert.ok(job);

    const deferred = installDeferredProviderFetch();
    try {
      await runDeferredRaceAfterSave({
        db,
        job: job!,
        deferred,
        save: () =>
          updateCharacterFromForm(
            { id: userId, nickname: `user${userId}`, is_adult: 1 },
            characterId,
            simulationBody({ name: "r1-v2", simulation_cast: `${LONG_PROMPT}\nR1` })
          ),
      });
    } finally {
      deferred.restore();
    }

    const row = loadCharacterRow(characterId);
    assert.ok(!row.setting_chunks_en?.includes("R1-STALE"));
  });

  it("R2 — world translation v1, save v2 content, v1 completes — no publish", async () => {
    const userId = 92202;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const v1 = "R2-세계-v1".repeat(20);
    const v2 = "R2-세계-v2".repeat(20);
    const worldId = createWorldLikeApi(userId, v1);

    const db = getDb();
    const job = claimJobForEntity(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId: worldId,
    });
    assert.ok(job);
    assert.equal(job!.job_kind, "world_translate");

    const deferred = installDeferredProviderFetch();
    const workerPromise = processDerivedCacheJob(db, job!);

    updateWorldLikeApi(worldId, userId, v2);

    deferred.resolveAll(mockTranslationResponseForBody(deferred.bodies.at(-1) ?? "", "R2-STALE-WORLD-EN"));
    await workerPromise;
    deferred.restore();

    const row = db
      .prepare(`SELECT content, content_en FROM worlds WHERE id = ?`)
      .get(worldId) as { content: string; content_en: string };
    assert.equal(row.content, v2);
    assert.notEqual(row.content_en, "R2-STALE-WORLD-EN");
    assert.equal(row.content_en, "");
  });

  it("R3 — appearance raw A job, save raw B, A compile resolves — 0 DB changes, runtime uses B raw", async () => {
    const userId = 92203;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const created = await createCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      characterBodyWithAppearance("금발", { name: "r3" })
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;

    const db = getDb();
    const job = claimJobForEntity(db, {
      jobKind: "character_derived_refresh",
      entityType: "character",
      entityId: characterId,
    });
    assert.ok(job);

    const beforeCompiled = db
      .prepare(`SELECT appearance_compiled FROM characters WHERE id=?`)
      .get(characterId) as { appearance_compiled: string };

    const deferred = installDeferredProviderFetch();
    try {
      await runDeferredRaceAfterSave({
        db,
        job: job!,
        deferred,
        save: () =>
          updateCharacterFromForm(
            { id: userId, nickname: `user${userId}`, is_adult: 1 },
            characterId,
            characterBodyWithAppearance("흑발", { name: "r3" })
          ),
      });
    } finally {
      deferred.restore();
    }

    const after = db
      .prepare(
        `SELECT appearance_raw, appearance_compiled, appearance_compiled_source_hash FROM characters WHERE id=?`
      )
      .get(characterId) as {
      appearance_raw: string;
      appearance_compiled: string;
      appearance_compiled_source_hash: string;
    };
    assert.equal(after.appearance_compiled, beforeCompiled.appearance_compiled);
    assert.equal(after.appearance_raw, "흑발");

    const settingRow = loadCharacterSettingRow(db, characterId);
    assert.ok(settingRow);
    const runtimeAppearance = resolveAppearancePromptText({
      raw: settingRow!.appearance_raw ?? "",
      compiledJson: settingRow!.appearance_compiled,
      compiledSourceHash: settingRow!.appearance_compiled_source_hash,
      compiledVersion: settingRow!.appearance_compiled_version,
    });
    assert.equal(runtimeAppearance, "흑발");
  });
});

describe("appearance → final translation orchestration (A1)", () => {
  it("A1 — worker compiles appearance before chunk translation", async () => {
    const userId = 92301;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const created = await createCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      characterBodyWithAppearance("은색 단발", { name: "a1" })
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;

    const order: string[] = [];
    const deferred = installDeferredProviderFetch((body) => {
      order.push(isAppearanceFetchBody(body) ? "appearance" : "translation");
      return null;
    });
    try {
      await processEntityJobWithDeferred(
        { jobKind: "character_derived_refresh", entityType: "character", entityId: characterId },
        deferred
      );
      assert.deepEqual(order.slice(0, 2), ["appearance", "translation"]);
    } finally {
      deferred.restore();
    }

    const row = loadCharacterRow(characterId);
    const korean = deserializeCharacterChunks(row.setting_chunks ?? "[]");
    assert.ok(loadEnglishChunks(row, korean));
  });
});

describe("borrow integration — shared world translation (B1/B2)", () => {
  it("B1/B2 — S1 world Korean translated once; borrowers never re-translate world Korean", async () => {
    const ownerId = 92401;
    const borrower1 = 92402;
    const borrower2 = 92403;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(ownerId, "owner-s1");
    seedUser(borrower1, "borrower-b1");
    seedUser(borrower2, "borrower-b2");

    const worldMarker = `BORROW-WORLD-KO-${Date.now()}`;
    const worldId = seedOwnedWorld(ownerId, worldMarker);
    const shared = createWorldShare(ownerId, worldId);
    assert.ok(!("error" in shared));
    const shareId = shared.share.id;

    const deferred = installDeferredProviderFetch();

    let s1WorldCalls = 0;
    let b1WorldCalls = 0;
    let b2WorldCalls = 0;

    try {
      const processedShare = await processEntityJobWithDeferred(
        { jobKind: "world_share_translate", entityType: "world_share", entityId: shareId },
        deferred
      );
      assert.equal(processedShare, true);
      assert.ok(loadCurrentShareWorldEnglish(shareId));
      s1WorldCalls = countDedicatedWorldTranslationCalls(deferred.bodies, worldMarker);

      const borrow1 = borrowWorldShareToUser(borrower1, shared.share.share_slug);
      const borrow2 = borrowWorldShareToUser(borrower2, shared.share.share_slug);
      assert.equal(borrow1.ok, true);
      assert.equal(borrow2.ok, true);
      if (!borrow1.ok || !borrow2.ok) return;

      const bodiesBeforeB1 = deferred.bodies.length;
      const createdB1 = await createCharacterFromForm(
        { id: borrower1, nickname: "borrower-b1", is_adult: 1 },
        characterBody({ world_borrow_id: borrow1.borrow.id, name: "B1-char" })
      );
      assert.equal(createdB1.ok, true);
      await processEntityJobWithDeferred(
        {
          jobKind: "character_derived_refresh",
          entityType: "character",
          entityId: (createdB1 as { id: number }).id,
        },
        deferred
      );
      b1WorldCalls = countDedicatedWorldTranslationCalls(deferred.bodies.slice(bodiesBeforeB1), worldMarker);

      const bodiesBeforeB2 = deferred.bodies.length;
      const createdB2 = await createCharacterFromForm(
        { id: borrower2, nickname: "borrower-b2", is_adult: 1 },
        characterBody({ world_borrow_id: borrow2.borrow.id, name: "B2-char" })
      );
      assert.equal(createdB2.ok, true);
      await processEntityJobWithDeferred(
        {
          jobKind: "character_derived_refresh",
          entityType: "character",
          entityId: (createdB2 as { id: number }).id,
        },
        deferred
      );
      b2WorldCalls = countDedicatedWorldTranslationCalls(deferred.bodies.slice(bodiesBeforeB2), worldMarker);

      assert.equal(s1WorldCalls, 1);
      assert.equal(b1WorldCalls, 0);
      assert.equal(b2WorldCalls, 0);
    } finally {
      deferred.restore();
    }
  });
});

function seedOwnedWorld(creatorId: number, content: string) {
  return seedWorld(creatorId, content, "borrow-world");
}

describe("job backoff and dedupe (J1/J2/J3)", () => {
  it("J1 — identical enqueue preserves run_after backoff", () => {
    const db = getDb();
    ensureDerivedCacheJobsTable(db);
    const entityId = 92501;
    const fp = worldContentFingerprint("j1-content");

    enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId,
      sourceFingerprint: fp,
      derivationVersion: TRANSLATION_DERIVATION_VERSION,
    });
    db.prepare(`UPDATE derived_cache_jobs SET run_after = datetime('now', '+30 minutes') WHERE entity_id=?`).run(
      entityId
    );
    const before = db
      .prepare(`SELECT run_after FROM derived_cache_jobs WHERE entity_id=?`)
      .get(entityId) as { run_after: string };

    enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId,
      sourceFingerprint: fp,
      derivationVersion: TRANSLATION_DERIVATION_VERSION,
    });

    const after = db
      .prepare(`SELECT run_after FROM derived_cache_jobs WHERE entity_id=?`)
      .get(entityId) as { run_after: string };
    assert.equal(after.run_after, before.run_after);
  });

  it("J2 — terminal failed job is not revived by identical enqueue", () => {
    const db = getDb();
    ensureDerivedCacheJobsTable(db);
    const entityId = 92502;
    const fp = worldContentFingerprint("j2-content");

    enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId,
      sourceFingerprint: fp,
      derivationVersion: TRANSLATION_DERIVATION_VERSION,
    });
    db.prepare(`UPDATE derived_cache_jobs SET status='failed', last_error='terminal' WHERE entity_id=?`).run(
      entityId
    );

    const inserted = enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId,
      sourceFingerprint: fp,
      derivationVersion: TRANSLATION_DERIVATION_VERSION,
    });
    assert.equal(inserted, false);

    const row = db
      .prepare(`SELECT status, last_error FROM derived_cache_jobs WHERE entity_id=?`)
      .get(entityId) as { status: string; last_error: string };
    assert.equal(row.status, "failed");
    assert.equal(row.last_error, "terminal");
  });

  it("J3 — new fingerprint allows a new job row", () => {
    const db = getDb();
    ensureDerivedCacheJobsTable(db);
    const entityId = 92503;
    const fp1 = worldContentFingerprint("j3-v1");
    const fp2 = worldContentFingerprint("j3-v2");

    enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId,
      sourceFingerprint: fp1,
      derivationVersion: TRANSLATION_DERIVATION_VERSION,
    });
    enqueueDerivedCacheJob(db, {
      jobKind: "world_translate",
      entityType: "world",
      entityId,
      sourceFingerprint: fp2,
      derivationVersion: TRANSLATION_DERIVATION_VERSION,
    });

    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE entity_id=?`)
      .get(entityId) as { c: number };
    assert.equal(count.c, 2);
  });
});

describe("FORCE regenerate_appearance", () => {
  it("regenerate_appearance triggers exactly one appearance provider call", async () => {
    const userId = 92601;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const created = await createCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      characterBody({ name: "force-app" })
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;

    const db = getDb();
    db.prepare(
      `UPDATE characters SET appearance_compiled=?, appearance_compiled_source_hash=?, appearance_compiled_version=? WHERE id=?`
    ).run(
      serializeAppearanceCompiledJson({ ...emptyAppearanceCompiled(), compiled_text: "cached" }),
      hashAppearanceRaw("검은 머리"),
      APPEARANCE_COMPILED_VERSION,
      characterId
    );

    const deferred = installDeferredProviderFetch();

    try {
      const updated = await updateCharacterFromForm(
        { id: userId, nickname: `user${userId}`, is_adult: 1 },
        characterId,
        characterBody({ name: "force-app", regenerate_appearance: true })
      );
      assert.equal(updated.ok, true);

      const settingRow = loadCharacterSettingRow(db, characterId);
      assert.ok(settingRow);
      await processEntityJobWithDeferred(
        {
          jobKind: "character_derived_refresh",
          entityType: "character",
          entityId: characterId,
          sourceFingerprint: characterCanonicalSourceFingerprintFromRow(settingRow!),
        },
        deferred
      );

      const appearanceCalls = deferred.bodies.filter((body) => isAppearanceFetchBody(body)).length;
      assert.equal(appearanceCalls, 1);
    } finally {
      deferred.restore();
    }
  });
});

describe("SPEECH_PROFILE regression", () => {
  it("translation-only derived refresh does not change speech_profile", async () => {
    const userId = 92701;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const created = await createCharacterFromForm(
      { id: userId, nickname: `user${userId}`, is_adult: 1 },
      characterBody({ name: "speech-lock" })
    );
    assert.equal(created.ok, true);
    const characterId = (created as { id: number }).id;

    const before = loadCharacterRow(characterId).speech_profile ?? "";

    const deferred = installDeferredProviderFetch();
    try {
      await processEntityJobWithDeferred(
        { jobKind: "character_derived_refresh", entityType: "character", entityId: characterId },
        deferred
      );
    } finally {
      deferred.restore();
    }

    const after = loadCharacterRow(characterId).speech_profile ?? "";
    assert.equal(after, before);
  });
});

describe("owned world EN consumer", () => {
  it("uses owned worlds.content_en without re-translating world Korean", async () => {
    const userId = 92801;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(userId);

    const koreanWorld = "소유 세계관 {{user}} 본문";
    const worldId = seedWorld(userId, koreanWorld);
    const fp = worldContentFingerprint(koreanWorld);
    getDb()
      .prepare(`UPDATE worlds SET content_en=?, content_translation_fingerprint=? WHERE id=?`)
      .run("Owned world EN {{user}} body", fp, worldId);

    let sawDedicatedWorldTranslation = false;
    const deferred = installDeferredProviderFetch((body) => {
      if (countDedicatedWorldTranslationCalls([body], "소유 세계관") > 0) {
        sawDedicatedWorldTranslation = true;
      }
      return mockTranslationResponseForBody(body, "translated identity owned");
    });

    try {
      const db = getDb();
      const info = db
        .prepare(
          `INSERT INTO characters (name, system_prompt, world, world_id, setting_chunks, creator_id, creator_name)
           VALUES ('c','prompt',?, ?, '[]', ?, 'u')`
        )
        .run(koreanWorld, worldId, userId);
      const characterId = Number(info.lastInsertRowid);
      const chunks: CharacterChunk[] = [
        {
          id: "c-1",
          characterId: String(characterId),
          content: "identity",
          category: "identity",
          importance: "CRITICAL",
          tokenCount: 5,
          keywords: [],
        },
        {
          id: "c-2",
          characterId: String(characterId),
          content: koreanWorld,
          category: "world",
          importance: "CRITICAL",
          tokenCount: 10,
          keywords: [],
        },
      ];
      db.prepare(`UPDATE characters SET setting_chunks=?, prompt_translation_hash=? WHERE id=?`).run(
        JSON.stringify(chunks),
        koreanChunksTranslationFingerprint(chunks),
        characterId
      );

      assert.equal(loadOwnedWorldEnglishForCharacter(characterId), "Owned world EN {{user}} body");

      const ok = await translateCharacterChunksForDerivedRefresh(characterId, chunks);
      assert.equal(ok, true);
      assert.equal(sawDedicatedWorldTranslation, false);

      const stored = db
        .prepare(`SELECT setting_chunks_en FROM characters WHERE id=?`)
        .get(characterId) as { setting_chunks_en: string };
      const english = deserializeCharacterChunks(stored.setting_chunks_en);
      assert.equal(english.find((c) => c.category === "world")?.content, "Owned world EN {{user}} body");
    } finally {
      deferred.restore();
    }
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
    const shareSlug = `share-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const shareInsert = db
      .prepare(
        `INSERT INTO world_shares (share_slug, user_id, world_id, name, summary, content, content_en, content_translation_fingerprint)
         VALUES (?, 9010, ?, 'W', 's', ?, 'World EN {{user}}', ?)`
      )
      .run(shareSlug, worldId, koreanWorld, worldContentFingerprint(koreanWorld));
    const shareId = Number(shareInsert.lastInsertRowid);

    let sawWorldKorean = false;
    const deferred = installDeferredProviderFetch((body) => {
      if (body.includes("세계관 본문")) sawWorldKorean = true;
      return mockSegmentedTranslationResponse(["translated-identity"]);
    });

    try {
      const info = db
        .prepare(
          `INSERT INTO characters (name, system_prompt, world, source_world_share_id, setting_chunks, creator_id, creator_name)
           VALUES ('c','prompt',?, ?, '[]', 9010, 'u')`
        )
        .run(koreanWorld, shareId);
      const characterId = Number(info.lastInsertRowid);
      const chunks: CharacterChunk[] = [
        {
          id: "c-1",
          characterId: String(characterId),
          content: "identity",
          category: "identity",
          importance: "CRITICAL",
          tokenCount: 5,
          keywords: [],
        },
        {
          id: "c-2",
          characterId: String(characterId),
          content: koreanWorld,
          category: "world",
          importance: "CRITICAL",
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
      assert.equal(ok, true);
      assert.equal(sawWorldKorean, false);
      const stored = db
        .prepare(`SELECT setting_chunks_en FROM characters WHERE id = ?`)
        .get(characterId) as { setting_chunks_en: string };
      const english = deserializeCharacterChunks(stored.setting_chunks_en);
      assert.equal(english.find((c) => c.category === "world")?.content, "World EN {{user}}");
    } finally {
      deferred.restore();
    }
  });

  it("missing EN enqueues share job and does not per-borrower translate world Korean", async () => {
    const ownerId = 92901;
    const borrowerId = 92902;
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    process.env.CHEAPER_INFERENCE_API_KEY = "test";
    seedUser(ownerId, "share-owner");
    seedUser(borrowerId, "share-borrower");

    const koreanWorld = `공유 미번역 세계관 {{user}} ${Date.now()}`;
    const worldId = seedWorld(ownerId, koreanWorld);
    const db = getDb();
    const shareSlug = `missing-en-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const shareInsert = db
      .prepare(
        `INSERT INTO world_shares (share_slug, user_id, world_id, name, summary, content, content_en, content_translation_fingerprint)
         VALUES (?, ?, ?, 'W', 's', ?, '', '')`
      )
      .run(shareSlug, ownerId, worldId, koreanWorld);
    const shareId = Number(shareInsert.lastInsertRowid);
    const { enqueueWorldShareTranslationJob } = await import("@/lib/derivedCache/worldTranslation");
    enqueueWorldShareTranslationJob(db, shareId, koreanWorld);

    const shareJobs = db
      .prepare(
        `SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE job_kind='world_share_translate' AND entity_id=?`
      )
      .get(shareId) as { c: number };
    assert.equal(shareJobs.c, 1);
    assert.equal(loadCurrentShareWorldEnglish(shareId), null);

    const borrowed = borrowWorldShareToUser(borrowerId, shareSlug);
    assert.equal(borrowed.ok, true);
    if (!borrowed.ok) return;

    let dedicatedWorldCalls = 0;
    const deferred = installDeferredProviderFetch((body) => {
      if (countDedicatedWorldTranslationCalls([body], "공유 미번역") > 0) {
        dedicatedWorldCalls += 1;
      }
      return mockTranslationResponseForBody(body, "borrower identity only");
    });

    try {
      const created = await createCharacterFromForm(
        { id: borrowerId, nickname: "share-borrower", is_adult: 1 },
        characterBody({ world_borrow_id: borrowed.borrow.id, name: "share-borrow-char" })
      );
      assert.equal(created.ok, true);
      const characterId = (created as { id: number }).id;

      const row = loadCharacterRow(characterId);
      const chunks = deserializeCharacterChunks(row.setting_chunks ?? "[]");
      assert.equal(loadShareWorldEnglishForCharacter(characterId), null);
      const ok = await translateCharacterChunksForDerivedRefresh(characterId, chunks);
      if (chunks.some((chunk) => chunk.category === "world")) {
        assert.equal(ok, false);
      }
      assert.equal(dedicatedWorldCalls, 0);

      const shareJobsAfter = db
        .prepare(
          `SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE job_kind='world_share_translate' AND entity_id=?`
        )
        .get(shareId) as { c: number };
      assert.equal(shareJobsAfter.c, 1);
    } finally {
      deferred.restore();
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
