import type Database from "better-sqlite3";
import type { CharacterRow } from "@/components/CharacterCard";
import { listableWhere } from "@/lib/characterVisibility";
import { decorateCharactersWithCreatorTiers } from "@/lib/creatorTierBadges";

function listableWhereAliased(alias: string, extra = "1=1"): string {
  return `(${alias}.official=1 OR (${alias}.visibility='public' AND ${alias}.moderation_status='approved' AND ${alias}.creator_id IS NOT NULL)) AND (${extra})`;
}

export type RankingPeriod = "realtime" | "daily" | "weekly" | "monthly" | "all";

export const DEFAULT_RANKING_PERIOD: RankingPeriod = "all";

export const RANKING_PERIODS: { id: RankingPeriod; label: string; desc: string; window: string | null }[] = [
  { id: "all", label: "전체", desc: "누적 대화 턴", window: null },
  { id: "realtime", label: "실시간", desc: "최근 6시간 대화 시작 수", window: "최근 6시간" },
  { id: "daily", label: "일간", desc: "최근 24시간", window: "최근 24시간" },
  { id: "weekly", label: "주간", desc: "최근 7일", window: "최근 7일" },
  { id: "monthly", label: "월간", desc: "최근 30일", window: "최근 30일" },
];

/**
 * Display copy for `period_chats`. The same column holds different quantities:
 * `all` is cumulative chat turns (total_turns); every other period counts chats started in its window.
 */
export function rankingMetric(period: RankingPeriod): { label: string; unit: string; basis: string } {
  if (period === "all") {
    return { label: "누적 대화", unit: "턴", basis: "누적 대화 턴 수 기준" };
  }
  const window = RANKING_PERIODS.find((p) => p.id === period)?.window ?? "";
  return { label: "대화 시작", unit: "회", basis: `${window} 동안 대화가 시작된 횟수 기준` };
}

export type RankedCharacter = CharacterRow & { period_chats: number };

export function parseRankingPeriod(raw: string | undefined): RankingPeriod {
  if (raw && RANKING_PERIODS.some((p) => p.id === raw)) {
    return raw as RankingPeriod;
  }
  return DEFAULT_RANKING_PERIOD;
}

function chatSinceSql(period: RankingPeriod): string | null {
  switch (period) {
    case "realtime":
      return "datetime('now', '-6 hours')";
    case "daily":
      return "datetime('now', '-1 day')";
    case "weekly":
      return "datetime('now', '-7 days')";
    case "monthly":
      return "datetime('now', '-30 days')";
    default:
      return null;
  }
}

/** 기간별 캐릭터 대화량 랭킹 (대화 시작 = chats 행 기준) */
export function fetchCharacterRanking(
  db: Database.Database,
  period: RankingPeriod,
  filterSql: string,
  filterParams: unknown[]
): RankedCharacter[] {
  if (period === "all") {
    const rows = db
      .prepare(
        `SELECT c.*, c.total_turns AS period_chats
         FROM characters c
         WHERE ${listableWhere()} ${filterSql}
         ORDER BY period_chats DESC, c.likes DESC
         LIMIT 50`
      )
      .all(...filterParams) as RankedCharacter[];
    return decorateCharactersWithCreatorTiers(db, rows);
  }

  const since = chatSinceSql(period)!;
  const rows = db
    .prepare(
      `SELECT c.*, COUNT(ch.id) AS period_chats
       FROM characters c
       INNER JOIN chats ch ON ch.character_id = c.id AND ch.created_at >= ${since}
       WHERE ${listableWhereAliased("c")} ${filterSql}
       GROUP BY c.id
       ORDER BY period_chats DESC, c.likes DESC
       LIMIT 50`
    )
    .all(...filterParams) as RankedCharacter[];
  return decorateCharactersWithCreatorTiers(db, rows);
}

export function rankingPeriodDesc(period: RankingPeriod): string {
  return RANKING_PERIODS.find((p) => p.id === period)?.desc ?? "";
}

export function rankingEmptyMessage(period: RankingPeriod): string {
  const window = RANKING_PERIODS.find((p) => p.id === period)?.window;
  return window
    ? `${window} 동안 대화가 시작된 캐릭터가 없습니다.`
    : "아직 랭킹에 표시할 캐릭터가 없습니다.";
}
