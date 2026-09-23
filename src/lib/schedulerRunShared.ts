import type { SchedulerJobName } from "@/lib/schedulerDefinitions";

export type SchedulerRunStatus =
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "STALE_BLOCKED";

export type SchedulerTriggerKind = "cron" | "boot_recovery" | "manual";

export type SchedulerRunRow = {
  id: number;
  job_name: SchedulerJobName;
  slot_key: string;
  status: SchedulerRunStatus;
  trigger_kind: SchedulerTriggerKind;
  execution_token: string;
  attempt_count: number;
  started_at: string;
  heartbeat_at: string;
  finished_at: string | null;
  last_error: string;
  result_json: string;
};

export type SchedulerRunOverviewState =
  | SchedulerRunStatus
  | "MISSING"
  | "NOT_DUE"
  | "PRE_ACTIVATION";

export type SchedulerRunOverview = {
  jobName: SchedulerJobName;
  label: string;
  cronExpression: string;
  currentSlotKey: string;
  due: boolean;
  activated: boolean;
  state: SchedulerRunOverviewState;
  latest: SchedulerRunRow | null;
  current: SchedulerRunRow | null;
};
