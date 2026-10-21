import type { AutomationCoverageState } from "@/lib/adminAutomationCoverage";
import type { SchedulerRunOverviewState } from "@/lib/schedulerRunShared";

/**
 * Leaf owner for how admin automation status is named and judged.
 * Shared by the automation report page, the registered-vs-displayed coverage
 * section, and the Ops Inbox so one event is never worded or ranked two ways.
 * Pure: no I/O, no workflow reruns, no state writes.
 */

const AUTOMATION_NAME_KO: Readonly<Record<string, string>> = {
  ".github/workflows/code-health-weekly-audit.yml": "주간 코드 상태 점검",
  ".github/workflows/code-health-monthly-cleanup.yml": "월간 코드 정리 후보 점검",
  ".github/workflows/decision-model-radar-weekly.yml": "주간 의사결정 모델 조사",
  ".github/workflows/domain-ssl-monitor.yml": "도메인·SSL 감시",
  ".github/workflows/main-rp-monthly-cache-audit.yml": "월간 메인 RP 캐시 경제성 점검",
  ".github/workflows/main-rp-supply-radar.yml": "메인 RP 공급처 조사",
  ".github/workflows/memory-research-cycle.yml": "기억력 개선 연구",
  ".github/workflows/validate-rp-active-model-quality.yml": "활성 RP 모델 품질 검증",
};

/** Korean name for a known workflow; unknown workflows keep their registered name. */
export function automationDisplayName(path: string, fallbackName: string): string {
  return AUTOMATION_NAME_KO[path] ?? fallbackName;
}

export const GITHUB_RUN_IGNORED_CONCLUSIONS: ReadonlySet<string> = new Set([
  "success",
  "neutral",
  "skipped",
]);

const GITHUB_RUN_CRITICAL_CONCLUSIONS: ReadonlySet<string> = new Set([
  "failure",
  "timed_out",
  "startup_failure",
  "action_required",
]);

export type GithubRunSeverity = "critical" | "warning";

export function githubRunSeverity(conclusion: string): GithubRunSeverity {
  return GITHUB_RUN_CRITICAL_CONCLUSIONS.has(conclusion.trim().toLowerCase())
    ? "critical"
    : "warning";
}

/** Meaning of a GitHub Actions run outcome. Says nothing about audit findings. */
export function githubRunConclusionLabel(
  conclusion: string | null,
  status: string | null = null
): string {
  const normalized = (conclusion ?? "").trim().toLowerCase();
  switch (normalized) {
    case "success":
      return "성공";
    case "failure":
      return "실행 실패";
    case "cancelled":
      return "실행 취소";
    case "timed_out":
      return "시간 초과";
    case "startup_failure":
      return "시작 실패";
    case "action_required":
      return "승인 필요";
    case "skipped":
      return "건너뜀";
    case "neutral":
      return "중립";
    case "":
      break;
    default:
      return normalized;
  }
  switch ((status ?? "").trim().toLowerCase()) {
    case "in_progress":
      return "실행 중";
    case "queued":
    case "waiting":
    case "pending":
      return "대기 중";
    default:
      return "기록 없음";
  }
}

export function isGithubRunInProgress(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "in_progress" || normalized === "queued" || normalized === "waiting";
}

export function coverageStateLabel(state: AutomationCoverageState): string {
  switch (state) {
    case "OK":
      return "정상";
    case "FAILED":
      return "실행 실패";
    case "STALE":
      return "최신 확인 필요";
    case "NOT_RUN":
      return "실행 기록 없음";
    case "UNAVAILABLE":
      return "조회 불가";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** Ledger audit verdicts (Code Health). A FAILED verdict is a finding, not a failed run. */
export function auditStatusLabel(
  status: "SUCCESS" | "WARNING" | "FAILED" | "EMPTY" | "UNAVAILABLE"
): string {
  switch (status) {
    case "SUCCESS":
      return "점검 결과: 정상";
    case "WARNING":
      return "점검 결과: 주의";
    case "FAILED":
      return "점검 결과: 문제 발견";
    case "EMPTY":
      return "실행 기록 없음";
    case "UNAVAILABLE":
      return "조회 불가";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function decisionRadarStatusLabel(
  status: "NO_CHANGE" | "BENCHMARKED" | "REVIEW_CANDIDATE" | "PARTIAL" | "FAILED"
): string {
  switch (status) {
    case "NO_CHANGE":
      return "변경 없음";
    case "BENCHMARKED":
      return "비교 완료";
    case "REVIEW_CANDIDATE":
      return "검토 후보 있음";
    case "PARTIAL":
      return "일부 완료";
    case "FAILED":
      return "실패";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function schedulerStateLabel(state: SchedulerRunOverviewState): string {
  switch (state) {
    case "RUNNING":
      return "실행 중";
    case "SUCCEEDED":
      return "정상";
    case "FAILED":
      return "실패";
    case "STALE_BLOCKED":
      return "수동 확인 필요";
    case "STALE":
      return "최신 확인 필요";
    case "MISSING":
      return "실행 기록 없음";
    case "DISABLED":
      return "비활성";
    case "PRE_ACTIVATION":
      return "활성화 전";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export const SCHEDULER_INCIDENT_STATES: ReadonlySet<SchedulerRunOverviewState> = new Set([
  "FAILED",
  "STALE",
  "STALE_BLOCKED",
  "MISSING",
]);

export function schedulerIncidentSeverity(
  state: SchedulerRunOverviewState
): "critical" | "warning" {
  return state === "FAILED" || state === "STALE_BLOCKED" ? "critical" : "warning";
}

export function schedulerIncidentSummary(
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

export function formatKstDateTime(value: string | null | undefined): string {
  if (!value) return "기록 없음";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
