/**
 * One-time Persona Secret compiler v1 → v2 migration (dry-run by default).
 *
 * Recompiles stored `user_personas.secret_description` with compiler v2 so
 * VISUAL/INVESTIGATION rules get enabled=1. Does NOT touch evidence, knowledge,
 * or chat_persona_secret_reveals.
 *
 * Usage:
 *   node --import tsx scripts/migrate-persona-secret-compiler-v2.ts
 *   node --import tsx scripts/migrate-persona-secret-compiler-v2.ts --execute
 *
 * Backup the database before --execute.
 */
import { getDb } from "@/lib/db";
import { migrateAllPersonaSecretCompilerV2 } from "@/lib/personaSecretCompilerV2Migration";

const EXECUTE = process.argv.includes("--execute");

const batch = migrateAllPersonaSecretCompilerV2({ execute: EXECUTE });

console.log(
  JSON.stringify(
    {
      mode: EXECUTE ? "execute" : "dry_run",
      summary: batch.summary,
      candidates: batch.candidates.map((c) => ({
        personaId: c.personaId,
        userId: c.userId,
        sourceHash: c.sourceHash.slice(0, 12),
        v1DormantRules: c.v1DormantRules,
        hasV1SuccessRun: c.hasV1SuccessRun,
        hasV2SuccessRun: c.hasV2SuccessRun,
      })),
      results: batch.results,
    },
    null,
    2
  )
);

if (!EXECUTE) {
  console.error(
    "[migrate-persona-secret-compiler-v2] dry-run only — pass --execute to write (backup DB first)"
  );
}

const failed = batch.results.filter((r) => r.status === "failed");
if (failed.length > 0) process.exitCode = 1;
