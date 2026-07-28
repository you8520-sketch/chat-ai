import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import type {
  DirectDisclosureConditions,
  PersonaSecretCategory,
  PersonaSecretDiscoveryRuleRow,
  PersonaSecretEditorDto,
  PersonaSecretImportance,
  PersonaSecretRow,
} from "@/lib/personaSecretDiscoveryTypes";
import { sanitizeRevealedFactForPrompt } from "@/lib/personaSecretReveal";

const SECRET_KEY_RE = /^[a-z][a-z0-9_]{1,63}$/;

function parseConditions(raw: string): DirectDisclosureConditions {
  try {
    const parsed = JSON.parse(raw) as Partial<DirectDisclosureConditions>;
    const aliases = Array.isArray(parsed.aliases)
      ? parsed.aliases.map((a) => String(a ?? "").trim()).filter(Boolean)
      : [];
    return {
      aliases,
      requires_first_person: parsed.requires_first_person !== false,
      requires_assertive_statement: parsed.requires_assertive_statement !== false,
    };
  } catch {
    return { aliases: [], requires_first_person: true, requires_assertive_statement: true };
  }
}

function normalizeSecretKey(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!SECRET_KEY_RE.test(key)) return null;
  return key;
}

function mapSecret(row: PersonaSecretRow): PersonaSecretEditorDto {
  return {
    id: row.id,
    personaId: row.persona_id,
    secretKey: row.secret_key,
    ownerTitle: row.owner_title,
    category: row.category,
    importance: row.importance,
    canonicalSecretText: row.canonical_secret_text,
    suspectedFactText: row.suspected_fact_text,
    confirmedFactText: row.confirmed_fact_text,
    isActive: row.is_active === 1,
    revision: row.revision,
    directDisclosureAliases: [],
  };
}

export function listPersonaSecretsForEditor(
  personaId: number,
  db: Database.Database = getDb()
): PersonaSecretEditorDto[] {
  ensurePersonaSecretDiscoverySchema(db);
  const secrets = db
    .prepare(
      `SELECT * FROM persona_secrets
       WHERE persona_id=?
       ORDER BY is_active DESC, importance DESC, updated_at DESC, id ASC`
    )
    .all(personaId) as PersonaSecretRow[];

  return secrets.map((secret) => {
    const dto = mapSecret(secret);
    const rule = db
      .prepare(
        `SELECT * FROM persona_secret_discovery_rules
         WHERE secret_id=? AND method='DIRECT_DISCLOSURE' AND rule_key='default'
         LIMIT 1`
      )
      .get(secret.id) as PersonaSecretDiscoveryRuleRow | undefined;
    if (rule) {
      dto.directDisclosureAliases = parseConditions(rule.conditions_json).aliases;
    }
    return dto;
  });
}

export function getPersonaSecretById(
  secretId: string,
  db: Database.Database = getDb()
): PersonaSecretRow | null {
  ensurePersonaSecretDiscoverySchema(db);
  const row = db
    .prepare(`SELECT * FROM persona_secrets WHERE id=?`)
    .get(secretId) as PersonaSecretRow | undefined;
  return row ?? null;
}

export function getActivePersonaSecretByKey(
  personaId: number,
  secretKey: string,
  db: Database.Database = getDb()
): PersonaSecretRow | null {
  ensurePersonaSecretDiscoverySchema(db);
  const row = db
    .prepare(
      `SELECT * FROM persona_secrets
       WHERE persona_id=? AND secret_key=? AND is_active=1
       LIMIT 1`
    )
    .get(personaId, secretKey) as PersonaSecretRow | undefined;
  return row ?? null;
}

export function listActivePersonaSecrets(
  personaId: number,
  db: Database.Database = getDb()
): PersonaSecretRow[] {
  ensurePersonaSecretDiscoverySchema(db);
  return db
    .prepare(
      `SELECT * FROM persona_secrets
       WHERE persona_id=? AND is_active=1
       ORDER BY
         CASE importance WHEN 'CRITICAL' THEN 0 WHEN 'IMPORTANT' THEN 1 ELSE 2 END,
         updated_at DESC,
         id ASC`
    )
    .all(personaId) as PersonaSecretRow[];
}

