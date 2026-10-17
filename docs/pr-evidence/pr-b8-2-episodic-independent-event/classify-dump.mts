/**
 * Prints the temporal nature the checked-out classifier gives every stored Episodic row of a
 * (read-only) snapshot, one row per line, so two checkouts can be diffed. Zero provider calls.
 *
 * Run from a checkout root so `@/` resolves to that checkout's src:
 *   node --import tsx classify-dump.mts <app.db>
 */
import Database from "better-sqlite3";
import { classifyEpisodicFactTemporalNature } from "@/lib/episodicMemoryTemporal";

const [dbPath] = process.argv.slice(2);
if (!dbPath) throw new Error("usage: classify-dump.mts <app.db>");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db
  .prepare(
    `SELECT id, source_turn, category, subject, attribute, value, fact_text, metadata,
            json_extract(metadata, '$.memory_evidence_type') AS evidence_type
       FROM episodic_memory_facts ORDER BY source_turn, id`
  )
  .all() as Array<Record<string, string | number | null> & { evidence_type: string | null }>;
for (const row of rows) {
  console.log(
    [
      `T${row.source_turn}`,
      row.evidence_type,
      classifyEpisodicFactTemporalNature(row),
      `${row.category}:${row.subject}:${row.attribute}`,
      row.fact_text,
    ].join("\t")
  );
}
