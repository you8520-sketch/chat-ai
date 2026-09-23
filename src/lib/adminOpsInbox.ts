import type Database from "better-sqlite3";
import {
  ensurePayoutTransferAttemptsSchema,
  type PayoutAttemptState,
} from "@/lib/payoutTransferAttempts";
import {
  ensurePointChargeRefundAttemptsSchema,
  type PointChargeRefundAttemptState,
} from "@/lib/pointChargeRefundAttempts";
import { listSchedulerRunOverview } from "@/lib/schedulerRunRegistry";
import type { SchedulerRunOverviewState } from "@/lib/schedulerRunShared";
import {
  ADMIN_OPS_STUCK_EXECUTION_MINUTES,
  type AdminOpsIncident,
  type AdminOpsIncidentSeverity,
} from "@/lib/adminOpsInboxShared";

type PayoutOpsRow = {
  withdrawal_id: number;
  state: PayoutAttemptState;
  failure_code: string;
  failure_message: string;
  claimed_at: string;
  dispatched_at: string | null;
};

type PointRefundOpsRow = {
  charge_batch_id: number;
  state: PointChargeRefundAttemptState;
  provider_status: string;
  failure_code: string;
  failure_message: string;
  claimed_at: string;
  dispatched_at: string | null;
};

const SCHEDULER_INCIDENT_STATES = new Set<SchedulerRunOverviewState>([
  "FAILED",
  "STALE",
  "STALE_BLOCKED",
  "MISSING",
]);

