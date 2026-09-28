import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAdminUser } from "@/lib/adminAuth";
import { fetchGithubScheduledAutomationProjection } from "@/lib/adminAutomationReports";
import {
  fetchCodeHealthAdminProjection,
  formatCodeHealthDeltaLines,
  type CodeHealthAdminCard,
} from "@/lib/codeHealth/reports";
import { getDb } from "@/lib/db";
import { listMainRpCacheTtlReports } from "@/lib/mainRpCacheTtlEconomics";
import { listSchedulerRunOverview } from "@/lib/schedulerRunRegistry";

export const dynamic = "force-dynamic";

function fmtDate(value: string | null | undefined): string {
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

function badgeClass(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "success" || normalized === "succeeded" || normalized === "completed") {
    return "bg-emerald-500/15 text-emerald-300";
  }
  if (
    normalized === "failure" ||
    normalized === "failed" ||
    normalized === "stale" ||
    normalized === "stale_blocked"
  ) {
    return "bg-rose-500/15 text-rose-300";
  }
  if (normalized === "running" || normalized === "in_progress" || normalized === "queued") {
    return "bg-sky-500/15 text-sky-300";
  }
  return "bg-amber-500/15 text-amber-300";
}

function codeHealthStatusLabel(status: CodeHealthAdminCard["status"]): string {
  switch (status) {
    case "SUCCESS":
      return "SUCCESS";
    case "WARNING":
      return "WARNING";
    case "FAILED":
      return "FAILED";
    case "EMPTY":
      return "기록 없음";
    case "UNAVAILABLE":
      return "UNAVAILABLE";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function CodeHealthCard({ card }: { card: CodeHealthAdminCard }) {
  const counts = card.counts;
  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-cyan-200">
            {card.kind === "weekly" ? "Weekly Code Health" : "Monthly Cleanup"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {card.kind === "weekly"
              ? "주 1회 read-only 코드 헬스 감사입니다. production 코드를 수정하지 않으며, 분석기 결과는 삭제 증거가 아닙니다."
              : "월 1회 이전 weekly 결과를 합쳐 cleanup candidate set만 만듭니다. 자동 merge하지 않습니다."}
          </p>
        </div>
        <span className={"rounded px-2 py-1 text-xs font-bold " + badgeClass(card.status)}>
          {codeHealthStatusLabel(card.status)}
        </span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">실행 시각 · {fmtDate(card.ranAt)}</p>
      {counts ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">신규 발견</p>
            <p className="mt-1 font-bold">{counts.newFindings}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">resolved</p>
            <p className="mt-1 font-bold">{counts.resolved}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">SAFE_TO_DELETE</p>
            <p className="mt-1 font-bold">{counts.safeToDelete}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">REQUIRED_CLEANUP</p>
            <p className="mt-1 font-bold">{counts.requiredCleanup}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">FOLLOW_UP</p>
            <p className="mt-1 font-bold">{counts.followUp}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">duplicate owner</p>
            <p className="mt-1 font-bold">{counts.duplicateOwners}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">unused file / export / dep</p>
            <p className="mt-1 font-bold">
              {counts.unusedFiles} / {counts.unusedExports} / {counts.unusedDependencies}
            </p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">obsolete flag/env · CI anomaly</p>
            <p className="mt-1 font-bold">
              {counts.obsoleteFlagsEnvs} · {counts.runtimeCiAnomalies}
            </p>
          </div>
        </div>
      ) : null}
      <div className="mt-3 rounded-xl border border-white/5 p-3 text-xs text-zinc-400">
        <p className="text-[11px] text-zinc-500">지난 실행 대비 delta</p>
        <ul className="mt-1 space-y-0.5">
          {formatCodeHealthDeltaLines(card.delta).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {card.kind === "monthly" ? (
        <p className="mt-3 text-xs text-zinc-500">
          cleanup Draft PR: {card.draftPrCreated ? "생성됨" : "없음"}
          {card.eligibleCount != null ? ` · eligible ${card.eligibleCount}` : ""}
        </p>
      ) : null}
      {card.githubRunUrl ? (
        <div className="mt-3">
          <a
            href={card.githubRunUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-white/5"
          >
            상세 GitHub run / report ↗
          </a>
        </div>
      ) : null}
    </section>
  );
}

function ttlRecommendationLabel(value: string): string {
  if (value === "KEEP_5M") return "5분 TTL 유지가 유리";
  if (value === "ONE_HOUR_WOULD_BE_CHEAPER_IF_SUPPORTED") {
    return "1시간 TTL이 더 저렴할 가능성";
  }
  return "표본 부족 — 판단 보류";
}

export default async function AdminAutomationReportsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?next=/admin/automation-reports");

  const db = getDb();
  const github = await fetchGithubScheduledAutomationProjection();
  const codeHealth = await fetchCodeHealthAdminProjection(github.groups);
  const ttlReports = listMainRpCacheTtlReports(db, 12);
  const schedulers = listSchedulerRunOverview(db);
  const latestTtl = ttlReports[0] ?? null;
  const githubFailures = github.groups.filter(
    (group) => group.latest.conclusion && group.latest.conclusion !== "success"
  ).length;
  const schedulerProblems = schedulers.filter((row) =>
    ["FAILED", "STALE", "STALE_BLOCKED", "MISSING"].includes(row.state)
  ).length;
  const codeHealthProblems = [codeHealth.weekly.status, codeHealth.monthly.status].filter(
    (status) => status === "WARNING" || status === "FAILED" || status === "UNAVAILABLE"
  ).length;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 text-zinc-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-200">
            ← 설정
          </Link>
          <h1 className="mt-2 text-2xl font-black">자동화 보고서</h1>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-zinc-500">
            기존 GitHub 정기 감사와 사이트 내부 durable scheduler의 결과를 한곳에 모아 보는
            관리자 전용 read-only 화면입니다. 실행 owner나 자동화 정책은 이 화면에서 바꾸지 않습니다.
          </p>
        </div>
        <Link
          href="/admin/ops"
          className="rounded-xl border border-white/10 bg-[#11131a] px-4 py-2 text-sm font-semibold hover:bg-[#181b24]"
        >
          운영 예외함 →
        </Link>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
          <p className="text-xs text-zinc-500">GitHub 정기 자동화</p>
          <p className="mt-2 text-2xl font-black">{github.groups.length}개</p>
          <p className="mt-1 text-xs text-zinc-600">최근 scheduled run 기준</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
          <p className="text-xs text-zinc-500">사이트 내부 scheduler</p>
          <p className="mt-2 text-2xl font-black">{schedulers.length}개</p>
          <p className="mt-1 text-xs text-zinc-600">durable registry 기준</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
          <p className="text-xs text-zinc-500">확인 필요</p>
          <p className="mt-2 text-2xl font-black text-amber-300">
            {githubFailures + schedulerProblems + codeHealthProblems}건
          </p>
          <p className="mt-1 text-xs text-zinc-600">실패·누락·stale 최신 상태</p>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CodeHealthCard card={codeHealth.weekly} />
        <CodeHealthCard card={codeHealth.monthly} />
      </div>

      <section className="mt-6 rounded-2xl border border-violet-500/20 bg-violet-950/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-violet-200">월간 Opus 5.5 캐시 TTL 경제성</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              실제 일반 사용자 턴의 요청 시작 간격을 월 단위로 집계합니다. 재생성 reuse는
              시작시각 증거가 달라 보수적으로 제외하며, 자동으로 TTL을 변경하지 않습니다.
            </p>
          </div>
          {latestTtl ? (
            <span
              className={
                "rounded px-2 py-1 text-xs font-bold " +
                badgeClass(latestTtl.recommendation === "INSUFFICIENT_SAMPLE" ? "warning" : "success")
              }
            >
              {ttlRecommendationLabel(latestTtl.recommendation)}
            </span>
          ) : null}
        </div>

        {latestTtl ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">대상 월</p>
                <p className="mt-1 font-bold">{latestTtl.yearMonth}</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">관측 전환</p>
                <p className="mt-1 font-bold">{latestTtl.transitionCount.toLocaleString()}회</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">5분 이내</p>
                <p className="mt-1 font-bold">{latestTtl.gapBuckets.within5Minutes.toLocaleString()}회</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">5~60분</p>
                <p className="mt-1 font-bold">{latestTtl.gapBuckets.over5Within60Minutes.toLocaleString()}회</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-white/5 p-3 text-sm">
                <p className="text-xs text-zinc-500">5분 TTL 정규화 비용</p>
                <p className="mt-1 font-mono">
                  {"$"}{latestTtl.normalizedCostUsdPerMillionPrefix.fiveMinuteTtl.toFixed(3)}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 p-3 text-sm">
                <p className="text-xs text-zinc-500">1시간 TTL 가정 비용</p>
                <p className="mt-1 font-mono">
                  {"$"}{latestTtl.normalizedCostUsdPerMillionPrefix.oneHourTtlHypothetical.toFixed(3)}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 p-3 text-sm">
                <p className="text-xs text-zinc-500">1시간 대비 차이</p>
                <p className="mt-1 font-mono">
                  {latestTtl.normalizedCostUsdPerMillionPrefix.oneHourDeltaPercentVsFiveMinute == null
                    ? "계산 불가"
                    : latestTtl.normalizedCostUsdPerMillionPrefix.oneHourDeltaPercentVsFiveMinute.toFixed(1) + "%"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-amber-200/80">
              1시간 TTL provider 지원 상태: {latestTtl.providerOneHourSupport}. 경제성이 좋아도
              provider 계약/호환성이 확인되기 전에는 자동 전환하지 않습니다.
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">
            아직 월간 TTL 보고서가 없습니다. 첫 due slot 실행 후 여기에 누적됩니다.
          </p>
        )}

        {ttlReports.length > 1 ? (
          <details className="mt-4 rounded-xl border border-white/5 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-300">
              이전 월 보고서 {ttlReports.length - 1}개
            </summary>
            <div className="mt-3 space-y-2">
              {ttlReports.slice(1).map((report) => (
                <div
                  key={report.yearMonth}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400"
                >
                  <span>{report.yearMonth}</span>
                  <span>{ttlRecommendationLabel(report.recommendation)}</span>
                  <span>전환 {report.transitionCount.toLocaleString()}회</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-black">GitHub 정기 자동감사</h2>
        <p className="mt-1 text-xs text-zinc-500">
          GitHub Actions의 schedule 이벤트 실행을 자동 수집합니다. 결과 원문은 각 실행 링크에서
          artifact와 job summary까지 확인할 수 있습니다.
        </p>
        {github.status !== "OK" ? (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 text-sm text-amber-200">
            GitHub 자동감사 목록을 읽지 못했습니다: {github.error ?? "unknown"}
          </div>
        ) : github.groups.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-[#11131a] p-4 text-sm text-zinc-500">
            최근 scheduled run이 없습니다.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {github.groups.map((group) => {
              const latestState = group.latest.conclusion ?? group.latest.status;
              return (
                <article
                  key={group.key}
                  className="rounded-2xl border border-white/10 bg-[#11131a] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold">{group.name}</h3>
                      <p className="mt-1 truncate font-mono text-[11px] text-zinc-600">
                        {group.path}
                      </p>
                    </div>
                    <span
                      className={
                        "shrink-0 rounded px-2 py-1 text-[11px] font-bold " +
                        badgeClass(latestState)
                      }
                    >
                      {latestState}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-zinc-500">
                    최근 실행 #{group.latest.runNumber} · {fmtDate(group.latest.createdAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={group.latest.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-white/5"
                    >
                      최신 보고서/실행 보기 ↗
                    </a>
                  </div>
                  <details className="mt-3 border-t border-white/5 pt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-zinc-400">
                      최근 실행 기록
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      {group.history.slice(0, 6).map((run) => (
                        <a
                          key={run.id}
                          href={run.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                        >
                          <span>#{run.runNumber} · {fmtDate(run.createdAt)}</span>
                          <span>{run.conclusion ?? run.status}</span>
                        </a>
                      ))}
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-black">사이트 내부 자동 작업</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Railway 프로세스의 durable scheduler registry를 그대로 읽습니다. 실행 결과를 고치거나
          재실행하는 화면이 아닙니다.
        </p>
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-white/5 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3">작업</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">cron</th>
                  <th className="px-4 py-3">latest</th>
                  <th className="px-4 py-3">current slot</th>
                </tr>
              </thead>
              <tbody>
                {schedulers.map((row) => (
                  <tr key={row.jobName} className="border-t border-white/5">
                    <td className="px-4 py-3">
                      <p className="font-semibold">{row.label}</p>
                      <p className="font-mono text-[11px] text-zinc-600">{row.jobName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "rounded px-2 py-1 text-[11px] font-bold " + badgeClass(row.state)
                        }
                      >
                        {row.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {row.cronExpression}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {row.latest?.finished_at
                        ? fmtDate(row.latest.finished_at)
                        : row.latest?.started_at
                          ? fmtDate(row.latest.started_at)
                          : "기록 없음"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {row.currentSlotKey}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
