import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type { PersonaSecretRow } from "@/lib/personaSecretDiscoveryTypes";
import type {
  CompiledPersonaSecret,
  SecretStableDiff,
} from "@/lib/personaSecretCompilerTypes";

/** Empty source → successful zero-secret compile: all secrets inactive, rules disabled. */
export function applyEmptyPersonaSecretCompilation(opts: {
  personaId: number;
  sourceHash: string;
  db?: Database.Database;
}): { runId: string } {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  ensureCompilationRunsSchema(db);

  const runId = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE persona_secrets SET is_active=0, updated_at=datetime('now') WHERE persona_id=?`
    ).run(opts.personaId);
    db.prepare(
      `UPDATE persona_secret_discovery_rules SET enabled=0, updated_at=datetime('now')
       WHERE secret_id IN (SELECT id FROM persona_secrets WHERE persona_id=?)`
    ).run(opts.personaId);
    db.prepare(
      `DELETE FROM persona_secret_compilation_runs
       WHERE persona_id=? AND source_hash=? AND compiler_version=? AND status='success'`
    ).run(opts.personaId, opts.sourceHash, PERSONA_SECRET_COMPILER_VERSION);
    db.prepare(
      `INSERT INTO persona_secret_compilation_runs (
         id, persona_id, source_hash, compiler_version, status, result_json, error_code
       ) VALUES (?,?,?,?,?,?,NULL)`
    ).run(
      runId,
      opts.personaId,
      opts.sourceHash,
      PERSONA_SECRET_COMPILER_VERSION,
      "success",
      JSON.stringify({
        schemaVersion: 1,
        compilerVersion: PERSONA_SECRET_COMPILER_VERSION,
        secrets: [],
        unresolvedFragments: [],
        warnings: ["empty_source"],
      })
    );
  });
  tx();
  return { runId };
}
import { PERSONA_SECRET_COMPILER_VERSION } from "@/lib/personaSecretCompilerCatalog";

function ensureCompilationRunsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS persona_secret_compilation_runs (
      id TEXT PRIMARY KEY,
      persona_id INTEGER NOT NULL,
      source_hash TEXT NOT NULL,
      compiler_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_persona_secret_compilation_runs_persona
      ON persona_secret_compilation_runs(persona_id, created_at);
  `);
}

