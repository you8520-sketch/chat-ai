import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  compileAndApplyPersonaSecrets,
  hashPersonaSecretSource,
} from "@/lib/personaSecretCompiler";
import { compilePersonaSecretsDeterministic } from "@/lib/personaSecretCompilerDeterministic";
import {
  findSuccessfulCompilationRun,
  listExistingPersonaSecrets,
} from "@/lib/personaSecretCompilerApply";
import { diffCompiledPersonaSecrets } from "@/lib/personaSecretCompilerDiff";
import {
  PERSONA_SECRET_COMPILER_VERSION,
} from "@/lib/personaSecretCompilerCatalog";
import type {
  CompiledDiscoveryRule,
  CompiledPersonaSecret,
  SecretStableDiff,
} from "@/lib/personaSecretCompilerTypes";
import { validatePersonaSecretCompilerResult } from "@/lib/personaSecretCompilerValidate";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type { PersonaSecretRow } from "@/lib/personaSecretDiscoveryTypes";

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

export type PersonaCompilerV2MigrationPlanCounts = {
  wouldRecompile: boolean;
  wouldEnableVisual: number;
  wouldEnableInvestigation: number;
  wouldDisableStale: number;
};

export type PersonaCompilerV2MigrationPlan = PersonaCompilerV2MigrationPlanCounts & {
  personaId: number;
  candidate: PersonaCompilerV2MigrationCandidate;
};

