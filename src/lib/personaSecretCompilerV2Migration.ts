import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  compileAndApplyPersonaSecrets,
  hashPersonaSecretSource,
} from "@/lib/personaSecretCompiler";
import { findSuccessfulCompilationRun } from "@/lib/personaSecretCompilerApply";
import {
  PERSONA_SECRET_COMPILER_VERSION,
} from "@/lib/personaSecretCompilerCatalog";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";

export const PERSONA_SECRET_COMPILER_V1 = 1;

export type V1DormantRuleCounts = {
  visual: number;
  investigation: number;
};

export type PersonaCompilerV2MigrationCandidate = {
  personaId: number;
  userId: number;
  sourceHash: string;
  sourceLength: number;
  v1DormantRules: V1DormantRuleCounts;
  hasV1SuccessRun: boolean;
  hasV2SuccessRun: boolean;
};

export type PersonaCompilerV2MigrationResult = {
  personaId: number;
  status: "skipped" | "dry_run" | "migrated" | "failed";
  reason?: string;
  errorCode?: string;
  enabledVisualAfter?: number;
  enabledInvestigationAfter?: number;
};

export type PersonaCompilerV2MigrationBatchResult = {
  execute: boolean;
  candidates: PersonaCompilerV2MigrationCandidate[];
  results: PersonaCompilerV2MigrationResult[];
  summary: {
    candidateCount: number;
    wouldRecompile: number;
    migrated: number;
    skipped: number;
    failed: number;
    v1VisualRules: number;
    v1InvestigationRules: number;
    wouldEnableVisual: number;
    wouldEnableInvestigation: number;
    wouldDisableStale: number;
  };
};

type PersonaRow = {
  id: number;
  user_id: number;
  secret_description: string | null;
};

function parseDormantFlag(conditionsJson: string): boolean {
  try {
    const parsed = JSON.parse(conditionsJson) as { dormant?: unknown };
    return parsed.dormant === true;
  } catch {
    return false;
  }
}

/** v1 artifact: VISUAL/INVESTIGATION rows stored with enabled=0 (dormant compile). */
export function countV1DormantDiscoveryRules(
  personaId: number,
  db: Database.Database = getDb()
): V1DormantRuleCounts {
  ensurePersonaSecretDiscoverySchema(db);
  const rows = db
    .prepare(
      `SELECT r.method, r.enabled, r.conditions_json
       FROM persona_secret_discovery_rules r
       JOIN persona_secrets s ON s.id = r.secret_id
       WHERE s.persona_id=? AND s.is_active=1
         AND r.method IN ('VISUAL_DISCOVERY', 'INVESTIGATION_DISCOVERY')`
    )
    .all(personaId) as Array<{
    method: string;
    enabled: number;
    conditions_json: string;
  }>;

  let visual = 0;
  let investigation = 0;
  for (const row of rows) {
    if (Number(row.enabled) !== 0) continue;
    if (!parseDormantFlag(String(row.conditions_json ?? "{}"))) continue;
    if (row.method === "VISUAL_DISCOVERY") visual += 1;
    if (row.method === "INVESTIGATION_DISCOVERY") investigation += 1;
  }
  return { visual, investigation };
}

export function countEnabledDiscoveryRules(
  personaId: number,
  db: Database.Database = getDb()
): V1DormantRuleCounts {
  ensurePersonaSecretDiscoverySchema(db);
  const rows = db
    .prepare(
      `SELECT r.method, COUNT(*) AS c
       FROM persona_secret_discovery_rules r
       JOIN persona_secrets s ON s.id = r.secret_id
       WHERE s.persona_id=? AND s.is_active=1 AND r.enabled=1
         AND r.method IN ('VISUAL_DISCOVERY', 'INVESTIGATION_DISCOVERY')
       GROUP BY r.method`
    )
    .all(personaId) as Array<{ method: string; c: number }>;

  const out = { visual: 0, investigation: 0 };
  for (const row of rows) {
    if (row.method === "VISUAL_DISCOVERY") out.visual = Number(row.c);
    if (row.method === "INVESTIGATION_DISCOVERY") out.investigation = Number(row.c);
  }
  return out;
}

function loadPersonaSource(
  personaId: number,
  db: Database.Database
): PersonaRow | null {
  return (
    (db
      .prepare(
        `SELECT id, user_id, secret_description
         FROM user_personas WHERE id=?`
      )
      .get(personaId) as PersonaRow | undefined) ?? null
  );
}

