/**
 * Read-only audit: how many stored characters lose RP setting text to the injection cap.
 *
 *   node --conditions react-server --import tsx scripts/audit-character-setting-truncation.ts [db-path]
 *
 * Opens the database read-only, rebuilds each row's setting source exactly as the chat wire
 * does (`characterSettingInputForRow`), and compares the joined length with the legacy 10,000
 * cap and the current canonical cap. No writes, no provider calls, no translation backfill.
 *
 * Output is aggregate-only: counts, character-length distribution, token and list-price
 * deltas per Main RP model. Character ids, names and text are never printed, so the output
 * can leave a production container.
 */
import Database from "better-sqlite3";

import { characterSettingInputForRow, type CharacterSettingRow } from "@/lib/characterChunks";
import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
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

type Finding = { official: boolean; length: number; legacyLost: number; currentLost: number };
const findings: Finding[] = rows.map((row) => {
  const length = joinedCharacterSettingSourceLength(characterSettingInputForRow(row));
  return {
    official: row.official === 1,
    length,
    legacyLost: Math.max(0, length - LEGACY_CAP),
    currentLost: Math.max(0, length - CHARACTER_SETTING_SOURCE_CHAR_CAP),
  };
});

const LENGTH_BUCKETS = [5_000, 8_000, 10_000, 12_000, 14_000, CHARACTER_SETTING_SOURCE_CHAR_CAP] as const;
const bucketOf = (length: number): string => {
  const upper = LENGTH_BUCKETS.find((limit) => length <= limit);
  return upper === undefined ? `>${CHARACTER_SETTING_SOURCE_CHAR_CAP}` : `<=${upper}`;
};
const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

/** Recovered input tokens per turn for a character whose tail is no longer cut (`legacyLost` chars). */
const recoveredTokens = (f: Finding): number => (f.legacyLost > 0 ? estimateTokens("가".repeat(f.legacyLost)) : 0);

const summarize = (label: string, group: Finding[]) => {
  const legacy = group.filter((f) => f.legacyLost > 0);
  const stillLost = group.filter((f) => f.currentLost > 0);
  const tokens = legacy.map(recoveredTokens).sort((a, b) => a - b);
  const distribution: Record<string, number> = {};
  for (const f of group) distribution[bucketOf(f.length)] = (distribution[bucketOf(f.length)] ?? 0) + 1;
  console.log(
    JSON.stringify({
      group: label,
      characters: group.length,
      overLegacyCap10000: legacy.length,
      lostCharsLegacyTotal: legacy.reduce((sum, f) => sum + f.legacyLost, 0),
      maxLostLegacy: legacy.reduce((max, f) => Math.max(max, f.legacyLost), 0),
      stillLostUnderCurrentCap: stillLost.length,
      lostCharsUnderCurrentCapTotal: stillLost.reduce((sum, f) => sum + f.currentLost, 0),
      maxLength: group.reduce((max, f) => Math.max(max, f.length), 0),
      lengthDistribution: distribution,
      recoveredTokensPerTurn: {
        total: tokens.reduce((sum, t) => sum + t, 0),
        mean: tokens.length === 0 ? 0 : Math.round(tokens.reduce((sum, t) => sum + t, 0) / tokens.length),
        p50: percentile(tokens, 0.5),
        p90: percentile(tokens, 0.9),
        max: tokens[tokens.length - 1] ?? 0,
      },
    })
  );
};
summarize("all", findings);
summarize("official", findings.filter((f) => f.official));
summarize("general", findings.filter((f) => !f.official));

const affected = findings.filter((f) => f.legacyLost > 0);
const meanTokens = affected.length === 0 ? 0 : affected.reduce((sum, f) => sum + recoveredTokens(f), 0) / affected.length;
const maxTokens = affected.reduce((max, f) => Math.max(max, recoveredTokens(f)), 0);
for (const modelId of MAIN_RP_MODEL_IDS) {
  const pricing = getPublishedPricing(modelId);
  const inputRate = pricing.billingReferenceInputUsdPerMillion;
  const cacheRate = pricing.billingReferenceCacheReadUsdPerMillion ?? inputRate;
  console.log(
    JSON.stringify({
      model: modelId,
      pricingPublishedAt: pricing.publishedAt,
      affectedCharacters: affected.length,
      usdPerTurnPerAffectedCharacter: {
        uncachedMean: (meanTokens * inputRate) / 1_000_000,
        uncachedMax: (maxTokens * inputRate) / 1_000_000,
        cacheReadMean: (meanTokens * cacheRate) / 1_000_000,
      },
      usdPer1000TurnsUncachedMean: (meanTokens * inputRate) / 1_000,
    })
  );
}
db.close();
