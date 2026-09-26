/**
 * Derived, disposable, rebuildable semantic sidecar for episodic facts.
 *
 * `episodic_memory_facts` stays the only canonical truth. A sidecar row is
 * never recall evidence on its own: the candidate-discovery owner re-resolves
 * every hit against the canonical row under the current candidate scope and
 * rejects vectors whose content hash no longer matches the canonical text.
 * Dropping this whole table leaves exact lexical Retrieval V2 behavior.
 *
 * Driver constraint (libsql 0.5.x): binding ANY binary parameter
 * (Buffer / Uint8Array / ArrayBuffer) aborts the process with an uncatchable
 * native panic. Vectors are therefore written as a hex TEXT parameter decoded
 * by core SQLite `unhex(?)`; BLOB reads are safe and return Uint8Array.
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { sanitizeRecalledMemoryFactText } from "@/lib/runtimePromptContaminationGuard";
import {
  EPISODIC_SEMANTIC_MAX_FACT_CHARS,
  type EpisodicSemanticModelConfig,
} from "./memory-episodic-semantic-config";

export const EPISODIC_FACT_EMBEDDINGS_TABLE = "episodic_memory_fact_embeddings";

export type EpisodicSemanticQuery = {
  model: EpisodicSemanticModelConfig;
  /** Unit-normalized query vector (length === model.dimensions). */
  vector: Float32Array;
};

export function ensureEpisodicFactEmbeddingSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${EPISODIC_FACT_EMBEDDINGS_TABLE} (
      fact_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      model_id TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      embedding BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (fact_id, model_id, dimensions)
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_fact_embeddings_chat_model
      ON ${EPISODIC_FACT_EMBEDDINGS_TABLE}(chat_id, model_id, dimensions);
  `);
}

/**
 * FULL sanitized canonical fact_text — the only content identity. Staleness is
 * always judged on this full text, never on the bounded provider input.
 */
export function episodicFactSemanticText(fact: { fact_text: string }): string | null {
  const text = sanitizeRecalledMemoryFactText(fact.fact_text).trim();
  return text || null;
}

/** Bounded text actually sent to the embeddings provider for a fact. */
export function episodicFactEmbeddingInput(fullSemanticText: string): string {
  return fullSemanticText.slice(0, EPISODIC_SEMANTIC_MAX_FACT_CHARS);
}

export function episodicFactContentHash(fullSemanticText: string): string {
  return createHash("sha256").update(fullSemanticText, "utf8").digest("hex");
}

export function episodicFactEmbeddingSidecarExists(db: Database.Database): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?")
      .get(EPISODIC_FACT_EMBEDDINGS_TABLE)
  );
}

/** Validates and unit-normalizes a provider vector; null when unusable. */
export function normalizeEmbeddingVector(
  values: readonly unknown[],
  dimensions: number
): Float32Array | null {
  if (values.length !== dimensions || dimensions <= 0) return null;
  const out = new Float32Array(dimensions);
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    const v = values[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[i] = v;
    norm += v * v;
  }
  if (!(norm > 0) || !Number.isFinite(norm)) return null;
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < dimensions; i++) out[i] *= inv;
  return out;
}

export function encodeEmbeddingHex(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("hex");
}

/**
 * Decodes a stored BLOB; null on wrong type/length or non-finite content.
 * libsql returns the same BLOB column as a Buffer from `.get()` but as an
 * ArrayBuffer from `.all()`/`.iterate()`, so both shapes are accepted.
 */
export function decodeEmbeddingBlob(raw: unknown, dimensions: number): Float32Array | null {
  let vector: Float32Array;
  if (raw instanceof ArrayBuffer) {
    // `.all()` materializes a fresh ArrayBuffer per row — view it without copying.
    if (raw.byteLength !== dimensions * 4) return null;
    vector = new Float32Array(raw);
  } else if (raw instanceof Uint8Array) {
    if (raw.byteLength !== dimensions * 4) return null;
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    vector = new Float32Array(copy.buffer);
  } else {
    return null;
  }
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i]!)) return null;
  }
  return vector;
}

export function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

export type EpisodicEmbeddingWriteResult = "written" | "fact_missing" | "content_changed";

/**
 * Idempotent upsert keyed by (fact_id, model_id, dimensions). Re-reads the
 * canonical row first: a result computed for text that has since been deleted
 * or changed is dropped instead of written.
 */
export function upsertEpisodicFactEmbedding(
  db: Database.Database,
  input: {
    chatId: number;
    factId: number;
    model: EpisodicSemanticModelConfig;
    contentHash: string;
    vector: Float32Array;
  }
): EpisodicEmbeddingWriteResult {
  ensureEpisodicFactEmbeddingSchema(db);
  const canonical = db
    .prepare("SELECT fact_text FROM episodic_memory_facts WHERE id=? AND chat_id=?")
    .get(input.factId, input.chatId) as { fact_text: string } | undefined;
  if (!canonical) return "fact_missing";
  const text = episodicFactSemanticText(canonical);
  if (!text || episodicFactContentHash(text) !== input.contentHash) return "content_changed";
  if (input.vector.length !== input.model.dimensions) return "content_changed";
  db.prepare(
    `INSERT INTO ${EPISODIC_FACT_EMBEDDINGS_TABLE}
       (fact_id, chat_id, model_id, dimensions, content_hash, embedding)
     VALUES (?, ?, ?, ?, ?, unhex(?))
     ON CONFLICT(fact_id, model_id, dimensions) DO UPDATE SET
       chat_id=excluded.chat_id,
       content_hash=excluded.content_hash,
       embedding=excluded.embedding,
       updated_at=datetime('now')`
  ).run(
    input.factId,
    input.chatId,
    input.model.modelId,
    input.model.dimensions,
    input.contentHash,
    encodeEmbeddingHex(input.vector)
  );
  return "written";
}

/** Canonical orphan cleanup: vectors whose canonical fact row no longer exists in the chat. */
export function pruneOrphanEpisodicFactEmbeddings(db: Database.Database, chatId: number): number {
  if (!episodicFactEmbeddingSidecarExists(db)) return 0;
  const result = db
    .prepare(
      `DELETE FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}
       WHERE chat_id = ?
         AND fact_id NOT IN (SELECT id FROM episodic_memory_facts WHERE chat_id = ?)`
    )
    .run(chatId, chatId);
  return Number(result.changes) || 0;
}

/**
 * Whole-chat derived-data wipe; caller owns the surrounding transaction.
 * Cleanup only — a missing sidecar (feature never enabled) is a no-op, never created.
 */
export function deleteEpisodicFactEmbeddingsForChat(db: Database.Database, chatId: number): void {
  if (!episodicFactEmbeddingSidecarExists(db)) return;
  db.prepare(`DELETE FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE} WHERE chat_id=?`).run(chatId);
}

/** Character-deletion wipe across all of the character's chats; missing sidecar is a no-op. */
export function deleteEpisodicFactEmbeddingsForCharacterChats(
  db: Database.Database,
  characterId: number
): void {
  if (!episodicFactEmbeddingSidecarExists(db)) return;
  db.prepare(
    `DELETE FROM ${EPISODIC_FACT_EMBEDDINGS_TABLE}
     WHERE chat_id IN (SELECT id FROM chats WHERE character_id=?)`
  ).run(characterId);
}