export function personaNeedsCompilerV2Migration(
  personaId: number,
  db: Database.Database = getDb()
): PersonaCompilerV2MigrationCandidate | null {
  ensurePersonaSecretDiscoverySchema(db);
  const persona = loadPersonaSource(personaId, db);
  if (!persona) return null;

  const source = String(persona.secret_description ?? "");
  const trimmed = source.trim();
  if (!trimmed) return null;

  const activeSecrets = db
    .prepare(`SELECT COUNT(*) AS c FROM persona_secrets WHERE persona_id=? AND is_active=1`)
    .get(personaId) as { c: number };
  if (Number(activeSecrets.c) === 0) return null;

  const sourceHash = hashPersonaSecretSource(source);
  const v1DormantRules = countV1DormantDiscoveryRules(personaId, db);
  const hasV1SuccessRun =
    findSuccessfulCompilationRun({
      personaId,
      sourceHash,
      compilerVersion: PERSONA_SECRET_COMPILER_V1,
      db,
    }) != null;
  const hasV2SuccessRun =
    findSuccessfulCompilationRun({
      personaId,
      sourceHash,
      compilerVersion: PERSONA_SECRET_COMPILER_VERSION,
      db,
    }) != null;

  const needsMigration =
    !hasV2SuccessRun &&
    (hasV1SuccessRun || v1DormantRules.visual > 0 || v1DormantRules.investigation > 0);

  if (!needsMigration) return null;

  return {
    personaId,
    userId: persona.user_id,
    sourceHash,
    sourceLength: trimmed.length,
    v1DormantRules,
    hasV1SuccessRun,
    hasV2SuccessRun,
  };
}

export function findPersonasNeedingCompilerV2Migration(
  db: Database.Database = getDb()
): PersonaCompilerV2MigrationCandidate[] {
  ensurePersonaSecretDiscoverySchema(db);
  const personaIds = db
    .prepare(
      `SELECT DISTINCT p.id
       FROM user_personas p
       JOIN persona_secrets s ON s.persona_id = p.id AND s.is_active = 1
       WHERE TRIM(COALESCE(p.secret_description, '')) != ''`
    )
    .all() as Array<{ id: number }>;

  const out: PersonaCompilerV2MigrationCandidate[] = [];
  for (const row of personaIds) {
    const candidate = personaNeedsCompilerV2Migration(row.id, db);
    if (candidate) out.push(candidate);
  }
  return out.sort((a, b) => a.personaId - b.personaId);
}

export function migratePersonaSecretCompilerV2(opts: {
  personaId: number;
  execute: boolean;
  db?: Database.Database;
  userId?: number | null;
}): PersonaCompilerV2MigrationResult {
  const db = opts.db ?? getDb();
  const candidate = personaNeedsCompilerV2Migration(opts.personaId, db);
  if (!candidate) {
    return { personaId: opts.personaId, status: "skipped", reason: "not_a_candidate" };
  }

  if (!opts.execute) {
    const enabledBefore = countEnabledDiscoveryRules(opts.personaId, db);
    return {
      personaId: opts.personaId,
      status: "dry_run",
      enabledVisualAfter: enabledBefore.visual + candidate.v1DormantRules.visual,
      enabledInvestigationAfter:
        enabledBefore.investigation + candidate.v1DormantRules.investigation,
    };
  }

  const persona = loadPersonaSource(opts.personaId, db);
  if (!persona) {
    return {
      personaId: opts.personaId,
      status: "failed",
      errorCode: "PERSONA_NOT_FOUND",
    };
  }

  const result = compileAndApplyPersonaSecrets({
    personaId: opts.personaId,
    source: String(persona.secret_description ?? ""),
    force: true,
    userId: opts.userId ?? persona.user_id,
    db,
  });

  if (!result.ok) {
    return {
      personaId: opts.personaId,
      status: "failed",
      errorCode: result.errorCode,
    };
  }

  const enabledAfter = countEnabledDiscoveryRules(opts.personaId, db);
  return {
    personaId: opts.personaId,
    status: "migrated",
    enabledVisualAfter: enabledAfter.visual,
    enabledInvestigationAfter: enabledAfter.investigation,
  };
}

export function migrateAllPersonaSecretCompilerV2(opts: {
  execute: boolean;
  db?: Database.Database;
}): PersonaCompilerV2MigrationBatchResult {
  const db = opts.db ?? getDb();
  const candidates = findPersonasNeedingCompilerV2Migration(db);
  const results: PersonaCompilerV2MigrationResult[] = [];

  let v1VisualRules = 0;
  let v1InvestigationRules = 0;
  for (const c of candidates) {
    v1VisualRules += c.v1DormantRules.visual;
    v1InvestigationRules += c.v1DormantRules.investigation;
    results.push(
      migratePersonaSecretCompilerV2({
        personaId: c.personaId,
        execute: opts.execute,
        userId: c.userId,
        db,
      })
    );
  }

  const enabledAfterDry = candidates.map((c) => {
    const enabled = countEnabledDiscoveryRules(c.personaId, db);
    return {
      visual: enabled.visual + c.v1DormantRules.visual,
      investigation: enabled.investigation + c.v1DormantRules.investigation,
    };
  });

  const migrated = results.filter((r) => r.status === "migrated").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return {
    execute: opts.execute,
    candidates,
    results,
    summary: {
      candidateCount: candidates.length,
      wouldRecompile: candidates.length,
      migrated,
      skipped,
      failed,
      v1VisualRules,
      v1InvestigationRules,
      wouldEnableVisual: enabledAfterDry.reduce((n, x) => n + x.visual, 0),
      wouldEnableInvestigation: enabledAfterDry.reduce((n, x) => n + x.investigation, 0),
      wouldDisableStale: 0,
    },
  };
}