export function listDirectDisclosureRulesForPersona(
  personaId: number,
  db: Database.Database = getDb()
): Array<PersonaSecretDiscoveryRuleRow & { secret: PersonaSecretRow }> {
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
         AND r.method='DIRECT_DISCLOSURE' AND r.enabled=1
       ORDER BY r.priority DESC, r.id ASC`
    )
    .all(personaId) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const rule: PersonaSecretDiscoveryRuleRow = {
      id: String(row.id),
      secret_id: String(row.secret_id),
      method: "DIRECT_DISCLOSURE",
      rule_key: String(row.rule_key),
      result_state: row.result_state === "SUSPECTED" ? "SUSPECTED" : "CONFIRMED",
      revealed_fact_text: String(row.revealed_fact_text ?? ""),
      conditions_json: String(row.conditions_json ?? "{}"),
      priority: Number(row.priority ?? 0),
      enabled: Number(row.enabled ?? 1),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
    const secret: PersonaSecretRow = {
      id: String(row.s_id),
      persona_id: Number(row.s_persona_id),
      secret_key: String(row.s_secret_key),
      owner_title: String(row.s_owner_title ?? ""),
      category: (row.s_category as PersonaSecretCategory) || "OTHER",
      importance: (row.s_importance as PersonaSecretImportance) || "NORMAL",
      canonical_secret_text: String(row.s_canonical_secret_text ?? ""),
      suspected_fact_text: String(row.s_suspected_fact_text ?? ""),
      confirmed_fact_text: String(row.s_confirmed_fact_text ?? ""),
      discoverability: "DISCOVERABLE",
      chat_scope_policy: "CHAT_ONLY",
      is_active: Number(row.s_is_active ?? 1),
      revision: Number(row.s_revision ?? 1),
      created_at: String(row.s_created_at),
      updated_at: String(row.s_updated_at),
    };
    return { ...rule, secret };
  });
}

export type CreatePersonaSecretInput = {
  personaId: number;
  secretKey: string;
  ownerTitle?: string;
  category?: PersonaSecretCategory;
  importance?: PersonaSecretImportance;
  canonicalSecretText: string;
  suspectedFactText?: string;
  confirmedFactText: string;
  directDisclosureAliases?: string[];
};

export function createPersonaSecret(
  input: CreatePersonaSecretInput,
  db: Database.Database = getDb()
): { ok: true; secret: PersonaSecretEditorDto } | { ok: false; error: string } {
  ensurePersonaSecretDiscoverySchema(db);
  const secretKey = normalizeSecretKey(input.secretKey);
  if (!secretKey) {
    return { ok: false, error: "secret_key는 소문자·숫자·밑줄만 사용할 수 있습니다." };
  }
  const canonical = input.canonicalSecretText.trim();
  const confirmed = sanitizeRevealedFactForPrompt(input.confirmedFactText);
  if (!canonical) return { ok: false, error: "비밀 원문을 입력하세요." };
  if (!confirmed) return { ok: false, error: "확정 공개 fact를 입력하세요." };

  const existing = db
    .prepare(`SELECT id FROM persona_secrets WHERE persona_id=? AND secret_key=?`)
    .get(input.personaId, secretKey) as { id: string } | undefined;
  if (existing) return { ok: false, error: "이미 같은 secret_key가 있습니다." };

  const id = randomUUID();
  const ruleId = randomUUID();
  const aliases = (input.directDisclosureAliases ?? [])
    .map((a) => a.trim())
    .filter(Boolean);
  const conditions: DirectDisclosureConditions = {
    aliases,
    requires_first_person: true,
    requires_assertive_statement: true,
  };

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO persona_secrets (
         id, persona_id, secret_key, owner_title, category, importance,
         canonical_secret_text, suspected_fact_text, confirmed_fact_text
       ) VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      input.personaId,
      secretKey,
      (input.ownerTitle ?? "").trim(),
      input.category ?? "OTHER",
      input.importance ?? "NORMAL",
      canonical,
      (input.suspectedFactText ?? "").trim(),
      confirmed
    );
    db.prepare(
      `INSERT INTO persona_secret_discovery_rules (
         id, secret_id, method, rule_key, result_state, revealed_fact_text,
         conditions_json, priority, enabled
       ) VALUES (?,?,?,?,?,?,?,?,1)`
    ).run(
      ruleId,
      id,
      "DIRECT_DISCLOSURE",
      "default",
      "CONFIRMED",
      confirmed,
      JSON.stringify(conditions),
      0
    );
  });
  tx();

  const created = listPersonaSecretsForEditor(input.personaId, db).find((s) => s.id === id);
  if (!created) return { ok: false, error: "비밀 생성에 실패했습니다." };
  return { ok: true, secret: created };
}

export type UpdatePersonaSecretInput = {
  secretId: string;
  personaId: number;
  ownerTitle?: string;
  category?: PersonaSecretCategory;
  importance?: PersonaSecretImportance;
  canonicalSecretText?: string;
  suspectedFactText?: string;
  confirmedFactText?: string;
  isActive?: boolean;
  directDisclosureAliases?: string[];
};

export function updatePersonaSecret(
  input: UpdatePersonaSecretInput,
  db: Database.Database = getDb()
): { ok: true; secret: PersonaSecretEditorDto } | { ok: false; error: string } {
  ensurePersonaSecretDiscoverySchema(db);
  const existing = getPersonaSecretById(input.secretId, db);
  if (!existing || existing.persona_id !== input.personaId) {
    return { ok: false, error: "비밀을 찾을 수 없습니다." };
  }

  const canonical =
    input.canonicalSecretText != null
      ? input.canonicalSecretText.trim()
      : existing.canonical_secret_text;
  const confirmed =
    input.confirmedFactText != null
      ? sanitizeRevealedFactForPrompt(input.confirmedFactText)
      : existing.confirmed_fact_text;
  if (!canonical) return { ok: false, error: "비밀 원문을 입력하세요." };
  if (!confirmed) return { ok: false, error: "확정 공개 fact를 입력하세요." };

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE persona_secrets SET
         owner_title=?,
         category=?,
         importance=?,
         canonical_secret_text=?,
         suspected_fact_text=?,
         confirmed_fact_text=?,
         is_active=?,
         revision=revision+1,
         updated_at=datetime('now')
       WHERE id=? AND persona_id=?`
    ).run(
      input.ownerTitle != null ? input.ownerTitle.trim() : existing.owner_title,
      input.category ?? existing.category,
      input.importance ?? existing.importance,
      canonical,
      input.suspectedFactText != null
        ? input.suspectedFactText.trim()
        : existing.suspected_fact_text,
      confirmed,
      input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0,
      input.secretId,
      input.personaId
    );

    if (input.directDisclosureAliases != null || input.confirmedFactText != null) {
      const rule = db
        .prepare(
          `SELECT * FROM persona_secret_discovery_rules
           WHERE secret_id=? AND method='DIRECT_DISCLOSURE' AND rule_key='default'`
        )
        .get(input.secretId) as PersonaSecretDiscoveryRuleRow | undefined;
      const aliases =
        input.directDisclosureAliases ??
        (rule ? parseConditions(rule.conditions_json).aliases : []);
      const conditions: DirectDisclosureConditions = {
        aliases: aliases.map((a) => a.trim()).filter(Boolean),
        requires_first_person: true,
        requires_assertive_statement: true,
      };
      if (rule) {
        db.prepare(
          `UPDATE persona_secret_discovery_rules SET
             revealed_fact_text=?,
             conditions_json=?,
             updated_at=datetime('now')
           WHERE id=?`
        ).run(confirmed, JSON.stringify(conditions), rule.id);
      } else {
        db.prepare(
          `INSERT INTO persona_secret_discovery_rules (
             id, secret_id, method, rule_key, result_state, revealed_fact_text,
             conditions_json, priority, enabled
           ) VALUES (?,?,?,?,?,?,?,?,1)`
        ).run(
          randomUUID(),
          input.secretId,
          "DIRECT_DISCLOSURE",
          "default",
          "CONFIRMED",
          confirmed,
          JSON.stringify(conditions),
          0
        );
      }
    }
  });
  tx();

  const updated = listPersonaSecretsForEditor(input.personaId, db).find(
    (s) => s.id === input.secretId
  );
  if (!updated) return { ok: false, error: "비밀 수정에 실패했습니다." };
  return { ok: true, secret: updated };
}

/** Soft-delete — preserves evidence/knowledge history. */
export function deactivatePersonaSecret(
  personaId: number,
  secretId: string,
  db: Database.Database = getDb()
): boolean {
  ensurePersonaSecretDiscoverySchema(db);
  const info = db
    .prepare(
      `UPDATE persona_secrets SET is_active=0, updated_at=datetime('now')
       WHERE id=? AND persona_id=?`
    )
    .run(secretId, personaId);
  return info.changes > 0;
}

export function parseDirectDisclosureConditions(
  conditionsJson: string
): DirectDisclosureConditions {
  return parseConditions(conditionsJson);
}
