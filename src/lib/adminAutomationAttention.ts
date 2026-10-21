import type {
  GithubAutomationProjection,
  GithubScheduledAutomationGroup,
  GithubSupplyAutoDraftProjection,
} from "@/lib/adminAutomationReports";
import type { AutomationCoverageView } from "@/lib/adminAutomationCoverage";
import {
  auditStatusLabel,
  automationDisplayName,
  codeHealthLedgerActionReason,
  decisionRadarStatusLabel,
  githubRunAutoAttentionCopy,
  githubRunConclusionLabel,
  githubRunSeverity,
  isGithubRunInProgress,
  SCHEDULER_INCIDENT_STATES,
  schedulerIncidentSeverity,
  schedulerIncidentSummary,
  schedulerStateLabel,
} from "@/lib/adminAutomationStatus";
import {
  MEMORY_RESEARCH_WORKFLOW_PATH,
  type MemoryResearchAdminProjection,
} from "@/lib/adminMemoryResearchReports";
import {
  definitionStaleAfterHours,
  type ScheduledWorkflowDefinition,
} from "@/lib/codeHealth/automationHealth";
import type { CodeHealthAdminCard, CodeHealthAdminProjection } from "@/lib/codeHealth/reports";
import {
  CODE_HEALTH_MONTHLY_WORKFLOW_PATH,
  CODE_HEALTH_WEEKLY_WORKFLOW_PATH,
} from "@/lib/codeHealth/types";
import type { DecisionRadarAdminProjection } from "@/lib/decisionModelRadarReports";
import { DECISION_RADAR_WORKFLOW_PATH } from "@/lib/decisionModelRadar";
import { DOMAIN_SSL_WORKFLOW_PATH, type DomainSslMonitorView } from "@/lib/domainSslMonitor";
import type { FinanceAnomalyReport } from "@/lib/financeAnomalyRadar";
import type { PostDeployVerificationView } from "@/lib/postDeployVerification";
import type { SchedulerRunOverview } from "@/lib/schedulerRunShared";

/**
 * Canonical aggregation for "what does the operator have to do right now".
 *
 * One attention item per real-world subject: a workflow path, an internal
 * scheduler job, a finance anomaly, a supplier PR. Every signal about the same
 * subject (GitHub run outcome, ledger verdict, freshness) merges into that one
 * item, so a single cause is never counted as several independent outages.
 *
 * Evidence rules:
 * - ACTION   a failed run, a finding in an audit result, an operator approval
 *            that GitHub shows as open, or the shared GitHub read being down.
 * - AUTO     only when a GitHub run / durable scheduler row is actually running.
 * - UNKNOWN  no run yet, an old result, or one report that could not be read.
 *            Never promoted to OK, never counted as an incident.
 * - OK       only when a fresh, successful result is present.
 * Read-only: no workflow reruns, no state writes, no external Automation calls.
 */

export type AttentionBucket = "ACTION" | "AUTO" | "UNKNOWN" | "OK";
export type AttentionSeverity = "critical" | "warning" | "info";

export type AttentionLink = { label: string; href: string };

export type AttentionItem = {
  key: string;
  bucket: AttentionBucket;
  severity: AttentionSeverity;
  title: string;
  statusLabel: string;
  /** Plain-language reasons, primary first. The first entry is the one-line summary. */
  reasons: string[];
  nextAction: string | null;
  lastRunAt: string | null;
  runUrl: string | null;
  /** Issue / Draft PR links that already exist in the source data. Never inferred. */
  links: AttentionLink[];
  /** Raw source statuses, kept for the detail view. */
  technical: string[];
  /** Same incident id the Ops Inbox uses, when the Ops Inbox lists this subject. */
  opsIncidentId: string | null;
};

export type AttentionHistoryRow = {
  name: string;
  path: string;
  lastRunAt: string;
  outcomeLabel: string;
  latestRunFailed: boolean;
  runUrl: string;
};

export type AttentionDashboard = {
  action: AttentionItem[];
  auto: AttentionItem[];
  unknown: AttentionItem[];
  ok: AttentionItem[];
  /** Workflows without a schedule on main. Past records only, never counted. */
  history: AttentionHistoryRow[];
  /** Every item by key, for per-report summary lines. */
  byKey: ReadonlyMap<string, AttentionItem>;
};

