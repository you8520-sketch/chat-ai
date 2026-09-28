import type { CodeHealthLedger, MonthlyCleanupReport, WeeklyCodeHealthReport } from "@/lib/codeHealth/types";
import { CODE_HEALTH_AUDIT_VERSION } from "@/lib/codeHealth/types";

export const CODE_HEALTH_LEDGER_WEEKLY_LIMIT = 12;
export const CODE_HEALTH_LEDGER_MONTHLY_LIMIT = 12;

export function emptyCodeHealthLedger(): CodeHealthLedger {
  return { version: CODE_HEALTH_AUDIT_VERSION, weekly: [], monthly: [] };
}

export function parseCodeHealthLedger(raw: string | null | undefined): CodeHealthLedger {
  if (!raw?.trim()) return emptyCodeHealthLedger();
  try {
    const parsed = JSON.parse(raw) as Partial<CodeHealthLedger>;
    return {
      version: CODE_HEALTH_AUDIT_VERSION,
      weekly: Array.isArray(parsed.weekly) ? parsed.weekly.filter((row) => row?.kind === "weekly") : [],
      monthly: Array.isArray(parsed.monthly)
        ? parsed.monthly.filter((row) => row?.kind === "monthly")
        : [],
    };
  } catch {
    return emptyCodeHealthLedger();
  }
}

export function prependWeekly(
  ledger: CodeHealthLedger,
  report: WeeklyCodeHealthReport
): CodeHealthLedger {
  return {
    version: CODE_HEALTH_AUDIT_VERSION,
    weekly: [report, ...ledger.weekly].slice(0, CODE_HEALTH_LEDGER_WEEKLY_LIMIT),
    monthly: ledger.monthly,
  };
}

export function prependMonthly(
  ledger: CodeHealthLedger,
  report: MonthlyCleanupReport
): CodeHealthLedger {
  return {
    version: CODE_HEALTH_AUDIT_VERSION,
    weekly: ledger.weekly,
    monthly: [report, ...ledger.monthly].slice(0, CODE_HEALTH_LEDGER_MONTHLY_LIMIT),
  };
}

export function latestWeekly(ledger: CodeHealthLedger): WeeklyCodeHealthReport | null {
  return ledger.weekly[0] ?? null;
}

export function latestMonthly(ledger: CodeHealthLedger): MonthlyCleanupReport | null {
  return ledger.monthly[0] ?? null;
}

export function weekliesSincePreviousMonthly(ledger: CodeHealthLedger): WeeklyCodeHealthReport[] {
  const lastMonthlyAt = ledger.monthly[0]?.ranAt;
  if (!lastMonthlyAt) return ledger.weekly.slice(0, 5);
  return ledger.weekly.filter((row) => row.ranAt > lastMonthlyAt).slice(0, 5);
}
