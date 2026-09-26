/**
 * Manual performance benchmark for the V1 in-process semantic scan.
 * Provider-free: vectors are seeded pseudo-random unit vectors written through
 * the canonical sidecar upsert. Measures the real retrieval owners with the
 * semantic lane OFF vs ON at synthetic per-chat fact counts.
 *
 *   node --expose-gc --conditions=react-server --import tsx scripts/benchmark-episodic-semantic-scan.ts
 */
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import {
  ensureEpisodicMemoryFactsTable,
  fetchEpisodicMemoryCandidatesForDebug,
  getEpisodicMemoryForPrompt,
} from "@/lib/episodicMemoryFacts";
import {
  decodeEmbeddingBlob,
  dotProduct,
  EPISODIC_FACT_EMBEDDINGS_TABLE,
  episodicFactContentHash,
  episodicFactSemanticText,
  upsertEpisodicFactEmbedding,
} from "@/lib/memory/memory-episodic-semantic-index";
import {
  EPISODIC_SEMANTIC_MODEL_CANDIDATES,
  type EpisodicSemanticModelConfig,
} from "@/lib/memory/memory-episodic-semantic-config";

const env = { MEMORY_FEATURE_ENABLED: "1", EPISODIC_MEMORY_RECALL_ENABLED: "1" } as NodeJS.ProcessEnv;
const SIZES: Array<[string, number]> = [
  ["small", 30],
  ["normal", 150],
  ["T300-class", 900],
  ["T1000-class", 3000],
  ["bounded-stress", 10000],
];
const ITERATIONS = 15;
const QUERY = "폭풍우 속 옛 공포가 되살아나는 밤";

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
}

function unitVector(dims: number, next: () => number): Float32Array {
  const v = new Float32Array(dims);
  let n = 0;
  for (let i = 0; i < dims; i++) {
    v[i] = next();
    n += v[i]! * v[i]!;
  }
  const inv = 1 / Math.sqrt(n);
  for (let i = 0; i < dims; i++) v[i]! *= inv;
  return v;
}

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

function time(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function gc(): void {
  (globalThis as { gc?: () => void }).gc?.();
}

function dbBytes(db: Database.Database): number {
  const pages = (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
  const size = (db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size;
  return pages * size;
}

function run(model: EpisodicSemanticModelConfig, label: string, facts: number): Record<string, unknown> {
  const db = new Database(":memory:");
  ensureEpisodicMemoryFactsTable(db);
  db.exec("CREATE TABLE chat_memories (chat_id INTEGER PRIMARY KEY, memory_reset_after_message_id INTEGER, memory_epoch INTEGER NOT NULL DEFAULT 0)");
  db.prepare("INSERT INTO chat_memories (chat_id) VALUES (1)").run();
  const insert = db.prepare(
    `INSERT INTO episodic_memory_facts (chat_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (1, ?, 'setting', ?, 'note', ?, 'normal', ?, '{"memory_evidence_type":"explicit_scene_event"}')`
  );
  db.transaction(() => {
    for (let i = 0; i < facts; i++) {
      insert.run(1 + Math.floor(i / 3), `fact${i}`, `v${i}`, `합성 사실 기록 ${i}번이 남겨졌다고 명시했다.`);
    }
  })();
  const bytesBefore = dbBytes(db);
  const next = rng(facts * 7 + model.dimensions);
  const rows = db.prepare("SELECT id, fact_text FROM episodic_memory_facts WHERE chat_id=1").all() as Array<{ id: number; fact_text: string }>;
  const indexMs = time(() =>
    db.transaction(() => {
      for (const row of rows) {
        const text = episodicFactSemanticText(row)!;
        upsertEpisodicFactEmbedding(db, { chatId: 1, factId: row.id, model, contentHash: episodicFactContentHash(text), vector: unitVector(model.dimensions, next) });
      }
    })()
  );
  const bytesAfter = dbBytes(db);
  const sidecarPayload = (db.prepare(`SELECT SUM(length(embedding)) AS b FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}`).get() as { b: number }).b;

  const currentTurn = Math.floor(facts / 3) + 20;
  const query = { model, vector: unitVector(model.dimensions, next) };
  const off = { chatId: 1, currentTurn, currentUserMessage: QUERY };
  const on = { ...off, semanticQuery: query };

  const loadMs: number[] = [];
  const decodeMs: number[] = [];
  const simMs: number[] = [];
  const offDiscovery: number[] = [];
  const onDiscovery: number[] = [];
  const offRetrieval: number[] = [];
  const onRetrieval: number[] = [];
  let heapDelta = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    let blobs: Array<{ embedding: unknown }> = [];
    loadMs.push(time(() => {
      blobs = db.prepare(`SELECT embedding FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE} WHERE chat_id=1 AND model_id=? AND dimensions=?`).all(model.modelId, model.dimensions) as Array<{ embedding: unknown }>;
    }));
    let vectors: Float32Array[] = [];
    decodeMs.push(time(() => { vectors = blobs.map((b) => decodeEmbeddingBlob(b.embedding, model.dimensions)!); }));
    simMs.push(time(() => { for (const v of vectors) dotProduct(query.vector, v); }));
    offDiscovery.push(time(() => fetchEpisodicMemoryCandidatesForDebug(db, off, env)));
    onDiscovery.push(time(() => fetchEpisodicMemoryCandidatesForDebug(db, on, env)));
    offRetrieval.push(time(() => getEpisodicMemoryForPrompt(db, off, env)));
    gc();
    const heap0 = process.memoryUsage().heapUsed;
    onRetrieval.push(time(() => getEpisodicMemoryForPrompt(db, on, env)));
    heapDelta = Math.max(heapDelta, process.memoryUsage().heapUsed - heap0);
  }
  db.close();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    model: model.modelId,
    dims: model.dimensions,
    size: label,
    facts,
    sidecarBytesPerFact: r2(sidecarPayload / facts),
    dbBytesDeltaPerFact: r2((bytesAfter - bytesBefore) / facts),
    indexWriteMsTotal: r2(indexMs),
    loadMsP50: r2(pct(loadMs, 0.5)),
    decodeMsP50: r2(pct(decodeMs, 0.5)),
    similarityMsP50: r2(pct(simMs, 0.5)),
    discoveryOffMsP50: r2(pct(offDiscovery, 0.5)),
    discoveryOnMsP50: r2(pct(onDiscovery, 0.5)),
    retrievalOffMsP50: r2(pct(offRetrieval, 0.5)),
    retrievalOffMsP95: r2(pct(offRetrieval, 0.95)),
    retrievalOnMsP50: r2(pct(onRetrieval, 0.5)),
    retrievalOnMsP95: r2(pct(onRetrieval, 0.95)),
    onRetrievalHeapDeltaMaxMB: r2(heapDelta / 1024 / 1024),
  };
}

const gcAvailable = typeof (globalThis as { gc?: unknown }).gc === "function";
console.log(`# node ${process.version} gc=${gcAvailable} iterations=${ITERATIONS}`);
for (const model of Object.values(EPISODIC_SEMANTIC_MODEL_CANDIDATES)) {
  for (const [label, facts] of SIZES) {
    console.log(JSON.stringify(run(model, label, facts)));
  }
}