export type AttentionInput = {
  now?: Date;
  github: GithubAutomationProjection;
  coverage: AutomationCoverageView;
  codeHealth: CodeHealthAdminProjection;
  decisionRadar: DecisionRadarAdminProjection;
  memoryResearch: MemoryResearchAdminProjection;
  domainSsl: DomainSslMonitorView;
  postDeploy: PostDeployVerificationView;
  supplyDrafts: GithubSupplyAutoDraftProjection;
  schedulers: readonly SchedulerRunOverview[];
  finance: FinanceAnomalyReport;
  /** Local schedule registry; used for artifact age when coverage join is unavailable. */
  registryDefinitions?: readonly ScheduledWorkflowDefinition[];
};

type Signal = {
  bucket: AttentionBucket;
  severity: AttentionSeverity;
  statusLabel: string;
  reason: string;
  nextAction?: string | null;
  technical?: string;
  links?: AttentionLink[];
  runUrl?: string | null;
  lastRunAt?: string | null;
  opsIncidentId?: string | null;
};

type Subject = { title: string; signals: Signal[] };

const BUCKET_RANK: Record<AttentionBucket, number> = { ACTION: 0, AUTO: 1, UNKNOWN: 2, OK: 3 };
const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

export const ATTENTION_KEY = {
  workflow: (path: string) => `workflow:${path}`,
  postDeploy: "post_deploy",
  githubLookup: "lookup:github",
  registryLookup: "lookup:registry",
} as const;

function ageLabel(nowMs: number, iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "시점 미상";
  const hours = Math.max(0, Math.floor((nowMs - then) / 3_600_000));
  return hours < 48 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
}

function latestCompletedRun(group: GithubScheduledAutomationGroup | null) {
  return group?.history.find((run) => run.status === "completed") ?? null;
}

function addSignal(subjects: Map<string, Subject>, key: string, title: string, signal: Signal) {
  const subject = subjects.get(key);
  if (subject) subject.signals.push(signal);
  else subjects.set(key, { title, signals: [signal] });
}

