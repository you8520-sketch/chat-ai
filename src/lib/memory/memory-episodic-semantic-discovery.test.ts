import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  deleteEpisodicMemoryFactsByAssistantMessageIds,
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
  hasEpisodicSemanticIndexInScope,
  listEpisodicFactsForSemanticIndexing,
  persistEpisodicMemoryFactsCore,
  reconcileEpisodicMemoryFactsForGeneration,
  replaceEpisodicMemoryFactsForCanonicalMutation,
  type GetEpisodicMemoryForPromptInput,
} from "@/lib/episodicMemoryFacts";
import {
  decodeEmbeddingBlob,
  deleteEpisodicFactEmbeddingsForCharacterChats,
  EPISODIC_FACT_EMBEDDINGS_TABLE,
  encodeEmbeddingHex,
  ensureEpisodicFactEmbeddingSchema,
  episodicFactContentHash,
  episodicFactEmbeddingInput,
  episodicFactSemanticText,
  normalizeEmbeddingVector,
  upsertEpisodicFactEmbedding,
} from "@/lib/memory/memory-episodic-semantic-index";
import {
  openRouterEpisodicEmbedder,
  resolveEpisodicSemanticQuery,
  runEpisodicSemanticIndexJob,
} from "@/lib/memory/memory-episodic-semantic-jobs";
import {
  EPISODIC_SEMANTIC_MAX_FACT_CHARS,
  EPISODIC_SEMANTIC_MODEL_CANDIDATES,
  resolveEpisodicSemanticRuntime,
} from "@/lib/memory/memory-episodic-semantic-config";
import {
  countingSyntheticEmbedder,
  indexChatSynthetically,
  SYNTHETIC_SEMANTIC_MODEL,
  syntheticEmbed,
  syntheticQuery,
  syntheticRuntime,
} from "@/lib/memory/memory-episodic-semantic-synthetic.test";

const env = { MEMORY_FEATURE_ENABLED: "1", EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv;

const KNOWN_GAP_FACT = "사용자는 천둥 소리를 무서워한다고 명시했다.";
const KNOWN_GAP_QUERY = "폭풍우 속 옛 공포가 되살아나는 밤";

function openDb(): Database.Database {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  db.exec(
    "CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)"
  );
  db.prepare("INSERT INTO chat_memories (chat_id) VALUES (1)").run();
  return db;
}

function insertFact(
  db: Database.Database,
  f: { turn: number; subject: string; attribute?: string; value?: string; importance?: string; text: string; category?: string; sourceUserMessageId?: number; metadata?: string }
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO episodic_memory_facts
         (chat_id, source_turn, source_user_message_id, category, subject, attribute, value, importance, fact_text, metadata)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        f.turn,
        f.sourceUserMessageId ?? null,
        f.category ?? "setting",
        f.subject,
        f.attribute ?? "note",
        f.value ?? "v",
        f.importance ?? "normal",
        f.text,
        f.metadata ?? '{"memory_evidence_type":"explicit_scene_event","content_route":"safe"}'
      ).lastInsertRowid
  );
}

function saturate(db: Database.Database, count: number, startTurn: number): void {
  for (let i = 0; i < count; i++) {
    insertFact(db, { turn: startTurn + i, subject: `filler${i}`, value: `v${i}`, text: `채우기 기록 ${i}번 항해 일지 바다 파도` });
  }
}

function seedKnownGap(db: Database.Database): number {
  const id = insertFact(db, { turn: 10, subject: "thunderfear", value: "quietdread", text: KNOWN_GAP_FACT });
  saturate(db, 60, 20);
  return id;
}