function parseSqliteUtcMs(value: string | null | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes("T")
    ? trimmed.endsWith("Z")
      ? trimmed
      : `${trimmed}Z`
    : `${trimmed.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageMinutes(nowMs: number, value: string | null | undefined): number | null {
  const then = parseSqliteUtcMs(value);
  if (then == null) return null;
  return Math.max(0, Math.floor((nowMs - then) / 60_000));
}

function isStuck(age: number | null): boolean {
  return age != null && age >= ADMIN_OPS_STUCK_EXECUTION_MINUTES;
}

function severityRank(severity: AdminOpsIncidentSeverity): number {
  return severity === "critical" ? 0 : 1;
}

function cleanReason(code: string, message: string, fallback: string): string {
  const parts = [code.trim(), message.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : fallback;
}

function schedulerIncidentSummary(
  state: SchedulerRunOverviewState,
  lastError: string
): string {
  if (lastError.trim()) return lastError.trim();
  switch (state) {
    case "FAILED":
      return "스케줄 작업이 실패 상태로 남아 있습니다.";
    case "STALE":
      return "heartbeat가 canonical stale 기준을 넘었습니다. recovery 정책 판정 대상입니다.";
    case "STALE_BLOCKED":
      return "자동 stale reclaim이 허용되지 않는 작업이라 수동 확인이 필요합니다.";
    case "MISSING":
      return "registry 적용 이후 latest-due slot 실행 기록이 없습니다.";
    default:
      return "운영 확인이 필요한 스케줄 상태입니다.";
  }
}

export function listAdminOpsIncidents(
  db: Database.Database,
  now: Date = new Date(),
  limit = 200
): AdminOpsIncident[] {
  ensurePayoutTransferAttemptsSchema(db);
  ensurePointChargeRefundAttemptsSchema(db);

  const nowMs = now.getTime();
  const incidents: AdminOpsIncident[] = [];

  for (const run of listSchedulerRunOverview(db, now)) {
    if (!SCHEDULER_INCIDENT_STATES.has(run.state)) continue;
    const observed = run.current ?? run.latest;
    const occurredAt =
      observed?.finished_at ?? observed?.heartbeat_at ?? observed?.started_at ?? "";
    incidents.push({
      id: `scheduler:${run.jobName}:${run.currentSlotKey}`,
      source: "scheduler",
      severity:
        run.state === "FAILED" || run.state === "STALE_BLOCKED" ? "critical" : "warning",
      state: run.state,
      title: `${run.label} · ${run.state}`,
      summary: schedulerIncidentSummary(run.state, observed?.last_error ?? ""),
      sourceRef: `${run.jobName}/${run.currentSlotKey}`,
      occurredAt,
      ageMinutes: ageMinutes(nowMs, occurredAt),
      href: "/admin/finance",
    });
  }

  const payoutRows = db
    .prepare(
      `SELECT withdrawal_id, state, failure_code, failure_message, claimed_at, dispatched_at
       FROM payout_transfer_attempts
       WHERE state IN ('CLAIMED','DISPATCHED','RECONCILIATION_REQUIRED')
       ORDER BY id DESC
       LIMIT 500`
    )
    .all() as PayoutOpsRow[];

  for (const row of payoutRows) {
    const occurredAt = row.dispatched_at ?? row.claimed_at;
    const age = ageMinutes(nowMs, occurredAt);
    if (row.state !== "RECONCILIATION_REQUIRED" && !isStuck(age)) continue;

    const summary =
      row.state === "RECONCILIATION_REQUIRED"
        ? cleanReason(
            row.failure_code,
            row.failure_message,
            "provider 결과가 확정되지 않았습니다. 자동 재송금 없이 lookup/reconciliation만 허용됩니다."
          )
        : row.state === "DISPATCHED"
          ? "provider 경계를 지난 상태가 오래 지속 중입니다. 자동 재송금은 금지되며 canonical payout lookup으로 확인해야 합니다."
          : "송금 claim 후 provider dispatch 전 상태가 오래 지속 중입니다. canonical payout execution만 재개 owner입니다.";

    incidents.push({
      id: `payout:${row.withdrawal_id}`,
      source: "payout",
      severity: row.state === "CLAIMED" ? "warning" : "critical",
      state: row.state,
      title: `크리에이터 출금 #${row.withdrawal_id} · ${row.state}`,
      summary,
      sourceRef: `withdrawal:${row.withdrawal_id}`,
      occurredAt,
      ageMinutes: age,
      href: "/admin/payout",
    });
  }

  const refundRows = db
    .prepare(
      `SELECT charge_batch_id, state, provider_status, failure_code, failure_message,
              claimed_at, dispatched_at
       FROM point_charge_refund_attempts
       WHERE state IN ('CLAIMED','DISPATCHED','REQUESTED','RECONCILIATION_REQUIRED')
       ORDER BY id DESC
       LIMIT 500`
    )
    .all() as PointRefundOpsRow[];

  for (const row of refundRows) {
    const occurredAt = row.dispatched_at ?? row.claimed_at;
    const age = ageMinutes(nowMs, occurredAt);
    if (row.state !== "RECONCILIATION_REQUIRED" && !isStuck(age)) continue;

    const summary =
      row.state === "RECONCILIATION_REQUIRED"
        ? cleanReason(
            row.failure_code,
            row.failure_message,
            "PortOne 환불 결과를 확정할 수 없어 lookup/reconciliation이 필요합니다."
          )
        : row.state === "REQUESTED"
          ? cleanReason(
              row.provider_status,
              "",
              "PortOne 환불 요청이 장시간 pending입니다. 충전 포인트 hold가 유지될 수 있습니다."
            )
          : row.state === "DISPATCHED"
            ? "환불 provider 경계를 지난 상태가 오래 지속 중입니다. 중복 취소 없이 canonical lookup 경로로 확인해야 합니다."
            : "환불 claim과 포인트 hold 이후 provider dispatch 전 상태가 오래 지속 중입니다.";

    incidents.push({
      id: `point_refund:${row.charge_batch_id}`,
      source: "point_refund",
      severity: row.state === "REQUESTED" ? "warning" : "critical",
      state: row.state,
      title: `포인트 결제 환불 배치 #${row.charge_batch_id} · ${row.state}`,
      summary,
      sourceRef: `charge_batch:${row.charge_batch_id}`,
      occurredAt,
      ageMinutes: age,
      href: null,
    });
  }

  const capped = Math.min(Math.max(1, Math.floor(limit)), 500);
  return incidents
    .sort((a, b) => {
      const severityDelta = severityRank(a.severity) - severityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      const ageDelta = (b.ageMinutes ?? -1) - (a.ageMinutes ?? -1);
      if (ageDelta !== 0) return ageDelta;
      return a.id.localeCompare(b.id);
    })
    .slice(0, capped);
}
