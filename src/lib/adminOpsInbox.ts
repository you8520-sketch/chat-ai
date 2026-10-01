import type Database from "better-sqlite3";
import type { GithubAutomationProjection } from "@/lib/adminAutomationReports";
import type { FinanceAnomalyReport } from "@/lib/financeAnomalyRadar";
import { buildOpenRouterContractWatchProjection } from "@/lib/openRouterContractWatch";
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
import { WEB_PUSH_MAX_ATTEMPTS } from "@/lib/webPush";
import {
  ADMIN_OPS_STUCK_EXECUTION_MINUTES,
  type AdminOpsIncident,
  type AdminOpsIncidentSeverity,
} from "@/lib/adminOpsInboxShared";
import {
  displayDeploymentSha,
  listOpsRequestIncidentRows,
} from "@/lib/opsRequestIncidents";

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

type WebPushOpsRow = {
  id: number;
  attempts: number;
  claim_token: string | null;
  claimed_until: string | null;
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

const GITHUB_AUTOMATION_IGNORED_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
const GITHUB_AUTOMATION_CRITICAL_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "startup_failure",
  "action_required",
]);

export function projectFinanceAnomalyIncidents(
  report: FinanceAnomalyReport,
  now: Date = new Date()
): AdminOpsIncident[] {
  const nowMs = now.getTime();
  return report.anomalies.map((anomaly) => ({
    id: `finance:${anomaly.id}`,
    source: "finance" as const,
    severity: anomaly.severity,
    state: anomaly.code,
    title: anomaly.title,
    summary: anomaly.summary,
    sourceRef: anomaly.sourceRef,
    occurredAt: report.generatedAt,
    ageMinutes: ageMinutes(nowMs, report.generatedAt),
    href: anomaly.href,
  }));
}

export function projectGithubAutomationIncidents(
  projection: GithubAutomationProjection,
  now: Date = new Date()
): AdminOpsIncident[] {
  if (projection.status !== "OK") return [];
  const nowMs = now.getTime();
  const incidents: AdminOpsIncident[] = [];

  for (const group of projection.groups) {
    const run = group.latest;
    if (run.status !== "completed") continue;
    const conclusion = (run.conclusion ?? "").trim().toLowerCase();
    if (!conclusion || GITHUB_AUTOMATION_IGNORED_CONCLUSIONS.has(conclusion)) continue;

    const severity: AdminOpsIncidentSeverity =
      GITHUB_AUTOMATION_CRITICAL_CONCLUSIONS.has(conclusion) ? "critical" : "warning";
    const occurredAt = run.updatedAt || run.createdAt;
    incidents.push({
      id: `github_automation:${group.key}`,
      source: "github_automation",
      severity,
      state: conclusion.toUpperCase(),
      title: `${group.name} · ${conclusion}`,
      summary:
        `최신 scheduled run #${run.runNumber}이 ${conclusion} 상태로 종료되었습니다. ` +
        "자동 재실행은 하지 않으며 기존 자동화 보고서/워크플로에서 원인을 확인해야 합니다.",
      sourceRef: `${group.path} / run #${run.runNumber}`,
      occurredAt,
      ageMinutes: ageMinutes(nowMs, occurredAt),
      href: run.htmlUrl || "/admin/automation-reports",
    });
  }

  return incidents;
}

