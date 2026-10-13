/**
 * Read-only audit: how many stored characters lose RP setting text to the injection cap.
 *
 *   node --conditions react-server --import tsx scripts/audit-character-setting-truncation.ts [db-path]
 *
 * Opens the database read-only, rebuilds each row's setting source exactly as the chat wire
 * does (`characterSettingInputForRow`), and compares the joined length with the legacy 10,000
 * cap and the current canonical cap. No writes, no provider calls, no translation backfill.
 */
import Database from "better-sqlite3";

import { characterSettingInputForRow, type CharacterSettingRow } from "@/lib/characterChunks";
import { estimateTokens } from "@/lib/tokenEstimate";
import { CHARACTER_SETTING_SOURCE_CHAR_CAP, joinedCharacterSettingSourceLength } from "@/utils/characterParser";

const LEGACY_CAP = 10_000;
const dbPath = process.argv[2] ?? "data/app.db";
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const rows = db
  .prepare(
    `SELECT id, name, gender, system_prompt, world, example_dialog, creator_compiled_description_json,
            appearance_raw, appearance_compiled, appearance_compiled_source_hash, appearance_compiled_version,
            official
     FROM characters`
  )
  .all() as (CharacterSettingRow & { official: number })[];

type Finding = { id: number; name: string; official: boolean; length: number; legacyLost: number; currentLost: number };
const findings: Finding[] = [];
for (const row of rows) {
  const length = joinedCharacterSettingSourceLength(characterSettingInputForRow(row));
  findings.push({
    id: row.id,
    name: row.name,
    official: row.official === 1,
    length,
    legacyLost: Math.max(0, length - LEGACY_CAP),
    currentLost: Math.max(0, length - CHARACTER_SETTING_SOURCE_CHAR_CAP),
  });
}

const over = (group: Finding[], key: "legacyLost" | "currentLost") => group.filter((f) => f[key] > 0);
const summarize = (label: string, group: Finding[]) => {
  const legacy = over(group, "legacyLost");
  console.log(
    JSON.stringify({
      group: label,
      characters: group.length,
      overLegacyCap: legacy.length,
      lostCharsLegacyTotal: legacy.reduce((sum, f) => sum + f.legacyLost, 0),
      maxLostLegacy: legacy.reduce((max, f) => Math.max(max, f.legacyLost), 0),
      approxTokensRecoveredMax: estimateTokens("가".repeat(legacy.reduce((max, f) => Math.max(max, f.legacyLost), 0))),
      stillLostUnderCurrentCap: over(group, "currentLost").length,
      maxLength: group.reduce((max, f) => Math.max(max, f.length), 0),
    })
  );
};
summarize("all", findings);
summarize("official", findings.filter((f) => f.official));
summarize("general", findings.filter((f) => !f.official));
for (const f of over(findings, "legacyLost").sort((a, b) => b.legacyLost - a.legacyLost).slice(0, 10)) {
  console.log(JSON.stringify(f));
}
db.close();