export type PersonaCompilerV2MigrationResult = {
  personaId: number;
  status: "skipped" | "dry_run" | "migrated" | "failed";
  reason?: string;
  errorCode?: string;
  plan?: PersonaCompilerV2MigrationPlanCounts;
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

type DiscoveryRuleRow = {
  id: string;
  secret_id: string;
  method: string;
  rule_key: string;
  enabled: number;
};

function parseDormantFlag(conditionsJson: string): boolean {
  try {
    const parsed = JSON.parse(conditionsJson) as { dormant?: unknown };
    return parsed.dormant === true;
  } catch {
    return false;
  }
}

function plannedEnabledForRule(rule: CompiledDiscoveryRule): number {
  return rule.dormant ? 0 : 1;
}

function listPersonaDiscoveryRules(
  personaId: number,
  db: Database.Database
): DiscoveryRuleRow[] {
  ensurePersonaSecretDiscoverySchema(db);
  return db
    .prepare(
      `SELECT r.id, r.secret_id, r.method, r.rule_key, r.enabled
       FROM persona_secret_discovery_rules r
       JOIN persona_secrets s ON s.id = r.secret_id
       WHERE s.persona_id=?`
    )
    .all(personaId) as DiscoveryRuleRow[];
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

/**
 * Mirror upsertDiscoveryRulesStable + inactivate without DB writes.
 * Uses v2 deterministic compile + stable diff against current persona_secrets.
 */
export function computeMigrationRulePlanCounts(opts: {
  existing: PersonaSecretRow[];
  diff: SecretStableDiff;
  currentRules: DiscoveryRuleRow[];
}): PersonaCompilerV2MigrationPlanCounts {
  const plannedByRuleId = new Map<string, number>();
  for (const row of opts.currentRules) {
    plannedByRuleId.set(row.id, Number(row.enabled));
  }

  let wouldEnableVisual = 0;
  let wouldEnableInvestigation = 0;
  let wouldDisableStale = 0;

  const countNewEnable = (rule: CompiledDiscoveryRule) => {
    const enabled = plannedEnabledForRule(rule);
    if (rule.method === "VISUAL_DISCOVERY" && enabled === 1) wouldEnableVisual += 1;
    if (rule.method === "INVESTIGATION_DISCOVERY" && enabled === 1) {
      wouldEnableInvestigation += 1;
    }
  };

  const applyUpsertPlan = (secretId: string, compiled: CompiledPersonaSecret) => {
    const incomingKeys = new Set(compiled.discoveryRules.map((r) => r.ruleKey));
    for (const rule of compiled.discoveryRules) {
      const enabled = plannedEnabledForRule(rule);
      const existingRule = opts.currentRules.find(
        (r) => r.secret_id === secretId && r.rule_key === rule.ruleKey
      );
      if (existingRule) {
        const before = Number(existingRule.enabled);
        plannedByRuleId.set(existingRule.id, enabled);
        if (rule.method === "VISUAL_DISCOVERY" && before === 0 && enabled === 1) {
          wouldEnableVisual += 1;
        }
        if (rule.method === "INVESTIGATION_DISCOVERY" && before === 0 && enabled === 1) {
          wouldEnableInvestigation += 1;
        }
      } else {
        countNewEnable(rule);
      }
    }
    for (const row of opts.currentRules.filter((r) => r.secret_id === secretId)) {
      if (!incomingKeys.has(row.rule_key)) {
        plannedByRuleId.set(row.id, 0);
        wouldDisableStale += 1;
      }
    }
  };

  for (const action of opts.diff.actions) {
    if (action.kind === "create") {
      for (const rule of action.compiled.discoveryRules) countNewEnable(rule);
      continue;
    }
    if (action.kind === "inactivate") {
      for (const row of opts.currentRules.filter((r) => r.secret_id === action.existingId)) {
        plannedByRuleId.set(row.id, 0);
        wouldDisableStale += 1;
      }
      continue;
    }
    applyUpsertPlan(action.existingId, action.compiled);
  }

  return {
    wouldRecompile: true,
    wouldEnableVisual,
    wouldEnableInvestigation,
    wouldDisableStale,
  };
}

export function planPersonaSecretCompilerV2Migration(opts: {
  personaId: number;
  db?: Database.Database;
}):
  | PersonaCompilerV2MigrationPlan
  | { personaId: number; errorCode: string }
  | null {
  const db = opts.db ?? getDb();
  const candidate = personaNeedsCompilerV2Migration(opts.personaId, db);
  if (!candidate) return null;

  const persona = loadPersonaSource(opts.personaId, db);
  if (!persona) return { personaId: opts.personaId, errorCode: "PERSONA_NOT_FOUND" };

  const source = String(persona.secret_description ?? "");
  const trimmed = source.trim();
  if (!trimmed) return { personaId: opts.personaId, errorCode: "EMPTY_SOURCE" };

  let compiled;
  try {
    compiled = compilePersonaSecretsDeterministic(source);
  } catch {
    return { personaId: opts.personaId, errorCode: "COMPILER_THROW" };
  }

  const validated = validatePersonaSecretCompilerResult(compiled, source);
  if (!validated.ok) {
    return { personaId: opts.personaId, errorCode: validated.errorCode };
  }

  const existing = listExistingPersonaSecrets(opts.personaId, db);
  const diff = diffCompiledPersonaSecrets(existing, validated.result.secrets);
  const currentRules = listPersonaDiscoveryRules(opts.personaId, db);
  const counts = computeMigrationRulePlanCounts({ existing, diff, currentRules });

  return {
    personaId: opts.personaId,
    candidate,
    ...counts,
  };
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

/** Enabled transitions + new rows — pairs with plan wouldEnable* counts. */
export function countRuleEnableDeltas(opts: {
  before: DiscoveryRuleRow[];
  after: DiscoveryRuleRow[];
}): Pick<
  PersonaCompilerV2MigrationPlanCounts,
  "wouldEnableVisual" | "wouldEnableInvestigation"
> {
  const afterById = new Map(opts.after.map((r) => [r.id, r]));
  const beforeIds = new Set(opts.before.map((r) => r.id));
  let wouldEnableVisual = 0;
  let wouldEnableInvestigation = 0;

  for (const before of opts.before) {
    const after = afterById.get(before.id);
    if (!after) continue;
    if (Number(before.enabled) === 0 && Number(after.enabled) === 1) {
      if (before.method === "VISUAL_DISCOVERY") wouldEnableVisual += 1;
      if (before.method === "INVESTIGATION_DISCOVERY") wouldEnableInvestigation += 1;
    }
  }
  for (const after of opts.after) {
    if (beforeIds.has(after.id)) continue;
    if (after.method === "VISUAL_DISCOVERY" && Number(after.enabled) === 1) {
      wouldEnableVisual += 1;
    }
    if (after.method === "INVESTIGATION_DISCOVERY" && Number(after.enabled) === 1) {
      wouldEnableInvestigation += 1;
    }
  }
  return { wouldEnableVisual, wouldEnableInvestigation };
}

export function listPlannedStaleRuleIds(opts: {
  personaId: number;
  db?: Database.Database;
}): string[] {
  const db = opts.db ?? getDb();
  const persona = loadPersonaSource(opts.personaId, db);
  if (!persona) return [];
  const source = String(persona.secret_description ?? "").trim();
  if (!source) return [];

  let compiled;
  try {
    compiled = compilePersonaSecretsDeterministic(source);
  } catch {
    return [];
  }
  const validated = validatePersonaSecretCompilerResult(compiled, source);
  if (!validated.ok) return [];

  const existing = listExistingPersonaSecrets(opts.personaId, db);
  const diff = diffCompiledPersonaSecrets(existing, validated.result.secrets);
  const currentRules = listPersonaDiscoveryRules(opts.personaId, db);

  const staleIds: string[] = [];
  for (const action of diff.actions) {
    if (action.kind === "inactivate") {
      for (const row of currentRules.filter((r) => r.secret_id === action.existingId)) {
        staleIds.push(row.id);
      }
      continue;
    }
    if (action.kind === "create") continue;
    const incomingKeys = new Set(action.compiled.discoveryRules.map((r) => r.ruleKey));
    for (const row of currentRules.filter((r) => r.secret_id === action.existingId)) {
      if (!incomingKeys.has(row.rule_key)) staleIds.push(row.id);
    }
  }
  return staleIds;
}

/** @deprecated Prefer countRuleEnableDeltas + listPlannedStaleRuleIds for parity checks. */
export function measureExecutedRuleDeltas(opts: {
  before: DiscoveryRuleRow[];
  after: DiscoveryRuleRow[];
}): PersonaCompilerV2MigrationPlanCounts {
  const enables = countRuleEnableDeltas(opts);
  return {
    wouldRecompile: true,
    ...enables,
    wouldDisableStale: 0,
  };
}

export function migratePersonaSecretCompilerV2(opts: {
  personaId: number;
  execute: boolean;
  db?: Database.Database;
  userId?: number | null;
}): PersonaCompilerV2MigrationResult {
  const db = opts.db ?? getDb();
  const planned = planPersonaSecretCompilerV2Migration({
    personaId: opts.personaId,
    db,
  });

  if (planned == null) {
    return { personaId: opts.personaId, status: "skipped", reason: "not_a_candidate" };
  }
  if ("errorCode" in planned) {
    return {
      personaId: opts.personaId,
      status: "failed",
      errorCode: planned.errorCode,
    };
  }

  const planCounts: PersonaCompilerV2MigrationPlanCounts = {
    wouldRecompile: planned.wouldRecompile,
    wouldEnableVisual: planned.wouldEnableVisual,
    wouldEnableInvestigation: planned.wouldEnableInvestigation,
    wouldDisableStale: planned.wouldDisableStale,
  };

  if (!opts.execute) {
    return {
      personaId: opts.personaId,
      status: "dry_run",
      plan: planCounts,
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
      plan: planCounts,
    };
  }

  const enabledAfter = countEnabledDiscoveryRules(opts.personaId, db);
  return {
    personaId: opts.personaId,
    status: "migrated",
    plan: planCounts,
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
  let wouldEnableVisual = 0;
  let wouldEnableInvestigation = 0;
  let wouldDisableStale = 0;

  for (const c of candidates) {
    v1VisualRules += c.v1DormantRules.visual;
    v1InvestigationRules += c.v1DormantRules.investigation;
    const result = migratePersonaSecretCompilerV2({
      personaId: c.personaId,
      execute: opts.execute,
      userId: c.userId,
      db,
    });
    results.push(result);
    if (result.plan) {
      wouldEnableVisual += result.plan.wouldEnableVisual;
      wouldEnableInvestigation += result.plan.wouldEnableInvestigation;
      wouldDisableStale += result.plan.wouldDisableStale;
    }
  }

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
      wouldEnableVisual,
      wouldEnableInvestigation,
      wouldDisableStale,
    },
  };
}

export type { DiscoveryRuleRow };
