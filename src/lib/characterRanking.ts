import type Database from "better-sqlite3";
import type { CharacterRow } from "@/components/CharacterCard";
import { listableWhere } from "@/lib/characterVisibility";

function listableWhereAliased(alias: string, extra = "1=1"): string {
  return `(${alias}.official=1 OR (${alias}.visibility='public' AND ${alias}.moderation_status='approved' AND ${alias}.creator_id IS NOT NULL)) AND (${extra})`;
}

export type RankingPeriod = "realtime" | "daily" | "weekly" | "monthly" | "all";

export const RANKING_PERIODS: { id: RankingPeriod; label: string; desc: string }[] = [
  { id: "realtime", label: "실시간", desc: "최근 6시간 대화 시작 수" },
  { id: "daily", label: "일간", desc: "최근 24시간" },
  { id: "weekly", label: "주간", desc: "최근 7일" },
  { id: "monthly", label: "월간", desc: "최근 30일" },
  { id: "all", label: "전체", desc: "누적 대화 턴" },
];

export type RankedCharacter = CharacterRow & { period_chats: number };

export function parseRankingPeriod(raw: string | undefined): RankingPeriod {
  if (raw && RANKING_PERIODS.some((p) => p.id === raw)) {
    return raw as RankingPeriod;
  }
  return "realtime";
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
    return db
      .prepare(
        `SELECT c.*, c.total_turns AS period_chats
         FROM characters c
         WHERE ${listableWhere()} ${filterSql}
         ORDER BY period_chats DESC, c.likes DESC
         LIMIT 50`
      )
      .all(...filterParams) as RankedCharacter[];
  }

  const since = chatSinceSql(period)!;
  return db
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
}

export function rankingPeriodLabel(period: RankingPeriod): string {
  return RANKING_PERIODS.find((p) => p.id === period)?.label ?? "랭킹";
}

export function rankingPeriodDesc(period: RankingPeriod): string {
  return RANKING_PERIODS.find((p) => p.id === period)?.desc ?? "";
}