function finalize(key: string, subject: Subject): AttentionItem {
  const ranked = [...subject.signals].sort(
    (a, b) =>
      BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
  const primary = ranked[0]!;
  const links: AttentionLink[] = [];
  for (const signal of ranked) {
    for (const link of signal.links ?? []) {
      if (!links.some((existing) => existing.href === link.href)) links.push(link);
    }
  }
  const reasons: string[] = [];
  for (const signal of ranked) {
    if (!reasons.includes(signal.reason)) reasons.push(signal.reason);
  }
  const technical: string[] = [];
  for (const signal of ranked) {
    if (signal.technical && !technical.includes(signal.technical)) technical.push(signal.technical);
  }
  return {
    key,
    bucket: primary.bucket,
    severity: primary.severity,
    title: subject.title,
    statusLabel: primary.statusLabel,
    reasons,
    nextAction: ranked.find((signal) => signal.bucket === primary.bucket && signal.nextAction)?.nextAction ?? null,
    lastRunAt: ranked.map((signal) => signal.lastRunAt).find((value) => Boolean(value)) ?? null,
    runUrl: ranked.map((signal) => signal.runUrl).find((value) => Boolean(value)) ?? null,
    links,
    technical,
    opsIncidentId: ranked.map((signal) => signal.opsIncidentId).find((value) => Boolean(value)) ?? null,
  };
}

export function buildAutomationAttention(input: AttentionInput): AttentionDashboard {
  const nowMs = (input.now ?? new Date()).getTime();
  const subjects = new Map<string, Subject>();
  const githubDown = input.github.status === "UNAVAILABLE";
  const registryFreshnessVerified = input.coverage.status === "OK";
  const staleAfterMsByPath = new Map<string, number>(
    registryFreshnessVerified
      ? input.coverage.rows.map((row) => [row.path, row.staleAfterHours * 3_600_000] as const)
      : []
  );
  const definitionStaleMsByPath = new Map<string, number>(
    (input.registryDefinitions ?? []).map(
      (definition) =>
        [definition.path, definitionStaleAfterHours(definition) * 3_600_000] as const
    )
  );

  const staleLimitMsForPath = (path: string): number | undefined =>
    staleAfterMsByPath.get(path) ?? definitionStaleMsByPath.get(path);

  /** Ledger/radar verdicts need a registry join to treat a dated result as current. */
  const isScheduleLedgerStale = (path: string, iso: string | null | undefined): boolean => {
    const then = iso ? Date.parse(iso) : Number.NaN;
    if (!Number.isFinite(then)) return false;
    if (!registryFreshnessVerified) return true;
    const limit = staleAfterMsByPath.get(path);
    return limit != null && nowMs - then > limit;
  };

  /** Domain·SSL and similar artifacts: age vs schedule threshold even when coverage join failed. */
  const isArtifactObservationStale = (path: string, iso: string | null | undefined): boolean => {
    const then = iso ? Date.parse(iso) : Number.NaN;
    if (!Number.isFinite(then)) return false;
    const limit = staleLimitMsForPath(path);
    if (limit == null) {
      // Same as the live page when scanScheduledWorkflowDefinitions() returns []:
      // without a schedule owner we must not treat dated evidence as a current incident.
      return true;
    }
    return nowMs - then > limit;
  };
  const workflowTitle = (path: string, fallback: string) => automationDisplayName(path, fallback);
  const addWorkflowSignal = (path: string, fallbackName: string, signal: Signal) =>
    addSignal(subjects, ATTENTION_KEY.workflow(path), workflowTitle(path, fallbackName), signal);

  if (githubDown) {
    addSignal(subjects, ATTENTION_KEY.githubLookup, "GitHub 자동화 상태 조회", {
      bucket: "ACTION",
      severity: "warning",
      statusLabel: "조회 장애",
      reason:
        "GitHub에서 실행 기록을 읽지 못해 모든 자동화를 확인할 수 없습니다. 정상으로 간주하지 않습니다.",
      nextAction: "GitHub 접근 토큰 권한과 호출 제한(rate limit)을 확인하세요.",
      technical: input.github.error ?? "GitHub Actions API unavailable",
    });
  } else if (input.coverage.status === "UNAVAILABLE") {
    addSignal(subjects, ATTENTION_KEY.registryLookup, "등록된 정기 자동화 목록", {
      bucket: "ACTION",
      severity: "warning",
      statusLabel: "조회 장애",
      reason:
        "main에 등록된 schedule workflow 목록을 읽지 못해 등록 대비 실행을 대조할 수 없습니다.",
      nextAction: "배포 번들에 .github/workflows가 포함되어 있는지 확인하세요.",
      technical: input.coverage.error ?? "registry unavailable",
    });
  }

  if (input.coverage.status === "OK") {
    for (const row of input.coverage.rows) {
      const group = row.group;
      const latest = group?.latest ?? null;
      const completed = latestCompletedRun(group);
      const base = {
        runUrl: latest?.htmlUrl ?? null,
        lastRunAt: latest?.createdAt ?? null,
        technical: `${row.state}${completed?.conclusion ? ` · ${completed.conclusion}` : ""}`,
      };
      switch (row.state) {
        case "FAILED": {
          const outcome = githubRunConclusionLabel(completed?.conclusion ?? null);
          addWorkflowSignal(row.path, row.name, {
            ...base,
            bucket: "ACTION",
            severity: githubRunSeverity(completed?.conclusion ?? "failure"),
            statusLabel: row.consecutiveFailures > 1 ? `${row.consecutiveFailures}회 연속 ${outcome}` : outcome,
            reason:
              `마지막 정기 실행(#${completed?.runNumber ?? latest?.runNumber ?? "?"})이 '${outcome}'로 끝났습니다. ` +
              "GitHub 실행 자체의 결과이며, 점검 내용의 판정과는 별개입니다.",
            nextAction: "GitHub 실행 로그에서 원인을 확인하세요. 이 화면은 자동 재실행을 하지 않습니다.",
            links: [],
            opsIncidentId: group ? `github_automation:${group.key}` : null,
          });
          if (latest && isGithubRunInProgress(latest.status)) {
            const activity = githubRunAutoAttentionCopy(latest.status, latest.runNumber);
            addWorkflowSignal(row.path, row.name, {
              ...base,
              bucket: "AUTO",
              severity: "info",
              statusLabel: activity.statusLabel,
              reason: activity.reason,
            });
          }
          break;
        }
        case "STALE":
          addWorkflowSignal(row.path, row.name, {
            ...base,
            bucket: "UNKNOWN",
            severity: "warning",
            statusLabel: "최신 확인 필요",
            reason: `마지막 정기 실행이 ${row.staleAfterHours}시간 기준을 넘어 현재 상태를 확인할 수 없습니다.`,
            nextAction: "GitHub Actions에서 schedule이 켜져 있는지 확인하세요.",
          });
          break;
        case "NOT_RUN":
          addWorkflowSignal(row.path, row.name, {
            ...base,
            bucket: "UNKNOWN",
            severity: "warning",
            statusLabel: "실행 기록 없음",
            reason:
              "조회된 정기 실행 목록에 이 workflow의 기록이 없습니다. 첫 실행 전이거나 schedule이 멈췄을 수 있습니다.",
            nextAction: "첫 실행 예정 시각이 지났다면 GitHub Actions에서 schedule 상태를 확인하세요.",
          });
          break;
        case "UNAVAILABLE":
          addWorkflowSignal(row.path, row.name, {
            ...base,
            bucket: "UNKNOWN",
            severity: "warning",
            statusLabel: "조회 불가",
            reason: "이 자동화의 실행 기록을 읽지 못했습니다.",
          });
          break;
        case "OK":
          if (latest && isGithubRunInProgress(latest.status)) {
            const activity = githubRunAutoAttentionCopy(latest.status, latest.runNumber);
            addWorkflowSignal(row.path, row.name, {
              ...base,
              bucket: "AUTO",
              severity: "info",
              statusLabel: activity.statusLabel,
              reason: activity.reason,
            });
          } else {
            addWorkflowSignal(row.path, row.name, {
              ...base,
              bucket: "OK",
              severity: "info",
              statusLabel: "정상",
              reason: `마지막 정기 실행이 성공했고 ${ageLabel(nowMs, latest?.createdAt ?? "")}에 확인됐습니다.`,
            });
          }
          break;
        default: {
          const _exhaustive: never = row.state;
          void _exhaustive;
        }
      }
    }
  }

  const addLedgerCard = (card: CodeHealthAdminCard, path: string, fallbackName: string) => {
    const links: AttentionLink[] = card.draftPrUrl
      ? [{ label: "정리 Draft PR", href: card.draftPrUrl }]
      : [];
    const base = { runUrl: card.githubRunUrl, lastRunAt: card.ranAt, links };
    if (card.status === "UNAVAILABLE") {
      if (githubDown) return;
      addWorkflowSignal(path, fallbackName, {
        ...base,
        bucket: "UNKNOWN",
        severity: "warning",
        statusLabel: auditStatusLabel("UNAVAILABLE"),
        reason: "점검 보고서를 읽지 못했습니다. 정상으로 간주하지 않습니다.",
        technical: `ledger ${card.status}`,
      });
      return;
    }
    if (card.status === "EMPTY") {
      addWorkflowSignal(path, fallbackName, {
        ...base,
        bucket: "UNKNOWN",
        severity: "info",
        statusLabel: auditStatusLabel("EMPTY"),
        reason: "점검 보고서 기록이 아직 없습니다.",
        technical: "ledger EMPTY",
      });
      return;
    }
    const verdict = auditStatusLabel(card.status);
    if (isScheduleLedgerStale(path, card.ranAt)) {
      addWorkflowSignal(path, fallbackName, {
        ...base,
        bucket: "UNKNOWN",
        severity: "warning",
        statusLabel: "최신 확인 필요",
        reason: !registryFreshnessVerified
          ? "등록된 schedule 목록을 확인하지 못해 점검 결과의 최신 여부를 판단할 수 없습니다. 정상으로 간주하지 않습니다."
          : `마지막 점검 결과(${verdict})는 ${ageLabel(nowMs, card.ranAt ?? "")} 기록이라 현재 상태로 보지 않습니다.`,
        technical: `ledger ${card.status}`,
      });
      return;
    }
    if (card.status === "SUCCESS") {
      addWorkflowSignal(path, fallbackName, {
        ...base,
        bucket: "OK",
        severity: "info",
        statusLabel: verdict,
        reason: "마지막 점검에서 새로 조치할 항목이 없습니다.",
        technical: `ledger ${card.status}`,
      });
      return;
    }
    addWorkflowSignal(path, fallbackName, {
      ...base,
      bucket: "ACTION",
      severity: card.status === "FAILED" ? "critical" : "warning",
      statusLabel: verdict,
      reason: codeHealthLedgerActionReason(card.counts, card.notes),
      nextAction: "상세 보고서에서 항목과 근거를 확인하세요. 기존 기록은 지우거나 덮어쓰지 않습니다.",
      technical: `ledger ${card.status}`,
    });
  };
  addLedgerCard(input.codeHealth.weekly, CODE_HEALTH_WEEKLY_WORKFLOW_PATH, "Weekly Code Health audit");
  addLedgerCard(input.codeHealth.monthly, CODE_HEALTH_MONTHLY_WORKFLOW_PATH, "Monthly Code Health cleanup");

  {
    const radar = input.decisionRadar;
    const path = DECISION_RADAR_WORKFLOW_PATH;
    const name = "Weekly Decision Model Radar";
    const run = radar.run;
    const base = { runUrl: radar.githubRunUrl, lastRunAt: run?.ranAt ?? null };
    if (radar.status === "UNAVAILABLE") {
      if (!githubDown) {
        addWorkflowSignal(path, name, {
          ...base,
          bucket: "UNKNOWN",
          severity: "warning",
          statusLabel: "조회 불가",
          reason: "조사 결과를 읽지 못했습니다. 자동화 실패가 아니라 조회 장애입니다.",
          technical: "latest.json UNAVAILABLE",
        });
      }
    } else if (!run) {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "UNKNOWN",
        severity: "info",
        statusLabel: "실행 기록 없음",
        reason: "아직 조사 결과 기록이 없습니다.",
        technical: "latest.json EMPTY",
      });
    } else if (isScheduleLedgerStale(path, run.ranAt)) {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "UNKNOWN",
        severity: "warning",
        statusLabel: "최신 확인 필요",
        reason: !registryFreshnessVerified
          ? "등록된 schedule 목록을 확인하지 못해 조사 결과의 최신 여부를 판단할 수 없습니다. 정상으로 간주하지 않습니다."
          : `마지막 조사 결과(${decisionRadarStatusLabel(run.status)})는 ${ageLabel(nowMs, run.ranAt)} 기록입니다.`,
        technical: run.status,
      });
    } else if (run.status === "FAILED" || run.status === "PARTIAL") {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "ACTION",
        severity: run.status === "FAILED" ? "critical" : "warning",
        statusLabel: decisionRadarStatusLabel(run.status),
        reason:
          run.status === "FAILED"
            ? "마지막 조사에서 모델 비교가 실패했습니다."
            : "마지막 조사에서 일부 후보만 비교를 마쳤습니다.",
        nextAction: "상세 보고서와 GitHub 실행 로그에서 비교하지 못한 후보를 확인하세요.",
        technical: run.status,
      });
    } else {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "OK",
        severity: "info",
        statusLabel: decisionRadarStatusLabel(run.status),
        reason:
          run.status === "REVIEW_CANDIDATE"
            ? "검토해 볼 만한 후보가 있습니다. 조치가 필수는 아니며 운영 모델은 자동으로 바뀌지 않습니다."
            : "마지막 조사가 정상적으로 끝났습니다.",
        technical: run.status,
      });
    }
  }

  {
    const memory = input.memoryResearch;
    const path = MEMORY_RESEARCH_WORKFLOW_PATH;
    const name = "Memory research cycle";
    const run = memory.run;
    const base = {
      runUrl: memory.githubRunUrl,
      lastRunAt: run?.finishedAt ?? null,
      links: memory.persistedReportUrl
        ? [{ label: "연구 기록(JSON)", href: memory.persistedReportUrl }]
        : [],
    };
    if (memory.status === "UNAVAILABLE") {
      if (!githubDown) {
        addWorkflowSignal(path, name, {
          ...base,
          bucket: "UNKNOWN",
          severity: "warning",
          statusLabel: "조회 불가",
          reason: "연구 기록을 읽지 못했습니다. 정상으로 간주하지 않습니다.",
          technical: "memory ledger UNAVAILABLE",
        });
      }
    } else if (!run) {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "UNKNOWN",
        severity: "info",
        statusLabel: "실행 기록 없음",
        reason: "아직 저장된 연구 기록이 없습니다.",
        technical: "memory ledger EMPTY",
      });
    } else if (run.productionTouched) {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "ACTION",
        severity: "critical",
        statusLabel: "운영 데이터 변경 의심",
        reason: "연구 사이클이 운영 데이터를 건드렸다고 기록했습니다. 연구는 읽기 전용이어야 합니다.",
        nextAction: "연구 기록과 GitHub 실행 로그를 확인하세요.",
        technical: "productionTouched=true",
      });
    } else if (run.promptPackingAudit?.status === "FAIL") {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "ACTION",
        severity: "warning",
        statusLabel: "점검 결과: 문제 발견",
        reason: `프롬프트 구성 점검에서 ${run.promptPackingAudit.failedInvariants.length}개 규칙이 실패했습니다.`,
        nextAction: "연구 보고서의 '실패 invariant'를 확인하세요.",
        technical: "promptPackingAudit FAIL",
      });
    } else if (memory.freshnessStatus === "STALE_CYCLE" || memory.freshnessStatus === "PERSISTENCE_LAG") {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "UNKNOWN",
        severity: "warning",
        statusLabel: "최신 확인 필요",
        reason:
          memory.freshnessStatus === "PERSISTENCE_LAG"
            ? "더 최신 실행은 성공했지만 저장된 연구 기록은 그보다 오래됐습니다."
            : "저장된 연구 기록이 주간 기준보다 오래됐습니다.",
        technical: memory.freshnessStatus,
      });
    } else {
      addWorkflowSignal(path, name, {
        ...base,
        bucket: "OK",
        severity: "info",
        statusLabel: "정상",
        reason:
          run.baselinePromotionBlocked === true
            ? "연구가 정상적으로 기록됐습니다. 기준 모델 승격은 게이트에서 보류 중이며 조치가 필요하지 않습니다."
            : "연구가 정상적으로 기록됐습니다.",
        technical: memory.freshnessStatus,
      });
    }
  }

  {
    const ssl = input.domainSsl;
    const path = DOMAIN_SSL_WORKFLOW_PATH;
    const name = "Domain SSL monitor";
    const latest = ssl.latest;
    const base = { runUrl: latest?.htmlUrl ?? null, lastRunAt: latest?.checkedAt ?? null };
    if (ssl.status === "UNAVAILABLE") {
      if (!githubDown) {
        addWorkflowSignal(path, name, {
          ...base,
          bucket: "UNKNOWN",
          severity: "warning",
          statusLabel: "조회 불가",
          reason: "도메인·SSL 감시 결과를 읽지 못했습니다.",
          technical: "domain-ssl UNAVAILABLE",
        });
      }
    } else if (latest) {
      if (isArtifactObservationStale(path, latest.checkedAt)) {
        addWorkflowSignal(path, name, {
          ...base,
          bucket: "UNKNOWN",
          severity: "warning",
          statusLabel: "최신 확인 필요",
          reason: `마지막 감시 결과는 ${ageLabel(nowMs, latest.checkedAt)} 기록입니다.`,
          technical: `domain-ssl ${latest.state}`,
        });
      } else if (latest.state === "FAIL" || latest.state === "WARNING") {
        addWorkflowSignal(path, name, {
          ...base,
          bucket: "ACTION",
          severity: latest.state === "FAIL" ? "critical" : "warning",
          statusLabel: latest.state === "FAIL" ? "점검 결과: 실패" : "점검 결과: 주의",
          reason: latest.reason ?? "DNS, TLS, /health 중 확인이 필요한 항목이 있습니다.",
          nextAction: "상세 카드에서 DNS·TLS·/health 항목을 확인하세요.",
          technical: `domain-ssl ${latest.state}`,
        });
      } else if (latest.state === "UNVERIFIED") {
        addWorkflowSignal(path, name, {
          ...base,
          bucket: "UNKNOWN",
          severity: "warning",
          statusLabel: "확인 불가",
          reason: latest.reason ?? "이번 감시에서 일부 항목을 확인하지 못했습니다.",
          technical: "domain-ssl UNVERIFIED",
        });
      } else {
        addWorkflowSignal(path, name, {
          ...base,
          bucket: "OK",
          severity: "info",
          statusLabel: "정상",
          reason: "DNS, TLS, /health 점검이 모두 통과했습니다.",
          technical: "domain-ssl OK",
        });
      }
    } else {
      addWorkflowSignal(path, name, {
        bucket: "UNKNOWN",
        severity: "info",
        statusLabel: "실행 기록 없음",
        reason: "도메인·SSL 감시 결과가 없습니다. 정상으로 간주하지 않습니다.",
        technical: "domain-ssl EMPTY",
      });
    }
  }

  {
    const deploy = input.postDeploy;
    const title = "배포 검증";
    const latest = deploy.latest;
    const base = { runUrl: latest?.htmlUrl ?? null, lastRunAt: latest?.checkedAt ?? null };
    if (deploy.status === "UNAVAILABLE") {
      if (!githubDown) {
        addSignal(subjects, ATTENTION_KEY.postDeploy, title, {
          ...base,
          bucket: "UNKNOWN",
          severity: "warning",
          statusLabel: "조회 불가",
          reason: "배포 검증 결과를 읽지 못했습니다. 검증된 것으로 간주하지 않습니다.",
          technical: "post-deploy UNAVAILABLE",
        });
      }
    } else if (latest) {
      if (!latest.currentDeployment || latest.state === "SUPERSEDED") {
        addSignal(subjects, ATTENTION_KEY.postDeploy, title, {
          ...base,
          bucket: "UNKNOWN",
          severity: "info",
          statusLabel: "이전 배포 결과",
          reason: "현재 배포가 아닌 이전 배포의 검증 결과입니다. 현재 배포는 아직 검증되지 않았습니다.",
          technical: `post-deploy ${latest.state}`,
        });
      } else if (latest.state === "FAILED" || latest.publicSmoke.state === "FAIL") {
        addSignal(subjects, ATTENTION_KEY.postDeploy, title, {
          ...base,
          bucket: "ACTION",
          severity: "critical",
          statusLabel: "검증 실패",
          reason:
            latest.reason ??
            latest.publicSmoke.reason ??
            "배포 후 SHA 또는 공개 페이지 검증이 실패했습니다.",
          nextAction: "배포 검증 카드에서 대상 SHA와 응답을 비교하세요.",
          technical: `post-deploy ${latest.state} / smoke ${latest.publicSmoke.state}`,
        });
      } else if (latest.state === "UNVERIFIED" || latest.publicSmoke.state === "UNVERIFIED") {
        addSignal(subjects, ATTENTION_KEY.postDeploy, title, {
          ...base,
          bucket: "UNKNOWN",
          severity: "warning",
          statusLabel: "검증 미완료",
          reason: latest.reason ?? "배포 후 검증을 끝내지 못했습니다.",
          technical: `post-deploy ${latest.state} / smoke ${latest.publicSmoke.state}`,
        });
      } else {
        addSignal(subjects, ATTENTION_KEY.postDeploy, title, {
          ...base,
          bucket: "OK",
          severity: "info",
          statusLabel: "검증 완료",
          reason: "현재 배포가 SHA와 공개 페이지 검증을 통과했습니다.",
          technical: "post-deploy VERIFIED / smoke PASS",
        });
      }
    } else {
      addSignal(subjects, ATTENTION_KEY.postDeploy, title, {
        bucket: "UNKNOWN",
        severity: "info",
        statusLabel: "실행 기록 없음",
        reason: "배포 검증 결과가 없습니다. 검증된 것으로 간주하지 않습니다.",
        technical: "post-deploy EMPTY",
      });
    }
  }

  if (input.supplyDrafts.status === "UNAVAILABLE") {
    if (!githubDown) {
      addSignal(subjects, "lookup:supply_drafts", "공급망 Draft PR 목록", {
        bucket: "UNKNOWN",
        severity: "warning",
        statusLabel: "조회 불가",
        reason: "자동 생성 공급망 Draft PR 목록을 읽지 못했습니다.",
        technical: input.supplyDrafts.error ?? "pulls UNAVAILABLE",
      });
    }
  } else {
    for (const draft of input.supplyDrafts.drafts) {
      addSignal(subjects, `supply_pr:${draft.number}`, `공급망 승격 Draft PR #${draft.number}`, {
        bucket: "ACTION",
        severity: "warning",
        statusLabel: "승인 대기",
        reason: `모델 ${draft.modelId} · 후보 provider ${draft.candidateProviderSlug} — GitHub에서 아직 열려 있습니다.`,
        nextAction: "PR을 검토하고 병합 여부를 결정하세요. 자동 병합되지 않습니다.",
        lastRunAt: draft.createdAt,
        links: draft.htmlUrl ? [{ label: `PR #${draft.number}`, href: draft.htmlUrl }] : [],
        technical: `${draft.state}${draft.draft ? " · draft" : ""}`,
      });
    }
  }

  for (const row of input.schedulers) {
    const observed = row.current ?? row.latest;
    const lastRunAt = observed?.finished_at ?? observed?.heartbeat_at ?? observed?.started_at ?? null;
    const key = `scheduler:${row.jobName}`;
    const stateLabel = schedulerStateLabel(row.state);
    if (SCHEDULER_INCIDENT_STATES.has(row.state)) {
      addSignal(subjects, key, row.label, {
        bucket: "ACTION",
        severity: schedulerIncidentSeverity(row.state),
        statusLabel: stateLabel,
        reason: schedulerIncidentSummary(row.state, observed?.last_error ?? ""),
        nextAction: "사이트 내부 작업 표와 운영 예외함에서 해당 슬롯을 확인하세요.",
        lastRunAt,
        technical: row.state,
        opsIncidentId: `scheduler:${row.jobName}:${row.currentSlotKey}`,
      });
    } else if (row.state === "RUNNING") {
      addSignal(subjects, key, row.label, {
        bucket: "AUTO",
        severity: "info",
        statusLabel: stateLabel,
        reason: "durable scheduler 기록상 현재 슬롯이 실행 중입니다.",
        lastRunAt,
        technical: row.state,
      });
    } else if (row.state === "SUCCEEDED") {
      addSignal(subjects, key, row.label, {
        bucket: "OK",
        severity: "info",
        statusLabel: stateLabel,
        reason: "현재 슬롯이 성공으로 기록됐습니다.",
        lastRunAt,
        technical: row.state,
      });
    }
  }

  for (const anomaly of input.finance.anomalies) {
    addSignal(subjects, `finance:${anomaly.id}`, anomaly.title, {
      bucket: "ACTION",
      severity: anomaly.severity === "critical" ? "critical" : "warning",
      statusLabel: anomaly.severity === "critical" ? "재무·과금 긴급" : "재무·과금 주의",
      reason: anomaly.summary,
      nextAction: "원인 화면에서 원장과 가격 근거를 확인하세요. 이 화면은 가격·과금을 바꾸지 않습니다.",
      lastRunAt: anomaly.occurredAt?.trim() || input.finance.generatedAt,
      links: [{ label: "원인 화면", href: anomaly.href }],
      technical: `${anomaly.code} · ${anomaly.sourceRef}`,
      opsIncidentId: `finance:${anomaly.id}`,
    });
  }

  const items = [...subjects.entries()].map(([key, subject]) => finalize(key, subject));
  const byBucket = (bucket: AttentionBucket) =>
    items
      .filter((item) => item.bucket === bucket)
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          (b.lastRunAt ? Date.parse(b.lastRunAt) : 0) - (a.lastRunAt ? Date.parse(a.lastRunAt) : 0) ||
          a.key.localeCompare(b.key)
      );

  const history: AttentionHistoryRow[] =
    input.coverage.status === "OK"
      ? input.coverage.unregistered.map(({ group, latestRunFailed }) => ({
          name: automationDisplayName(group.path, group.name),
          path: group.path,
          lastRunAt: group.latest.createdAt,
          outcomeLabel: githubRunConclusionLabel(group.latest.conclusion, group.latest.status),
          latestRunFailed,
          runUrl: group.latest.htmlUrl,
        }))
      : [];

  return {
    action: byBucket("ACTION"),
    auto: byBucket("AUTO"),
    unknown: byBucket("UNKNOWN"),
    ok: byBucket("OK"),
    history,
    byKey: new Map(items.map((item) => [item.key, item])),
  };
}
