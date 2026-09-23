export const SCHEDULER_TIMEZONE = "Asia/Seoul" as const;
export const SCHEDULER_RECOVERY_POLL_MS = 5 * 60 * 1000;

export const SCHEDULER_DEFINITIONS = {
  finance_daily: {
    label: "운영비·원가 일일 집계",
    cadence: "daily",
    hour: 12,
    minute: 0,
    safeFailedRetry: true,
    safeStaleReclaim: true,
    staleAfterMinutes: 90,
  },
  payout_monthly: {
    label: "크리에이터 월간 출금 배치",
    cadence: "monthly",
    dayOfMonth: 15,
    hour: 3,
    minute: 0,
    safeFailedRetry: true,
    safeStaleReclaim: true,
    staleAfterMinutes: 180,
  },
  training_daily: {
    label: "RP 품질 일일 분석",
    cadence: "daily",
    hour: 4,
    minute: 0,
    safeFailedRetry: false,
    safeStaleReclaim: false,
    staleAfterMinutes: 180,
  },
  training_weekly: {
    label: "RP 학습 주간 export",
    cadence: "weekly",
    dayOfWeek: 0,
    hour: 5,
    minute: 0,
    safeFailedRetry: false,
    safeStaleReclaim: false,
    staleAfterMinutes: 180,
  },
} as const;

export type SchedulerJobName = keyof typeof SCHEDULER_DEFINITIONS;
export type SchedulerDefinition = (typeof SCHEDULER_DEFINITIONS)[SchedulerJobName];

export function schedulerCronExpression(jobName: SchedulerJobName): string {
  const definition = SCHEDULER_DEFINITIONS[jobName];
  switch (definition.cadence) {
    case "daily":
      return `${definition.minute} ${definition.hour} * * *`;
    case "monthly":
      return `${definition.minute} ${definition.hour} ${definition.dayOfMonth} * *`;
    case "weekly":
      return `${definition.minute} ${definition.hour} * * ${definition.dayOfWeek}`;
    default: {
      const _exhaustive: never = definition;
      return _exhaustive;
    }
  }
}
