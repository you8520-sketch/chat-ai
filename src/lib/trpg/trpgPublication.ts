import type { TrpgVisibility } from "./types";

/** Runtime-only ending guidance when authored endingConditions are empty. Never persisted. */
export const TRPG_DEFAULT_ENDING_GUIDANCE =
  "플레이어 목표가 달성·포기·불가능해지고 현재 주요 갈등이 충분히 정리되면 자연스럽게 결말을 진행할 수 있다.";

export const WORLD_TRPG_PUBLIC_INTRO_REQUIRED =
  "TRPG 목록에 공개하려면 플레이어 공개 소개를 입력해 주세요.";

export const SCENARIO_PUBLIC_INTRO_REQUIRED =
  "TRPG 탭에 공개하려면 플레이어 공개 소개를 입력해 주세요.";

export function normalizePublicationText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

/** Legacy public TRPG worlds may keep an empty summary until the creator adds an intro. */
export function isLegacyPublicTrpgWorld(row: {
  trpg_enabled?: number | null;
  summary?: string | null;
}): boolean {
  return Number(row.trpg_enabled ?? 0) === 1 && !normalizePublicationText(row.summary);
}

export function validateWorldTrpgPublicationTransition(opts: {
  previousTrpgEnabled: boolean;
  nextTrpgEnabled: boolean;
  summary: string;
}): void {
  const intro = normalizePublicationText(opts.summary);
  const becomingPublic = !opts.previousTrpgEnabled && opts.nextTrpgEnabled;
  if (becomingPublic && !intro) {
    throw new Error(WORLD_TRPG_PUBLIC_INTRO_REQUIRED);
  }
}

/** Blocks only when visibility transitions to public without a player-facing intro. */
export function validateScenarioPublicationTransition(opts: {
  previousVisibility: TrpgVisibility;
  nextVisibility: TrpgVisibility;
  summary: string;
}): void {
  const intro = normalizePublicationText(opts.summary);
  const becomingPublic = opts.previousVisibility !== "public" && opts.nextVisibility === "public";
  if (becomingPublic && !intro) {
    throw new Error(SCENARIO_PUBLIC_INTRO_REQUIRED);
  }
}

export function mergeGmPrivateNotes(...parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const part of parts) {
    const text = normalizePublicationText(part);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    rows.push(text);
  }
  return rows.join("\n\n");
}
