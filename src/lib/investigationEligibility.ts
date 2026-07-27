import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  INVESTIGATION_MIN_COMPILER_CONFIDENCE,
  INVESTIGATION_RESULT_TYPES,
} from "@/lib/investigationCatalog";
import {
  parseInvestigationRuleConditions,
  type InvestigationDiscoveryCondition,
} from "@/lib/investigationConditions";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type {
  PersonaSecretDiscoveryRuleRow,
  PersonaSecretRow,
} from "@/lib/personaSecretDiscoveryTypes";
import { sanitizeRevealedFactForPrompt } from "@/lib/personaSecretReveal";

export type EligibleInvestigationRule = PersonaSecretDiscoveryRuleRow & {
  secret: PersonaSecretRow;
  conditions: InvestigationDiscoveryCondition;
};

const SUPPORTED = new Set<string>(INVESTIGATION_RESULT_TYPES);

/**
 * Runtime-eligible INVESTIGATION rules.
 * Includes dormant (enabled=0) rows — does NOT bulk-enable DB bits.
 */
export function listEligibleInvestigationDiscoveryRules(
  personaId: number,
  db: Database.Database = getDb()
): EligibleInvestigationRule[] {
  ensurePersonaSecretDiscoverySchema(db);
  const rows = db
    .prepare(
      `SELECT r.*,
              s.id AS s_id, s.persona_id AS s_persona_id, s.secret_key AS s_secret_key,
              s.owner_title AS s_owner_title, s.category AS s_category,
              s.importance AS s_importance,
              s.canonical_secret_text AS s_canonical_secret_text,
              s.suspected_fact_text AS s_suspected_fact_text,
              s.confirmed_fact_text AS s_confirmed_fact_text,
              s.discoverability AS s_discoverability,
              s.chat_scope_policy AS s_chat_scope_policy,
              s.is_active AS s_is_active, s.revision AS s_revision,
              s.created_at AS s_created_at, s.updated_at AS s_updated_at
       FROM persona_secret_discovery_rules r
       JOIN persona_secrets s ON s.id = r.secret_id
       WHERE s.persona_id=? AND s.is_active=1
         AND r.method='INVESTIGATION_DISCOVERY'
       ORDER BY r.priority DESC, r.id ASC`
    )
    .all(personaId) as Array<Record<string, unknown>>;

  const out: EligibleInvestigationRule[] = [];
  for (const row of rows) {
    const conditions = parseInvestigationRuleConditions(
      String(row.conditions_json ?? "{}")
    );
    if (!conditions) continue;
    if (conditions.needsReview) continue;
    if (!SUPPORTED.has(conditions.evidenceKind)) continue;

    const confidence =
      typeof conditions.compilerConfidence === "number"
        ? conditions.compilerConfidence
        : 0;
    if (confidence < INVESTIGATION_MIN_COMPILER_CONFIDENCE) continue;

    if (
      Array.isArray(conditions.compilerWarnings) &&
      conditions.compilerWarnings.some((w) =>
        /unresolved|needs_review|invalid|invent/i.test(w)
      )
    ) {
      continue;
    }

    const revealed = sanitizeRevealedFactForPrompt(String(row.revealed_fact_text ?? ""));
    if (!revealed) continue;

    const resultState =
      row.result_state === "SUSPECTED" || conditions.resultState === "SUSPECTED"
        ? "SUSPECTED"
        : "CONFIRMED";

    out.push({
      id: String(row.id),
      secret_id: String(row.secret_id),
      method: "INVESTIGATION_DISCOVERY",
      rule_key: String(row.rule_key),
      result_state: resultState,
      revealed_fact_text: revealed,
      conditions_json: String(row.conditions_json ?? "{}"),
      priority: Number(row.priority ?? 0),
      enabled: Number(row.enabled ?? 0),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      secret: {
        id: String(row.s_id),
        persona_id: Number(row.s_persona_id),
        secret_key: String(row.s_secret_key),
        owner_title: String(row.s_owner_title ?? ""),
        category: row.s_category as PersonaSecretRow["category"],
        importance: row.s_importance as PersonaSecretRow["importance"],
        canonical_secret_text: String(row.s_canonical_secret_text ?? ""),
        suspected_fact_text: String(row.s_suspected_fact_text ?? ""),
        confirmed_fact_text: String(row.s_confirmed_fact_text ?? ""),
        discoverability: row.s_discoverability as PersonaSecretRow["discoverability"],
        chat_scope_policy: row.s_chat_scope_policy as PersonaSecretRow["chat_scope_policy"],
        is_active: Number(row.s_is_active ?? 0),
        revision: Number(row.s_revision ?? 1),
        created_at: String(row.s_created_at ?? ""),
        updated_at: String(row.s_updated_at ?? ""),
      },
      conditions,
    });
  }
  return out;
}

export function isInvestigationRuleEligible(rule: EligibleInvestigationRule): boolean {
  if (rule.method !== "INVESTIGATION_DISCOVERY") return false;
  if (rule.secret.is_active !== 1) return false;
  if (rule.conditions.needsReview) return false;
  if (!SUPPORTED.has(rule.conditions.evidenceKind)) return false;
  const confidence = rule.conditions.compilerConfidence ?? 0;
  return confidence >= INVESTIGATION_MIN_COMPILER_CONFIDENCE;
}
