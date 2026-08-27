import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type {
  PersonaSecretDiscoveryRuleRow,
  PersonaSecretRow,
} from "@/lib/personaSecretDiscoveryTypes";
import {
  VISUAL_RULE_MIN_COMPILER_CONFIDENCE,
} from "@/lib/visualDiscoveryCatalog";
import {
  parseVisualRuleConditions,
  type VisualRuleConditions,
} from "@/lib/visualDiscoveryConditions";
import { sanitizeRevealedFactForPrompt } from "@/lib/personaSecretReveal";

export type EligibleVisualRule = PersonaSecretDiscoveryRuleRow & {
  secret: PersonaSecretRow;
  conditions: VisualRuleConditions;
};

/**
 * Runtime-eligible VISUAL rules for a persona.
 * enabled=1 is the sole runtime authority — disabled rows are stale/removed.
 */
export function listEligibleVisualDiscoveryRules(
  personaId: number,
  db: Database.Database = getDb()
): EligibleVisualRule[] {
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
         AND r.method='VISUAL_DISCOVERY'
         AND r.enabled=1
       ORDER BY r.priority DESC, r.id ASC`
    )
    .all(personaId) as Array<Record<string, unknown>>;

  const out: EligibleVisualRule[] = [];
  for (const row of rows) {
    const conditions = parseVisualRuleConditions(String(row.conditions_json ?? "{}"));
    if (!conditions) continue;
    if (conditions.needsReview) continue;
    const confidence =
      typeof conditions.compilerConfidence === "number"
        ? conditions.compilerConfidence
        : 0;
    if (confidence < VISUAL_RULE_MIN_COMPILER_CONFIDENCE) continue;
    if (Array.isArray(conditions.compilerWarnings) && conditions.compilerWarnings.length > 0) {
      // Allow only non-blocking informational warnings; block unresolved/review.
      if (
        conditions.compilerWarnings.some((w) =>
          /unresolved|needs_review|invalid|invent/i.test(w)
        )
      ) {
        continue;
      }
    }

    const revealed = sanitizeRevealedFactForPrompt(String(row.revealed_fact_text ?? ""));
    if (!revealed) continue;

    // Require typed condition fields for the evidence kind.
    if (conditions.evidenceKind === "BODY_REGION_EXPOSED" && !conditions.region) {
      continue;
    }
    if (
      conditions.evidenceKind === "ABILITY_MANIFESTED" &&
      !(conditions.manifestationTags && conditions.manifestationTags.length > 0)
    ) {
      continue;
    }
    if (
      (conditions.evidenceKind === "PHYSICAL_SYMPTOM_DISPLAYED" ||
        conditions.evidenceKind === "PHYSICAL_SYMPTOM_OBSERVED") &&
      !(conditions.symptomTags && conditions.symptomTags.length > 0)
    ) {
      continue;
    }

    const resultState =
      row.result_state === "SUSPECTED" || conditions.resultState === "SUSPECTED"
        ? "SUSPECTED"
        : "CONFIRMED";

    out.push({
      id: String(row.id),
      secret_id: String(row.secret_id),
      method: "VISUAL_DISCOVERY",
      rule_key: String(row.rule_key),
      result_state: resultState,
      revealed_fact_text: revealed,
      conditions_json: String(row.conditions_json ?? "{}"),
      priority: Number(row.priority ?? 0),
      enabled: Number(row.enabled ?? 0),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      conditions,
      secret: {
        id: String(row.s_id),
        persona_id: Number(row.s_persona_id),
        secret_key: String(row.s_secret_key),
        owner_title: String(row.s_owner_title ?? ""),
        category: (row.s_category as PersonaSecretRow["category"]) || "OTHER",
        importance: (row.s_importance as PersonaSecretRow["importance"]) || "NORMAL",
        canonical_secret_text: String(row.s_canonical_secret_text ?? ""),
        suspected_fact_text: String(row.s_suspected_fact_text ?? ""),
        confirmed_fact_text: String(row.s_confirmed_fact_text ?? ""),
        discoverability: "DISCOVERABLE",
        chat_scope_policy: "CHAT_ONLY",
        is_active: Number(row.s_is_active ?? 1),
        revision: Number(row.s_revision ?? 1),
        created_at: String(row.s_created_at),
        updated_at: String(row.s_updated_at),
      },
    });
  }
  return out;
}
