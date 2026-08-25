import type Database from "better-sqlite3";
import { DEFAULT_TRPG_DICE_RULES } from "./types";
import {
  isLegacyDefaultDiceRules,
  parseTrpgDiceRules,
} from "./diceRules";

export type TrpgDiceRulesMigrationResult = {
  migrated: number;
  preserved: number;
};

function parseStoredJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Idempotent: legacy default snapshots → STANDARD V2. Custom rules stay. */
export function migrateLegacyDefaultDiceRules(db: Database.Database): TrpgDiceRulesMigrationResult {
  const rows = db
    .prepare(`SELECT campaign_id, dice_rules_json FROM trpg_scenarios`)
    .all() as Array<{ campaign_id: number; dice_rules_json: string }>;
  const update = db.prepare(`UPDATE trpg_scenarios SET dice_rules_json=? WHERE campaign_id=?`);
  let migrated = 0;
  let preserved = 0;
  for (const row of rows) {
    const parsed = parseTrpgDiceRules(parseStoredJson(row.dice_rules_json));
    if (!parsed) {
      preserved += 1;
      continue;
    }
    if (isLegacyDefaultDiceRules(parsed)) {
      update.run(JSON.stringify(DEFAULT_TRPG_DICE_RULES), row.campaign_id);
      migrated += 1;
      continue;
    }
    preserved += 1;
  }
  return { migrated, preserved };
}
