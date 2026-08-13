import { parseCharacterIds, TRPG_SCENARIO_MAX_BOTS } from "./scenarioTypes";

export function parseOptionalId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseCompanionIds(characterIds: unknown, characterId?: unknown): number[] {
  const extras = Array.isArray(characterIds) ? characterIds : [];
  const merged = characterId != null ? [...extras, characterId] : extras;
  const unique = new Set(
    merged.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0)
  );
  if (unique.size > TRPG_SCENARIO_MAX_BOTS) {
    throw new Error(`플레이어 캐릭터는 최대 ${TRPG_SCENARIO_MAX_BOTS}명입니다.`);
  }
  return parseCharacterIds(merged);
}