function vectorCount(db: Database.Database): number {
  ensureEpisodicFactEmbeddingSchema(db);
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}`).get() as { c: number }).c;
}

/** Strips volatile fields so baseline vs fallback outputs can be compared exactly. */
function comparable(result: ReturnType<typeof getEpisodicMemoryForPrompt>) {
  return { ids: result.facts.map((f) => f.id), promptBlock: result.promptBlock, debug: result.debug };
}

let httpCalls = 0;
let savedFetch: typeof fetch | undefined;
beforeEach(() => {
  httpCalls = 0;
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    httpCalls += 1;
    throw new Error("real provider HTTP is forbidden in this suite");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = savedFetch!;
  assert.equal(httpCalls, 0, "no real provider HTTP");
});

describe("A. known gap — semantic candidate discovery", () => {
  it("BEFORE: row exists, candidate miss, final miss (exact lexical V2)", () => {
    const db = openDb();
    const answerId = seedKnownGap(db);
    const input: GetEpisodicMemoryForPromptInput = { chatId: 1, currentTurn: 200, currentUserMessage: KNOWN_GAP_QUERY };
    assert.equal(fetchEpisodicMemoryCandidatesForDebug(db, input, env).rows.some((r) => r.id === answerId), false);
    assert.equal(getEpisodicMemoryForPrompt(db, input, env).facts.some((f) => f.id === answerId), false);
    db.close();
  });

  it("AFTER: synthetic semantic lane → candidate hit, scorer semantic evidence → final hit", async () => {
    const db = openDb();
    const answerId = seedKnownGap(db);
    await indexChatSynthetically(db, 1);
    const input: GetEpisodicMemoryForPromptInput = {
      chatId: 1,
      currentTurn: 200,
      currentUserMessage: KNOWN_GAP_QUERY,
      semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY),
    };
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    assert.equal(pre.rows.some((r) => r.id === answerId), true);
    assert.deepEqual(pre.laneById.get(answerId), ["semantic"]);
    assert.ok(pre.stats.mergedCandidateCount <= 100, "candidate limit unchanged");
    const result = getEpisodicMemoryForPrompt(db, input, env);
    assert.equal(result.facts.some((f) => f.id === answerId), true);
    const dbg = result.debug.find((d) => d.id === answerId)!;
    assert.equal(dbg.relevance_score, 0, "no lexical evidence — semantic evidence passed the gate");
    assert.ok((dbg.semantic_similarity ?? 0) >= SYNTHETIC_SEMANTIC_MODEL.similarityPassThreshold);
    assert.equal(dbg.relevance_pass, true);
    db.close();
  });
});

describe("B/C. negatives", () => {
  it("B: unrelated fact with low similarity is neither a semantic candidate nor injected", async () => {
    const db = openDb();
    const towerId = insertFact(db, { turn: 10, subject: "tower", attribute: "color", value: "blue", text: "북쪽 탑은 파란색이었다." });
    await indexChatSynthetically(db, 1);
    const input = { chatId: 1, currentTurn: 60, currentUserMessage: KNOWN_GAP_QUERY, semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY) };
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    assert.equal(pre.laneById.get(towerId)?.includes("semantic") ?? false, false);
    assert.equal(getEpisodicMemoryForPrompt(db, input, env).facts.length, 0);
    db.close();
  });

  it("C: zero-relevant control stays at 0 facts with semantic on", async () => {
    const db = openDb();
    insertFact(db, { turn: 10, subject: "tower", attribute: "color", value: "blue", text: "북쪽 탑은 파란색이었다." });
    await indexChatSynthetically(db, 1);
    const q = "바다 항해를 시작한다";
    const result = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: 20, currentUserMessage: q, semanticQuery: await syntheticQuery(q) }, env);
    assert.equal(result.facts.length, 0);
    assert.equal(result.promptBlock, "");
    db.close();
  });
});

describe("D. temporal owner stays authoritative", () => {
  it("old state vector exists, only the latest state is injected", async () => {
    const db = openDb();
    const oldId = insertFact(db, { turn: 10, subject: "harbor", attribute: "moored_ship", value: "bluegull", text: "항구에 갈매기호가 정박했다." });
    const latestId = insertFact(db, { turn: 30, subject: "harbor", attribute: "moored_ship", value: "redgull", text: "항구의 정박 선박이 빨간갈매기호로 바뀌었다." });
    await indexChatSynthetically(db, 1);
    const q = "옛 항구 풍경을 떠올린다";
    const ids = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: 60, currentUserMessage: q, semanticQuery: await syntheticQuery(q) }, env).facts.map((f) => f.id);
    assert.equal(ids.includes(latestId), true);
    assert.equal(ids.includes(oldId), false);
    db.close();
  });
});

describe("E–H. mutation and boundary safety — stale vectors never resurrect", () => {
  const stormText = "폭풍우 밤에 둘은 동굴로 피신했다.";
  const stormQuery = "천둥이 치던 그 밤의 기억";

  it("E: regeneration-rejected fact with a leftover vector is not recalled; job prunes the orphan", async () => {
    const db = openDb();
    insertFact(db, {
      turn: 10,
      subject: "storm",
      text: stormText,
      metadata: '{"memory_evidence_type":"explicit_scene_event","content_route":"safe","assistant_message_id":501,"request_id":"r1"}',
    });
    await indexChatSynthetically(db, 1);
    assert.equal(vectorCount(db), 1);
    reconcileEpisodicMemoryFactsForGeneration(db, { chatId: 1, sourceTurn: 10, facts: [], isRegeneration: true, metadata: { regenerated: true } });
    const input = { chatId: 1, currentTurn: 40, currentUserMessage: stormQuery, semanticQuery: await syntheticQuery(stormQuery) };
    assert.equal(fetchEpisodicMemoryCandidatesForDebug(db, input, env).rows.length, 0);
    assert.equal(getEpisodicMemoryForPrompt(db, input, env).facts.length, 0);
    const job = await runEpisodicSemanticIndexJob({ db, chatId: 1, runtime: syntheticRuntime(), embed: countingSyntheticEmbedder().embed });
    assert.equal(job.prunedOrphans, 1);
    assert.equal(vectorCount(db), 0);
    db.close();
  });

  it("F: message edit — old vector ignored; only the edited canonical fact is recalled", async () => {
    const db = openDb();
    const v1 = { category: "setting", subject: "storm", attribute: "shelter", value: "cave", importance: "normal", fact_text: stormText, evidence_type: "explicit_scene_event" } as const;
    const v2 = { ...v1, value: "hut", fact_text: "폭풍우 밤에 둘은 오두막으로 피신했다." } as const;
    assert.equal(persistEpisodicMemoryFactsCore(db, { chatId: 1, sourceTurn: 10, sourceUserMessageId: 7, facts: [{ ...v1 }], metadata: { content_route: "safe" } }), 1);
    await indexChatSynthetically(db, 1);
    assert.equal(replaceEpisodicMemoryFactsForCanonicalMutation(db, { chatId: 1, sourceTurn: 10, sourceUserMessageId: 7, facts: [{ ...v2 }], metadata: { content_route: "safe" } }), 1);
    const q = await syntheticQuery(stormQuery);
    const beforeReindex = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: 40, currentUserMessage: stormQuery, semanticQuery: q }, env);
    assert.equal(beforeReindex.facts.some((f) => f.value === "cave"), false, "old variant never resurrected");
    await indexChatSynthetically(db, 1);
    const after = getEpisodicMemoryForPrompt(db, { chatId: 1, currentTurn: 40, currentUserMessage: stormQuery, semanticQuery: q }, env);
    assert.deepEqual(after.facts.map((f) => f.value), ["hut"]);
    db.close();
  });

  it("G: delete/rewind — orphan vector does not resurrect the deleted fact", async () => {
    const db = openDb();
    insertFact(db, {
      turn: 10,
      subject: "storm",
      text: stormText,
      metadata: '{"memory_evidence_type":"explicit_scene_event","content_route":"safe","assistant_message_id":601,"request_id":"r1"}',
    });
    await indexChatSynthetically(db, 1);
    assert.equal(deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [601]), 1);
    assert.equal(vectorCount(db), 1, "orphan vector still physically present");
    const input = { chatId: 1, currentTurn: 40, currentUserMessage: stormQuery, semanticQuery: await syntheticQuery(stormQuery) };
    assert.equal(getEpisodicMemoryForPrompt(db, input, env).facts.length, 0);
    db.close();
  });

  it("H: fork/reset boundary — pre-boundary vectors are outside the candidate scope", async () => {
    const db = openDb();
    insertFact(db, { turn: 10, subject: "storm", text: stormText, sourceUserMessageId: 5 });
    await indexChatSynthetically(db, 1);
    db.prepare("UPDATE chat_memories SET memory_reset_after_message_id=5 WHERE chat_id=1").run();
    const input = { chatId: 1, currentTurn: 40, currentUserMessage: stormQuery, semanticQuery: await syntheticQuery(stormQuery) };
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    assert.equal(pre.stats.semantic?.vectorsScanned, 0);
    assert.equal(getEpisodicMemoryForPrompt(db, input, env).facts.length, 0);
    db.close();
  });

  it("H2: RAW min-age window — vectors of recent RAW-owned turns are out of scope", async () => {
    const db = openDb();
    insertFact(db, { turn: 38, subject: "storm", text: stormText });
    await indexChatSynthetically(db, 1);
    const input = { chatId: 1, currentTurn: 40, currentUserMessage: stormQuery, semanticQuery: await syntheticQuery(stormQuery) };
    assert.equal(fetchEpisodicMemoryCandidatesForDebug(db, input, env).stats.semantic?.vectorsScanned, 0);
    db.close();
  });
});

describe("I–K. dedupe, model identity, content hash", () => {
  it("I: semantic candidate duplicated in recent RAW is still blocked by the dedupe owner", async () => {
    const db = openDb();
    const answerId = seedKnownGap(db);
    await indexChatSynthetically(db, 1);
    const result = getEpisodicMemoryForPrompt(
      db,
      {
        chatId: 1,
        currentTurn: 200,
        currentUserMessage: KNOWN_GAP_QUERY,
        recentChatText: `유저: ${KNOWN_GAP_FACT}`,
        semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY),
      },
      env
    );
    assert.equal(result.facts.some((f) => f.id === answerId), false);
    assert.equal(result.debug.find((d) => d.id === answerId)?.duplicate_reason, "duplicate_recent_chat");
    db.close();
  });

  it("J: vectors from another model/version/dimension are never compared", async () => {
    const db = openDb();
    seedKnownGap(db);
    const otherModel = { ...SYNTHETIC_SEMANTIC_MODEL, modelId: "test/other-model" };
    await indexChatSynthetically(db, 1, otherModel);
    const otherDims = { ...SYNTHETIC_SEMANTIC_MODEL, dimensions: SYNTHETIC_SEMANTIC_MODEL.dimensions + 1 };
    const input = { chatId: 1, currentTurn: 200, currentUserMessage: KNOWN_GAP_QUERY, semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY) };
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    assert.equal(pre.stats.semantic?.vectorsScanned, 0, "synthetic model sees no other-model vectors");
    const mismatchedQuery = { model: otherDims, vector: (await syntheticQuery(KNOWN_GAP_QUERY)).vector };
    const mismatched = fetchEpisodicMemoryCandidatesForDebug(db, { ...input, semanticQuery: mismatchedQuery }, env);
    assert.equal(mismatched.laneById.size > 0 && [...mismatched.laneById.values()].some((l) => l.includes("semantic")), false);
    db.close();
  });

  it("K: canonical content changed in place → stale-hash vector ignored, then re-indexed", async () => {
    const db = openDb();
    const answerId = seedKnownGap(db);
    await indexChatSynthetically(db, 1);
    db.prepare("UPDATE episodic_memory_facts SET fact_text=? WHERE id=?").run("사용자는 바다 파도 소리를 좋아한다고 명시했다.", answerId);
    const input = { chatId: 1, currentTurn: 200, currentUserMessage: KNOWN_GAP_QUERY, semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY) };
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    assert.equal(pre.stats.semantic?.staleContentHashSkipped, 1);
    assert.equal(pre.rows.some((r) => r.id === answerId), false);
    const job = await runEpisodicSemanticIndexJob({ db, chatId: 1, runtime: syntheticRuntime(), embed: countingSyntheticEmbedder().embed });
    assert.equal(job.written, 1, "drifted row re-embedded from current canonical text");
    assert.equal(fetchEpisodicMemoryCandidatesForDebug(db, input, env).stats.semantic?.staleContentHashSkipped, 0);
    db.close();
  });
});

describe("L–M. index lifecycle", () => {
  it("L: second index run for the same fact/hash/model performs no embedding", async () => {
    const db = openDb();
    seedKnownGap(db);
    const counter = countingSyntheticEmbedder();
    const first = await indexChatSynthetically(db, 1, SYNTHETIC_SEMANTIC_MODEL, counter.embed);
    const callsAfterFirst = counter.calls();
    const second = await runEpisodicSemanticIndexJob({ db, chatId: 1, runtime: syntheticRuntime(), embed: counter.embed });
    assert.equal(first, 1, "only the guard-valid fact is indexed; 60 non-sentence fillers are never sent");
    assert.equal(counter.inputs(), 1);
    assert.equal(second.status, "idle");
    assert.equal(counter.calls(), callsAfterFirst, "no extra embedding call");
    db.close();
  });

  it("M: an embedding result that raced a canonical mutation is dropped, not written", async () => {
    const db = openDb();
    const answerId = insertFact(db, {
      turn: 10,
      subject: "thunderfear",
      text: KNOWN_GAP_FACT,
      metadata: '{"memory_evidence_type":"explicit_scene_event","content_route":"safe","assistant_message_id":701,"request_id":"r1"}',
    });
    const job = await runEpisodicSemanticIndexJob({
      db,
      chatId: 1,
      runtime: syntheticRuntime(),
      embed: async (texts) => {
        deleteEpisodicMemoryFactsByAssistantMessageIds(db, 1, [701]);
        return texts.map(syntheticEmbed);
      },
    });
    assert.equal(job.written, 0);
    assert.equal(job.droppedStale, 1);
    assert.equal(vectorCount(db), 0);
    const remaining = db.prepare("SELECT COUNT(*) AS c FROM episodic_memory_facts WHERE id=?").get(answerId) as { c: number };
    assert.equal(remaining.c, 0, "canonical mutation won; no vector for the deleted fact");
    db.close();
  });
});

describe("N. fallback — any semantic failure is exact lexical Retrieval V2", () => {
  const failures: Array<[string, () => Promise<Response> | Response]> = [
    ["timeout/network", () => { throw new TypeError("fetch failed: network timeout"); }],
    ["429", () => new Response("rate limited", { status: 429 })],
    ["4xx", () => new Response("bad request", { status: 400 })],
    ["5xx", () => new Response("upstream", { status: 503 })],
    ["malformed JSON", () => new Response("{not json", { status: 200 })],
    ["wrong vector count", () => Response.json({ object: "list", model: SYNTHETIC_SEMANTIC_MODEL.modelId, data: [], usage: { prompt_tokens: 3, total_tokens: 3 } })],
    ["NaN/Infinity", () => new Response(`{"object":"list","model":"${SYNTHETIC_SEMANTIC_MODEL.modelId}","data":[{"object":"embedding","index":0,"embedding":[${new Array(SYNTHETIC_SEMANTIC_MODEL.dimensions).fill("1e999").join(",")}]}],"usage":{"prompt_tokens":3,"total_tokens":3}}`, { status: 200 })],
    ["wrong dimensions", () => Response.json({ object: "list", model: SYNTHETIC_SEMANTIC_MODEL.modelId, data: [{ object: "embedding", index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 3, total_tokens: 3 } })],
    ["model mismatch", () => Response.json({ object: "list", model: "someone/else", data: [{ object: "embedding", index: 0, embedding: syntheticEmbed(KNOWN_GAP_QUERY) }], usage: { prompt_tokens: 3, total_tokens: 3 } })],
  ];

  for (const [label, respond] of failures) {
    it(`${label}: query resolution returns null and retrieval equals lexical V2 exactly`, async () => {
      const db = openDb();
      seedKnownGap(db);
      await indexChatSynthetically(db, 1);
      process.env.OPENROUTER_API_KEY = "test-dummy-key-not-real";
      globalThis.fetch = (async () => respond()) as unknown as typeof fetch;
      try {
        const resolved = await resolveEpisodicSemanticQuery({
      contentRoute: "safe",
          query: KNOWN_GAP_QUERY,
          runtime: syntheticRuntime(),
          embed: (inputs, model, purpose) => openRouterEpisodicEmbedder(inputs, model, purpose),
        });
        assert.equal(resolved.query, null, `${label} → ${resolved.reason}`);
        const base: GetEpisodicMemoryForPromptInput = { chatId: 1, currentTurn: 200, currentUserMessage: KNOWN_GAP_QUERY };
        assert.deepEqual(
          comparable(getEpisodicMemoryForPrompt(db, { ...base, semanticQuery: resolved.query }, env)),
          comparable(getEpisodicMemoryForPrompt(db, base, env))
        );
      } finally {
        delete process.env.OPENROUTER_API_KEY;
        db.close();
      }
    });
  }

  it("missing key: query resolution returns null without any HTTP", async () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const resolved = await resolveEpisodicSemanticQuery({
      contentRoute: "safe",
      query: KNOWN_GAP_QUERY,
      runtime: syntheticRuntime(),
      embed: openRouterEpisodicEmbedder,
    });
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    assert.equal(resolved.query, null);
    assert.equal(resolved.reason, "provider_error");
  });

  it("missing/empty index: semantic query present but zero vectors → exact lexical V2 budgets and output", async () => {
    const db = openDb();
    seedKnownGap(db);
    const base: GetEpisodicMemoryForPromptInput = { chatId: 1, currentTurn: 200, currentUserMessage: KNOWN_GAP_QUERY };
    const withSemantic = { ...base, semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY) };
    assert.deepEqual(comparable(getEpisodicMemoryForPrompt(db, withSemantic, env)), comparable(getEpisodicMemoryForPrompt(db, base, env)));
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, withSemantic, env);
    const lexical = fetchEpisodicMemoryCandidatesForDebug(db, base, env);
    assert.deepEqual(pre.rows.map((r) => r.id), lexical.rows.map((r) => r.id));
    db.close();
  });

  it("DB sidecar failure (malformed sidecar table) → lane_error and exact lexical V2", async () => {
    const db = openDb();
    seedKnownGap(db);
    db.exec(`CREATE TABLE ${EPISODIC_FACT_EMBEDDINGS_TABLE} (fact_id INTEGER, chat_id INTEGER)`);
    const base: GetEpisodicMemoryForPromptInput = { chatId: 1, currentTurn: 200, currentUserMessage: KNOWN_GAP_QUERY };
    const withSemantic = { ...base, semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY) };
    assert.equal(fetchEpisodicMemoryCandidatesForDebug(db, withSemantic, env).stats.semantic?.skippedReason, "lane_error");
    assert.deepEqual(comparable(getEpisodicMemoryForPrompt(db, withSemantic, env)), comparable(getEpisodicMemoryForPrompt(db, base, env)));
    db.close();
  });

  it("partial batch failure: one invalid vector in an index batch writes nothing", async () => {
    const db = openDb();
    for (let i = 0; i < 5; i++) {
      insertFact(db, { turn: 10 + i, subject: `storm${i}`, text: `${i}번째 폭풍우 밤에 둘은 동굴로 피신했다.` });
    }
    const job = await runEpisodicSemanticIndexJob({
      db,
      chatId: 1,
      runtime: syntheticRuntime(),
      embed: async (texts) => texts.map((t, i) => (i === 3 ? syntheticEmbed(t).map(() => Number.NaN) : syntheticEmbed(t))),
    });
    assert.equal(job.status, "invalid_batch");
    assert.equal(vectorCount(db), 0);
    db.close();
  });

  it("corrupt stored vector bytes are skipped (decode failure), never compared", async () => {
    const db = openDb();
    const answerId = seedKnownGap(db);
    await indexChatSynthetically(db, 1);
    db.prepare(`UPDATE ${EPISODIC_FACT_EMBEDDINGS_TABLE} SET embedding = unhex(?) WHERE fact_id = ?`).run("00ff", answerId);
    const input = { chatId: 1, currentTurn: 200, currentUserMessage: KNOWN_GAP_QUERY, semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY) };
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, input, env);
    assert.equal(pre.stats.semantic?.decodeFailures, 1);
    assert.equal(pre.rows.some((r) => r.id === answerId), false);
    db.close();
  });
});

describe("correction invariants", () => {
  const OLD_TEXT = "리셋 이전에 둘은 비밀 창고에서 폭풍우를 피했다.";
  const NEW_TEXT = "리셋 이후에 둘은 폭풍우 밤 동굴로 피신했다.";

  function seedAcrossBoundary(db: Database.Database): { oldId: number; newId: number } {
    const oldId = insertFact(db, { turn: 5, subject: "oldstorm", text: OLD_TEXT, sourceUserMessageId: 5 });
    const newId = insertFact(db, { turn: 12, subject: "newstorm", text: NEW_TEXT, sourceUserMessageId: 9 });
    db.prepare("UPDATE chat_memories SET memory_reset_after_message_id=5 WHERE chat_id=1").run();
    return { oldId, newId };
  }

  it("OUT_OF_SCOPE_MEMORY_IS_NOT_SENT_TO_EMBEDDING_PROVIDER: pre-boundary fact never reaches the embedder", async () => {
    const db = openDb();
    const { oldId, newId } = seedAcrossBoundary(db);
    const sent: string[] = [];
    const job = await runEpisodicSemanticIndexJob({
      db,
      chatId: 1,
      runtime: syntheticRuntime(),
      embed: async (texts) => {
        sent.push(...texts);
        return texts.map(syntheticEmbed);
      },
    });
    assert.equal(job.written, 1);
    assert.deepEqual(sent, [NEW_TEXT]);
    const indexed = (db.prepare(`SELECT fact_id FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}`).all() as Array<{ fact_id: number }>).map((r) => r.fact_id);
    assert.deepEqual(indexed, [newId]);
    assert.equal(indexed.includes(oldId), false);
    db.close();
  });

  it("pre-boundary fact is absent from every provider fetch body (real transport, stubbed fetch)", async () => {
    const db = openDb();
    seedAcrossBoundary(db);
    const bodies: string[] = [];
    process.env.OPENROUTER_API_KEY = "test-dummy-key-not-real";
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      bodies.push(body);
      const parsed = JSON.parse(body) as { model: string; input: string[] };
      return Response.json({
        object: "list",
        model: parsed.model,
        data: parsed.input.map((t, index) => ({ object: "embedding", index, embedding: syntheticEmbed(t) })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    }) as typeof fetch;
    try {
      const job = await runEpisodicSemanticIndexJob({ db, chatId: 1, runtime: syntheticRuntime(), embed: openRouterEpisodicEmbedder });
      assert.equal(job.written, 1);
      assert.equal(bodies.length, 1);
      assert.equal(bodies.filter((b) => b.includes(OLD_TEXT)).length, 0, "old fact transmissions = 0");
      assert.equal(bodies.filter((b) => b.includes(NEW_TEXT)).length, 1);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
      db.close();
    }
  });

  it("adult/unstamped/unrecallable facts are never sent; only stamped safe, guard-valid facts are", async () => {
    const db = openDb();
    const safeId = insertFact(db, { turn: 10, subject: "safe", text: "폭풍우 밤에 둘은 동굴로 피신했다." });
    insertFact(db, { turn: 11, subject: "adult", text: "성인 장면에서 둘은 밤을 함께 보냈다.", metadata: '{"memory_evidence_type":"explicit_scene_event","content_route":"nsfw"}' });
    insertFact(db, { turn: 12, subject: "legacy", text: "레거시 기록에서 둘은 폭풍우를 피했다.", metadata: '{"memory_evidence_type":"explicit_scene_event"}' });
    insertFact(db, { turn: 13, subject: "notsentence", text: "채우기 기록 1번 항해 일지 바다 파도" });
    const pending = listEpisodicFactsForSemanticIndexing(db, { chatId: 1, model: SYNTHETIC_SEMANTIC_MODEL, limit: 16 });
    assert.deepEqual(pending.map((p) => p.factId), [safeId]);
    db.close();
  });

  it("adult turn never embeds its query; empty in-scope index skips the query call (0 embed calls)", async () => {
    const db = openDb();
    seedKnownGap(db);
    const counter = countingSyntheticEmbedder();
    const scope = { chatId: 1, currentTurn: 200 };
    const probe = (model: typeof SYNTHETIC_SEMANTIC_MODEL) => hasEpisodicSemanticIndexInScope(db, scope, model, env);
    const adult = await resolveEpisodicSemanticQuery({ query: KNOWN_GAP_QUERY, contentRoute: "nsfw", usableIndex: probe, runtime: syntheticRuntime(), embed: counter.embed });
    assert.deepEqual(adult, { query: null, reason: "adult_scope_excluded" });
    const noIndex = await resolveEpisodicSemanticQuery({ query: KNOWN_GAP_QUERY, contentRoute: "safe", usableIndex: probe, runtime: syntheticRuntime(), embed: counter.embed });
    assert.deepEqual(noIndex, { query: null, reason: "no_usable_index" });
    assert.equal(counter.calls(), 0, "0 provider calls before any usable index exists");
    await indexChatSynthetically(db, 1);
    const callsAfterIndex = counter.calls();
    const ready = await resolveEpisodicSemanticQuery({ query: KNOWN_GAP_QUERY, contentRoute: "safe", usableIndex: probe, runtime: syntheticRuntime(), embed: counter.embed });
    assert.equal(ready.reason, "ok");
    assert.equal(counter.calls(), callsAfterIndex + 1);
    db.close();
  });

  it("full canonical content hash: a suffix-only change beyond the provider bound invalidates the vector", () => {
    const db = openDb();
    const prefix = "폭풍우 밤의 긴 기록이 이어졌다 ".repeat(40).slice(0, EPISODIC_SEMANTIC_MAX_FACT_CHARS);
    const textA = `${prefix} 결말은 하나였다.`;
    const textB = `${prefix} 결말은 둘이었다.`;
    const fullA = episodicFactSemanticText({ fact_text: textA })!;
    const fullB = episodicFactSemanticText({ fact_text: textB })!;
    assert.equal(episodicFactEmbeddingInput(fullA), episodicFactEmbeddingInput(fullB), "provider inputs are byte-identical");
    assert.equal(
      episodicFactContentHash(episodicFactEmbeddingInput(fullA)),
      episodicFactContentHash(episodicFactEmbeddingInput(fullB)),
      "a truncated-input hash (reviewed head) would have treated B's old vector as valid"
    );
    assert.notEqual(episodicFactContentHash(fullA), episodicFactContentHash(fullB));

    const factId = insertFact(db, { turn: 10, subject: "longstorm", text: textA });
    const vector = normalizeEmbeddingVector(syntheticEmbed(textA), SYNTHETIC_SEMANTIC_MODEL.dimensions)!;
    assert.equal(
      upsertEpisodicFactEmbedding(db, { chatId: 1, factId, model: SYNTHETIC_SEMANTIC_MODEL, contentHash: episodicFactContentHash(fullA), vector }),
      "written"
    );
    db.prepare("UPDATE episodic_memory_facts SET fact_text=? WHERE id=?").run(textB, factId);
    const query = { model: SYNTHETIC_SEMANTIC_MODEL, vector };
    const pre = fetchEpisodicMemoryCandidatesForDebug(db, { chatId: 1, currentTurn: 60, currentUserMessage: "폭풍우 밤", semanticQuery: query }, env);
    assert.equal(pre.stats.semantic?.staleContentHashSkipped, 1, "old vector judged stale on full-text hash");
    assert.equal(pre.semanticSimilarityById.has(factId), false);
    assert.equal(
      upsertEpisodicFactEmbedding(db, { chatId: 1, factId, model: SYNTHETIC_SEMANTIC_MODEL, contentHash: episodicFactContentHash(fullA), vector }),
      "content_changed",
      "a late write for A is rejected against canonical B"
    );
    db.close();
  });

  it("semantic accounting: overlap IDs cost no slot, novel IDs fill unused capacity, lexical V2 lanes unchanged", async () => {
    const db = openDb();
    const overlapId = insertFact(db, { turn: 190, subject: "stormnight", text: "천둥 치던 밤 사용자는 무서워했다고 명시했다." });
    const novelId = seedKnownGap(db);
    await indexChatSynthetically(db, 1);
    const base: GetEpisodicMemoryForPromptInput = { chatId: 1, currentTurn: 200, currentUserMessage: KNOWN_GAP_QUERY };
    const lexical = fetchEpisodicMemoryCandidatesForDebug(db, base, env);
    const semantic = fetchEpisodicMemoryCandidatesForDebug(db, { ...base, semanticQuery: await syntheticQuery(KNOWN_GAP_QUERY) }, env);
    assert.deepEqual(semantic.stats.laneCounts.recent, lexical.stats.laneCounts.recent);
    assert.deepEqual(semantic.stats.laneCounts.relevance, lexical.stats.laneCounts.relevance);
    assert.deepEqual(semantic.stats.laneCounts.milestone_critical, lexical.stats.laneCounts.milestone_critical);
    assert.deepEqual(semantic.stats.laneCounts.milestone_important, lexical.stats.laneCounts.milestone_important);
    const lexicalIds = lexical.rows.map((r) => r.id);
    assert.deepEqual(semantic.rows.map((r) => r.id).filter((id) => lexicalIds.includes(id)), lexicalIds, "every lexical candidate kept, same order");
    assert.equal(lexicalIds.includes(overlapId), true);
    assert.equal(lexicalIds.includes(novelId), false);
    const s = semantic.stats.semantic!;
    assert.deepEqual({ admitted: s.admitted, novel: s.novel, overlap: s.overlap, added: s.added, droppedNoCapacity: s.droppedNoCapacity }, { admitted: 2, novel: 1, overlap: 1, added: 1, droppedNoCapacity: 0 });
    assert.deepEqual(semantic.laneById.get(overlapId), ["recent", "semantic"]);
    assert.deepEqual(semantic.laneById.get(novelId), ["semantic"]);
    assert.equal(semantic.rows.length, lexical.rows.length + 1);
    db.close();
  });

  it("full lexical capacity (100 unique): novel semantic IDs are dropped, not swapped in (no replacement policy)", async () => {
    const db = openDb();
    const novelId = insertFact(db, { turn: 10, subject: "thunderfear", value: "quietdread", text: KNOWN_GAP_FACT });
    for (let i = 0; i < 20; i++) insertFact(db, { turn: 30 + i, category: "relationship", subject: `crit${i}`, attribute: "scene_event", importance: "critical", text: `북쪽 탑 ${i}층에서의 맹세가 완료되었다.` });
    for (let i = 0; i < 20; i++) insertFact(db, { turn: 60 + i, category: "relationship", subject: `imp${i}`, attribute: "scene_event", importance: "important", text: `남쪽 탑 ${i}층에서의 약조가 완료되었다.` });
    for (let i = 0; i < 30; i++) insertFact(db, { turn: 100 + i, subject: `lamp${i}`, text: `등잔 기록 ${i}번이 남겨졌다고 명시했다.` });
    saturate(db, 60, 300);
    await indexChatSynthetically(db, 1);
    const query = `등잔 ${KNOWN_GAP_QUERY}`;
    const base: GetEpisodicMemoryForPromptInput = { chatId: 1, currentTurn: 400, currentUserMessage: query };
    const lexical = fetchEpisodicMemoryCandidatesForDebug(db, base, env);
    assert.equal(lexical.rows.length, 100, "baseline lexical unique candidate set is full");
    const semantic = fetchEpisodicMemoryCandidatesForDebug(db, { ...base, semanticQuery: await syntheticQuery(query) }, env);
    assert.deepEqual(semantic.rows.map((r) => r.id), lexical.rows.map((r) => r.id), "exact lexical V2 candidate set preserved");
    assert.equal(semantic.rows.some((r) => r.id === novelId), false);
    assert.ok(semantic.stats.semantic!.novel >= 1);
    assert.equal(semantic.stats.semantic!.added, 0);
    assert.equal(semantic.stats.semantic!.droppedNoCapacity, semantic.stats.semantic!.novel);
    db.close();
  });
});

describe("cleanup owners and production wiring", () => {
  it("character deletion helper wipes vectors of every chat of that character only", () => {
    const db = openDb();
    ensureEpisodicFactEmbeddingSchema(db);
    db.exec("CREATE TABLE chats (id INTEGER PRIMARY KEY, character_id INTEGER)");
    db.exec("INSERT INTO chats (id, character_id) VALUES (1, 7), (2, 7), (3, 8)");
    const hex = encodeEmbeddingHex(new Float32Array([1, 0]));
    for (const chatId of [1, 2, 3]) {
      db.prepare(`INSERT INTO ${EPISODIC_FACT_EMBEDDINGS_TABLE} (fact_id, chat_id, model_id, dimensions, content_hash, embedding) VALUES (?, ?, 'm', 2, 'h', unhex(?))`).run(chatId, chatId, hex);
    }
    deleteEpisodicFactEmbeddingsForCharacterChats(db, 7);
    const left = db.prepare(`SELECT chat_id FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}`).all() as Array<{ chat_id: number }>;
    assert.deepEqual(left.map((r) => r.chat_id), [3]);
    db.close();
  });

  it("route, post-turn owner, and cleanup owners call the canonical semantic owners", () => {
    const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
    const route = read("src/app/api/chat/route.ts");
    assert.match(route, /const episodicSemantic = await resolveEpisodicSemanticQuery\(\{\s*query: policyUserMessage,\s*contentRoute: effectiveAdultRp \? "nsfw" : "safe",\s*usableIndex: \(model\) => hasEpisodicSemanticIndexInScope\(db, episodicRetrievalScope, model\),\s*\}\);/);
    assert.match(route, /semanticQuery: episodicSemantic\.query,/);
    assert.match(read("src/lib/memory/memory-manager.ts"), /contentRoute: opts\.route,/);
    const manager = read("src/lib/memory/memory-manager.ts");
    const reconcileAt = manager.indexOf("reconcileSharedEpisodicFactsForTurn(getDb()");
    const indexAt = manager.indexOf("await runEpisodicSemanticIndexJob({ db: getDb(), chatId: opts.chatId });");
    assert.ok(reconcileAt > 0 && indexAt > reconcileAt, "index job runs after the committed canonical reconcile");
    assert.match(read("src/lib/chatOwnedDataCleanup.ts"), /deleteEpisodicFactEmbeddingsForChat\(db, chatId\);/);
    assert.match(read("src/lib/deleteCharacter.ts"), /deleteEpisodicFactEmbeddingsForCharacterChats\(db, characterId\);/);
    const facts = read("src/lib/episodicMemoryFacts.ts");
    assert.doesNotMatch(facts, /fetch\(|callOpenRouterEmbeddings|memory-episodic-semantic-jobs/, "retrieval owner never embeds or performs HTTP");
  });
});

describe("runtime gate and encoding", () => {
  it("provisional configs cannot activate, even with the flag on", () => {
    assert.deepEqual(resolveEpisodicSemanticRuntime({} as NodeJS.ProcessEnv), { enabled: false, reason: "flag_off" });
    for (const key of Object.keys(EPISODIC_SEMANTIC_MODEL_CANDIDATES)) {
      assert.deepEqual(
        resolveEpisodicSemanticRuntime({ EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "1", EPISODIC_SEMANTIC_MODEL: key } as NodeJS.ProcessEnv),
        { enabled: false, reason: "config_provisional_live_benchmark_pending" }
      );
    }
    assert.deepEqual(
      resolveEpisodicSemanticRuntime({ EPISODIC_SEMANTIC_DISCOVERY_ENABLED: "1", EPISODIC_SEMANTIC_MODEL: "constructor" } as NodeJS.ProcessEnv),
      { enabled: false, reason: "unknown_model" }
    );
  });

  it("disabled runtime: route resolver and index job do nothing", async () => {
    const counter = countingSyntheticEmbedder();
    const db = openDb();
    seedKnownGap(db);
    const q = await resolveEpisodicSemanticQuery({ query: KNOWN_GAP_QUERY, contentRoute: "safe", env: {} as NodeJS.ProcessEnv, embed: counter.embed });
    const job = await runEpisodicSemanticIndexJob({ db, chatId: 1, env: {} as NodeJS.ProcessEnv, embed: counter.embed });
    assert.deepEqual(q, { query: null, reason: "disabled" });
    assert.equal(job.status, "disabled");
    assert.equal(counter.calls(), 0);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(EPISODIC_FACT_EMBEDDINGS_TABLE), undefined, "no sidecar created while disabled");
    db.close();
  });

  it("vectors round-trip exactly through the driver via text-bound unhex (no binary binding)", () => {
    const db = openDb();
    ensureEpisodicFactEmbeddingSchema(db);
    const v = normalizeEmbeddingVector(syntheticEmbed(KNOWN_GAP_FACT), SYNTHETIC_SEMANTIC_MODEL.dimensions)!;
    db.prepare(`INSERT INTO ${EPISODIC_FACT_EMBEDDINGS_TABLE} (fact_id, chat_id, model_id, dimensions, content_hash, embedding) VALUES (1, 1, 'm', ?, 'h', unhex(?))`).run(v.length, encodeEmbeddingHex(v));
    const row = db.prepare(`SELECT embedding, length(embedding) AS n FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}`).get() as { embedding: Uint8Array; n: number };
    assert.equal(row.n, v.length * 4);
    const back = new Float32Array(Uint8Array.from(row.embedding).buffer);
    assert.deepEqual(Array.from(back), Array.from(v));
    db.close();
  });

  it("decoder accepts both driver BLOB shapes: Buffer from .get(), ArrayBuffer from .all()", () => {
    const db = openDb();
    ensureEpisodicFactEmbeddingSchema(db);
    const v = normalizeEmbeddingVector(syntheticEmbed(KNOWN_GAP_FACT), SYNTHETIC_SEMANTIC_MODEL.dimensions)!;
    db.prepare(`INSERT INTO ${EPISODIC_FACT_EMBEDDINGS_TABLE} (fact_id, chat_id, model_id, dimensions, content_hash, embedding) VALUES (1, 1, 'm', ?, 'h', unhex(?))`).run(v.length, encodeEmbeddingHex(v));
    const viaGet = (db.prepare(`SELECT embedding FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}`).get() as { embedding: unknown }).embedding;
    const viaAll = (db.prepare(`SELECT embedding FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}`).all() as Array<{ embedding: unknown }>)[0]!.embedding;
    assert.ok(viaGet instanceof Uint8Array);
    assert.ok(viaAll instanceof ArrayBuffer);
    assert.deepEqual(Array.from(decodeEmbeddingBlob(viaGet, v.length)!), Array.from(v));
    assert.deepEqual(Array.from(decodeEmbeddingBlob(viaAll, v.length)!), Array.from(v));
    assert.equal(decodeEmbeddingBlob("not-bytes", v.length), null);
    assert.equal(decodeEmbeddingBlob(new ArrayBuffer(8), v.length), null);
    db.close();
  });
});