export function mergeAdminOpsIncidents(
  groups: readonly (readonly AdminOpsIncident[])[],
  limit = 200
): AdminOpsIncident[] {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 500);
  return groups
    .flatMap((group) => [...group])
    .sort((a, b) => {
      const severityDelta = severityRank(a.severity) - severityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      const ageDelta = (b.ageMinutes ?? -1) - (a.ageMinutes ?? -1);
      if (ageDelta !== 0) return ageDelta;
      return a.id.localeCompare(b.id);
    })
    .slice(0, capped);
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

  const webPushRows = db
    .prepare(
      `SELECT id, attempts, claim_token, claimed_until
         FROM web_push_outbox
        WHERE sent_at IS NULL
          AND (
            attempts >= 3
            OR (claim_token IS NOT NULL AND claimed_until IS NOT NULL)
          )
        ORDER BY id DESC
        LIMIT 500`
    )
    .all() as WebPushOpsRow[];

  for (const row of webPushRows) {
    if (row.attempts >= WEB_PUSH_MAX_ATTEMPTS) {
      incidents.push({
        id: `web_push:${row.id}`,
        source: "web_push",
        severity: "critical",
        state: "EXHAUSTED",
        title: `웹푸시 outbox #${row.id} · EXHAUSTED`,
        summary:
          `웹푸시 전송이 최대 ${WEB_PUSH_MAX_ATTEMPTS}회 시도 후 소진되어 자동 재시도가 중단되었습니다. ` +
          "canonical outbox row를 확인해야 합니다.",
        sourceRef: `outbox:${row.id} / attempts=${row.attempts}`,
        occurredAt: "",
        ageMinutes: null,
        href: null,
      });
      continue;
    }

    if (row.attempts >= 3) {
      incidents.push({
        id: `web_push:${row.id}`,
        source: "web_push",
        severity: "warning",
        state: "REPEATED_FAILURE",
        title: `웹푸시 outbox #${row.id} · 반복 실패`,
        summary:
          `웹푸시 전송이 ${row.attempts}회 실패했습니다. ` +
          "다음 재시도 시점과 backoff는 canonical outbox가 계속 소유합니다.",
        sourceRef: `outbox:${row.id} / attempts=${row.attempts}`,
        occurredAt: "",
        ageMinutes: null,
        href: null,
      });
      continue;
    }

    const staleAge = ageMinutes(nowMs, row.claimed_until);
    if (row.claim_token && isStuck(staleAge)) {
      incidents.push({
        id: `web_push:${row.id}`,
        source: "web_push",
        severity: "warning",
        state: "STALE_CLAIM",
        title: `웹푸시 outbox #${row.id} · stale claim`,
        summary:
          "claim lease가 만료된 뒤에도 장시간 row가 남아 있습니다. 정상 delivery wake라면 stale reclaim 대상입니다.",
        sourceRef: `outbox:${row.id}`,
        occurredAt: row.claimed_until ?? "",
        ageMinutes: staleAge,
        href: null,
      });
    }
  }

  const contractWatch = buildOpenRouterContractWatchProjection(db, now);
  if (contractWatch.quoteReviewRecommended) {
    const coverage =
      contractWatch.exactCallCoverageRatio == null
        ? "exact coverage unavailable"
        : `exact call coverage ${(contractWatch.exactCallCoverageRatio * 100).toFixed(1)}%`;
    incidents.push({
      id: "procurement:openrouter-contract-review",
      source: "procurement",
      severity: "warning",
      state: contractWatch.status,
      title: "OpenRouter 계약/견적 검토 시점",
      summary:
        `최근 ${contractWatch.windowDays}일 OpenRouter-addressable settled exact AI spend가 ` +
        `${contractWatch.settledExactUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}로 ` +
        `내부 견적 검토 marker ${contractWatch.reviewMarkerUsd.toLocaleString("en-US")}를 넘었습니다. ` +
        `OpenRouter Enterprise 자격 확정이 아니라 영업 견적을 받아 현재 조달비와 비교할 시점이라는 알림입니다. ` +
        coverage,
      sourceRef:
        `rolling-${contractWatch.windowDays}d settled-exact / ` +
        `providers=${contractWatch.providers.join(",") || "none"}`,
      occurredAt: contractWatch.windowEnd,
      ageMinutes: ageMinutes(nowMs, contractWatch.windowEnd),
      href: "/admin/pricing",
    });
  }

  for (const row of listOpsRequestIncidentRows(db)) {
    const firstSha = displayDeploymentSha(row.first_deployment_sha);
    const latestSha = displayDeploymentSha(row.latest_deployment_sha);
    incidents.push({
      id: `request:${row.signature}`,
      source: "request",
      severity: "critical",
      state: "OBSERVED",
      title: `${row.route_template} · ${row.error_class}`,
      summary:
        `${row.subsystem} 서버 실패가 ${row.occurrence_count}회 관측되었습니다. ` +
        `첫 배포 ${firstSha}, 최근 배포 ${latestSha}. ` +
        "자동 재시도·복구는 하지 않습니다.",
      sourceRef: row.signature,
      occurredAt: row.last_seen_at,
      ageMinutes: ageMinutes(nowMs, row.last_seen_at),
      href: null,
    });
  }

  return mergeAdminOpsIncidents([incidents], limit);
}