function upsertDiscoveryRulesStable(
  db: Database.Database,
  secretId: string,
  compiled: CompiledPersonaSecret
): void {
  const incomingKeys = new Set(compiled.discoveryRules.map((r) => r.ruleKey));

  for (const rule of compiled.discoveryRules) {
    const conditions = {
      ...rule.conditions,
      aliases:
        rule.method === "DIRECT_DISCLOSURE"
          ? compiled.directDisclosureAliases
          : [],
      evidenceKinds: rule.evidenceKinds,
      dormant: rule.dormant,
      requires_first_person: true,
      requires_assertive_statement: true,
      compilerConfidence: compiled.confidence,
      needsReview: compiled.needsReview,
      compilerWarnings: compiled.warnings,
    };
    const existing = db
      .prepare(
        `SELECT id FROM persona_secret_discovery_rules WHERE secret_id=? AND rule_key=?`
      )
      .get(secretId, rule.ruleKey) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE persona_secret_discovery_rules
         SET method=?, result_state=?, revealed_fact_text=?, conditions_json=?,
             priority=?, enabled=?, updated_at=datetime('now')
         WHERE id=?`
      ).run(
        rule.method,
        rule.resultState,
        rule.revealedFactText,
        JSON.stringify(conditions),
        rule.method === "DIRECT_DISCLOSURE" ? 10 : 0,
        rule.dormant ? 0 : 1,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO persona_secret_discovery_rules (
           id, secret_id, method, rule_key, result_state, revealed_fact_text,
           conditions_json, priority, enabled
         ) VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        randomUUID(),
        secretId,
        rule.method,
        rule.ruleKey,
        rule.resultState,
        rule.revealedFactText,
        JSON.stringify(conditions),
        rule.method === "DIRECT_DISCLOSURE" ? 10 : 0,
        rule.dormant ? 0 : 1
      );
    }
  }

  // Removed rules are disabled (kept for evidence referencing rule rows), never deleted.
  const stale = db
    .prepare(`SELECT id, rule_key FROM persona_secret_discovery_rules WHERE secret_id=?`)
    .all(secretId) as Array<{ id: string; rule_key: string }>;
  for (const row of stale) {
    if (!incomingKeys.has(row.rule_key)) {
      db.prepare(
        `UPDATE persona_secret_discovery_rules SET enabled=0, updated_at=datetime('now') WHERE id=?`
      ).run(row.id);
    }
  }
}

export function listExistingPersonaSecrets(
  personaId: number,
  db: Database.Database = getDb()
): PersonaSecretRow[] {
  ensurePersonaSecretDiscoverySchema(db);
  return db
    .prepare(`SELECT * FROM persona_secrets WHERE persona_id=?`)
    .all(personaId) as PersonaSecretRow[];
}

export function findSuccessfulCompilationRun(opts: {
  personaId: number;
  sourceHash: string;
  compilerVersion?: number;
  db?: Database.Database;
}): { id: string; result_json: string } | null {
  const db = opts.db ?? getDb();
  ensureCompilationRunsSchema(db);
  const row = db
    .prepare(
      `SELECT id, result_json FROM persona_secret_compilation_runs
       WHERE persona_id=? AND source_hash=? AND compiler_version=? AND status='success'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(
      opts.personaId,
      opts.sourceHash,
      opts.compilerVersion ?? PERSONA_SECRET_COMPILER_VERSION
    ) as { id: string; result_json: string } | undefined;
  return row ?? null;
}

/**
 * Apply stable diff inside a single transaction.
 * On any throw, caller sees failure and prior rows remain (SQLite rollback).
 */
export function applyPersonaSecretCompilation(opts: {
  personaId: number;
  sourceHash: string;
  resultJson: string;
  diff: SecretStableDiff;
  db?: Database.Database;
}): { runId: string } {
  const db = opts.db ?? getDb();
  ensurePersonaSecretDiscoverySchema(db);
  ensureCompilationRunsSchema(db);

  const runId = randomUUID();
  const tx = db.transaction(() => {
    for (const action of opts.diff.actions) {
      if (action.kind === "create") {
        const c = action.compiled;
        const revive = db
          .prepare(
            `SELECT id FROM persona_secrets
             WHERE persona_id=? AND secret_key=? AND is_active=0`
          )
          .get(opts.personaId, c.semanticKey) as { id: string } | undefined;
        const id = revive?.id ?? randomUUID();
        if (revive) {
          db.prepare(
            `UPDATE persona_secrets SET
               owner_title=?,
               category=?,
               importance=?,
               canonical_secret_text=?,
               suspected_fact_text=?,
               confirmed_fact_text=?,
               is_active=1,
               revision=revision+1,
               updated_at=datetime('now')
             WHERE id=? AND persona_id=?`
          ).run(
            c.title,
            c.category,
            c.importance,
            c.canonicalSecretText,
            c.suspectedFactText,
            c.confirmedFactText,
            id,
            opts.personaId
          );
        } else {
          db.prepare(
            `INSERT INTO persona_secrets (
               id, persona_id, secret_key, owner_title, category, importance,
               canonical_secret_text, suspected_fact_text, confirmed_fact_text,
               is_active, revision
             ) VALUES (?,?,?,?,?,?,?,?,?,1,1)`
          ).run(
            id,
            opts.personaId,
            c.semanticKey,
            c.title,
            c.category,
            c.importance,
            c.canonicalSecretText,
            c.suspectedFactText,
            c.confirmedFactText
          );
        }
        upsertDiscoveryRulesStable(db, id, c);
      } else if (action.kind === "update" || action.kind === "keep") {
        const c = action.compiled;
        if (action.kind === "update") {
          // Clear inactive key collisions so UNIQUE(persona_id, secret_key) can accept remaps.
          const conflict = db
            .prepare(
              `SELECT id FROM persona_secrets
               WHERE persona_id=? AND secret_key=? AND id!=? AND is_active=0`
            )
            .get(opts.personaId, c.semanticKey, action.existingId) as
            | { id: string }
            | undefined;
          if (conflict) {
          db.prepare(
            `UPDATE persona_secret_discovery_rules SET enabled=0, updated_at=datetime('now') WHERE secret_id=?`
          ).run(conflict.id);
          db.prepare(`DELETE FROM persona_secrets WHERE id=?`).run(conflict.id);
          }
          db.prepare(
            `UPDATE persona_secrets SET
               secret_key=?,
               owner_title=?,
               category=?,
               importance=?,
               canonical_secret_text=?,
               suspected_fact_text=?,
               confirmed_fact_text=?,
               is_active=1,
               revision=revision+1,
               updated_at=datetime('now')
             WHERE id=? AND persona_id=?`
          ).run(
            c.semanticKey,
            c.title,
            c.category,
            c.importance,
            c.canonicalSecretText,
            c.suspectedFactText,
            c.confirmedFactText,
            action.existingId,
            opts.personaId
          );
        } else {
          db.prepare(
            `UPDATE persona_secrets SET is_active=1, updated_at=datetime('now')
             WHERE id=? AND persona_id=?`
          ).run(action.existingId, opts.personaId);
        }
        upsertDiscoveryRulesStable(db, action.existingId, c);
      } else if (action.kind === "inactivate") {
        db.prepare(
          `UPDATE persona_secrets SET is_active=0, updated_at=datetime('now')
           WHERE id=? AND persona_id=?`
        ).run(action.existingId, opts.personaId);
        db.prepare(
          `UPDATE persona_secret_discovery_rules SET enabled=0, updated_at=datetime('now')
           WHERE secret_id=?`
        ).run(action.existingId);
      }
    }

    // One success row per (persona, source_hash, compiler_version).
    db.prepare(
      `DELETE FROM persona_secret_compilation_runs
       WHERE persona_id=? AND source_hash=? AND compiler_version=? AND status='success'`
    ).run(
      opts.personaId,
      opts.sourceHash,
      PERSONA_SECRET_COMPILER_VERSION
    );

    db.prepare(
      `INSERT INTO persona_secret_compilation_runs (
         id, persona_id, source_hash, compiler_version, status, result_json, error_code
       ) VALUES (?,?,?,?,?,?,NULL)`
    ).run(
      runId,
      opts.personaId,
      opts.sourceHash,
      PERSONA_SECRET_COMPILER_VERSION,
      "success",
      opts.resultJson
    );
  });

  tx();
  return { runId };
}

export function recordFailedCompilationRun(opts: {
  personaId: number;
  sourceHash: string;
  errorCode: string;
  db?: Database.Database;
}): string {
  const db = opts.db ?? getDb();
  ensureCompilationRunsSchema(db);
  const runId = randomUUID();
  db.prepare(
    `INSERT INTO persona_secret_compilation_runs (
       id, persona_id, source_hash, compiler_version, status, result_json, error_code
     ) VALUES (?,?,?,?,?,?,?)`
  ).run(
    runId,
    opts.personaId,
    opts.sourceHash,
    PERSONA_SECRET_COMPILER_VERSION,
    "failed",
    null,
    opts.errorCode
  );
  return runId;
}
