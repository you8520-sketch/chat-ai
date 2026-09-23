import type { SchedulerJobName } from "@/lib/schedulerDefinitions";

export type SchedulerRunStatus =
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "STALE_BLOCKED";

export type SchedulerTriggerKind =
  | "cron"
  | "boot_recovery"
  | "runtime_recovery"
  | "manual";

export type SchedulerSlotResolution = {
  slotKey: string;
  due: boolean;
  scheduledAtUtcMs: number;
};

export type SchedulerRunObservation = {
  status: SchedulerRunStatus;
  trigger_kind: SchedulerTriggerKind;
  attempt_count: number;
  started_at: string;
  heartbeat_at: string;
  finished_at: string | null;
  last_error: string;
};

export type SchedulerRunOverviewState =
  | SchedulerRunStatus
  | "STALE"
  | "MISSING"
  | "DISABLED"
  | "PRE_ACTIVATION";

export type SchedulerRunOverview = {
  jobName: SchedulerJobName;
  label: string;
  cronExpression: string;
  currentSlotKey: string;
  activated: boolean;
  state: SchedulerRunOverviewState;
  latest: SchedulerRunObservation | null;
  current: SchedulerRunObservation | null;
};
