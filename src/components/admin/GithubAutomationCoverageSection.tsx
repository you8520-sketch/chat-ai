import type {
  AutomationCoverageRow,
  AutomationCoverageState,
  AutomationCoverageView,
} from "@/lib/adminAutomationCoverage";
import type { GithubScheduledAutomationGroup } from "@/lib/adminAutomationReports";
import {
  automationDisplayName,
  coverageStateLabel,
  githubRunConclusionLabel,
} from "@/lib/adminAutomationStatus";

type FormatDate = (value: string | null | undefined) => string;

const STATE_TONE: Record<AutomationCoverageState, string> = {
  OK: "bg-emerald-500/15 text-emerald-300",
  FAILED: "bg-rose-500/15 text-rose-300",
  STALE: "bg-amber-500/15 text-amber-300",
  NOT_RUN: "bg-zinc-500/20 text-zinc-300",
  UNAVAILABLE: "bg-zinc-500/20 text-zinc-300",
};

function attentionBadge(state: AutomationCoverageState): string | null {
  if (state === "OK") return null;
  return state === "FAILED" ? "조치 필요" : "미확인";
}

function stateHint(row: AutomationCoverageRow): string | null {
  switch (row.state) {
    case "OK":
      return `예정 시각보다 늦게 시작될 수 있어 ${row.staleAfterHours}시간 넘게 실행이 없을 때만 '최신 확인 필요'로 표시합니다.`;
    case "FAILED":
      return row.consecutiveFailures > 1
        ? `최근 정기 실행 ${row.consecutiveFailures}회 연속 실패. 원인은 GitHub 실행 로그에서 확인하세요.`
        : "최근 정기 실행이 실패했습니다. 원인은 GitHub 실행 로그에서 확인하세요.";
    case "STALE":
      return `마지막 scheduled 실행이 ${row.staleAfterHours}시간 기준을 넘었습니다. GitHub Actions에서 schedule이 켜져 있는지 확인하세요.`;
    case "NOT_RUN":
      return "조회된 scheduled run 목록에 이 workflow의 실행 기록이 없습니다. 첫 실행 전이거나 schedule이 멈췄을 수 있습니다.";
    case "UNAVAILABLE":
      return null;
    default: {
      const _exhaustive: never = row.state;
      return _exhaustive;
    }
  }
}

function RunHistory({
  group,
  formatDate,
}: {
  group: GithubScheduledAutomationGroup;
  formatDate: FormatDate;
}) {
  return (
    <details className="mt-3 border-t border-white/5 pt-3">
      <summary className="cursor-pointer text-xs font-semibold text-zinc-400">최근 실행 기록</summary>
      <div className="mt-2 space-y-1.5">
        {group.history.slice(0, 6).map((run) => (
          <a
            key={run.id}
            href={run.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
          >
            <span>
              #{run.runNumber} · {formatDate(run.createdAt)}
            </span>
            <span>{githubRunConclusionLabel(run.conclusion, run.status)}</span>
          </a>
        ))}
      </div>
    </details>
  );
}

function CoverageCard({ row, formatDate }: { row: AutomationCoverageRow; formatDate: FormatDate }) {
  const latest = row.group?.latest ?? null;
  const hint = stateHint(row);
  return (
    <article className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-bold">{automationDisplayName(row.path, row.name)}</h3>
          <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">{row.path}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={"rounded px-2 py-1 text-[11px] font-bold " + STATE_TONE[row.state]}>
            {coverageStateLabel(row.state)}
          </span>
          {attentionBadge(row.state) ? (
            <span className="rounded border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
              {attentionBadge(row.state)}
            </span>
          ) : null}
        </div>
      </div>
      {latest ? (
        <p className="mt-3 text-xs text-zinc-500">
          최근 실행 #{latest.runNumber} · {formatDate(latest.createdAt)} (KST) ·{" "}
          {githubRunConclusionLabel(latest.conclusion, latest.status)}
        </p>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">최근 실행 기록 없음</p>
      )}
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{hint}</p> : null}
      <p className="mt-1 break-all font-mono text-[11px] text-zinc-600">
        cron(UTC) {row.crons.join(" · ")}
      </p>
      {latest?.htmlUrl ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={latest.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-white/5"
          >
            GitHub 실행 원문 ↗
          </a>
        </div>
      ) : null}
      {row.group ? <RunHistory group={row.group} formatDate={formatDate} /> : null}
    </article>
  );
}

export function GithubAutomationCoverageSection({
  view,
  formatDate,
}: {
  view: AutomationCoverageView;
  formatDate: FormatDate;
}) {
  const attentionRows = view.rows.filter((row) => row.needsAction);
  const healthyRows = view.rows.filter((row) => !row.needsAction);
  return (
    <section className="mt-6" id="github-automation-coverage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">GitHub 정기 자동감사</h2>
        {view.status === "OK" ? (
          <span className="text-xs text-zinc-500">
            등록 {view.rows.length}개 · 실행 실패 {view.failedCount}건 · 미확인 {view.unverifiedCount}건
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        현재 main에 schedule이 등록된 workflow를 기준으로, GitHub Actions의 정기(schedule) 실행과
        대조합니다. 여기의 &apos;실행 실패&apos;는 GitHub 실행 결과이며, 점검 내용에서 발견된 문제는 각
        보고서 카드에 따로 표시됩니다. 원문은 각 실행 링크의 artifact와 job summary에서 볼 수 있습니다.
      </p>
      {view.status === "UNAVAILABLE" ? (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 text-sm text-amber-200">
          <span className="mr-2 rounded bg-zinc-500/15 px-2 py-1 text-[11px] font-bold text-zinc-300">
            {coverageStateLabel("UNAVAILABLE")}
          </span>
          정상으로 간주하지 않습니다. {view.error ?? "unknown"}
        </div>
      ) : (
        <>
          {attentionRows.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {attentionRows.map((row) => (
                <CoverageCard key={row.path} row={row} formatDate={formatDate} />
              ))}
            </div>
          ) : null}
          {healthyRows.length > 0 ? (
            <details className="mt-3 rounded-2xl border border-white/10 bg-[#11131a] p-4">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-300">
                정상 {healthyRows.length}개 · 펼쳐서 실행 기록 보기
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {healthyRows.map((row) => (
                  <CoverageCard key={row.path} row={row} formatDate={formatDate} />
                ))}
              </div>
            </details>
          ) : null}
          {view.unregistered.length > 0 ? (
            <div className="mt-6">
              <h3 className="text-sm font-bold text-zinc-300">schedule 등록이 없는 과거 실행</h3>
              <p className="mt-1 text-xs text-zinc-500">
                현재 main에는 cron이 없어 다시 실행되지 않는 workflow입니다. 기록으로만 보여 주며 확인 필요
                건수에 넣지 않습니다.
              </p>
              <div className="mt-2 space-y-1.5">
                {view.unregistered.map(({ group, latestRunFailed }) => (
                  <a
                    key={group.key}
                    href={group.latest.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#11131a] px-3 py-2 text-xs text-zinc-400 hover:bg-white/5"
                  >
                    <span className="min-w-0 break-words">
                      {automationDisplayName(group.path, group.name)} ·{" "}
                      <span className="break-all font-mono">{group.path}</span>
                    </span>
                    <span>
                      {formatDate(group.latest.createdAt)} ·{" "}
                      {githubRunConclusionLabel(group.latest.conclusion, group.latest.status)}
                      {latestRunFailed ? " (과거 기록)" : ""}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
