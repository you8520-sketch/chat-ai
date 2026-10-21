import Link from "next/link";
import type { ReactNode } from "react";

import type {
  AttentionBucket,
  AttentionDashboard,
  AttentionItem,
  AttentionSeverity,
} from "@/lib/adminAutomationAttention";
import { formatKstDateTime } from "@/lib/adminAutomationStatus";

export function attentionTone(bucket: AttentionBucket, severity: AttentionSeverity): string {
  switch (bucket) {
    case "ACTION":
      return severity === "critical"
        ? "bg-rose-500/15 text-rose-300"
        : "bg-amber-500/15 text-amber-300";
    case "AUTO":
      return "bg-sky-500/15 text-sky-300";
    case "UNKNOWN":
      return "bg-zinc-500/20 text-zinc-300";
    case "OK":
      return "bg-emerald-500/15 text-emerald-300";
    default: {
      const _exhaustive: never = bucket;
      return _exhaustive;
    }
  }
}

function SummaryCard({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  hint: string;
  tone: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-[#11131a] p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={"mt-2 text-2xl font-black " + tone}>
        {value}
        {unit}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">{hint}</p>
    </div>
  );
}

function ItemLinks({ item }: { item: AttentionItem }) {
  if (!item.runUrl && item.links.length === 0 && !item.opsIncidentId) return null;
  const linkClass =
    "rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-white/5";
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {item.runUrl ? (
        <a href={item.runUrl} target="_blank" rel="noreferrer" className={linkClass}>
          GitHub 실행 원문 ↗
        </a>
      ) : null}
      {item.links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target={link.href.startsWith("/") ? undefined : "_blank"}
          rel={link.href.startsWith("/") ? undefined : "noreferrer"}
          className={linkClass}
        >
          {link.label} {link.href.startsWith("/") ? "→" : "↗"}
        </a>
      ))}
      {item.opsIncidentId ? (
        <Link href="/admin/ops" className={linkClass}>
          운영 예외함에서 보기 →
        </Link>
      ) : null}
    </div>
  );
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const [summary, ...more] = item.reasons;
  return (
    <li className="min-w-0 rounded-2xl border border-white/10 bg-[#11131a] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 break-words font-bold text-zinc-100">{item.title}</h3>
        <span
          className={
            "shrink-0 rounded px-2 py-1 text-[11px] font-bold " +
            attentionTone(item.bucket, item.severity)
          }
        >
          {item.statusLabel}
        </span>
      </div>
      {summary ? (
        <p className="mt-2 break-words text-sm leading-relaxed text-zinc-300">{summary}</p>
      ) : null}
      {more.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-zinc-500">
          {more.map((reason) => (
            <li key={reason} className="break-words">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-zinc-500">
        마지막 실행 · {item.lastRunAt ? `${formatKstDateTime(item.lastRunAt)} (KST)` : "기록 없음"}
      </p>
      {item.nextAction ? (
        <p className="mt-1 break-words text-xs leading-relaxed text-amber-200/90">
          다음 행동 · {item.nextAction}
        </p>
      ) : null}
      <ItemLinks item={item} />
      {item.technical.length > 0 ? (
        <p className="mt-2 break-all font-mono text-[11px] text-zinc-600">
          원문 상태 · {item.technical.join(" / ")}
        </p>
      ) : null}
    </li>
  );
}

function CompactRow({ item }: { item: AttentionItem }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-white/5 bg-black/15 px-3 py-2 text-xs">
      <span className="min-w-0 break-words font-semibold text-zinc-200">{item.title}</span>
      <span className="flex flex-wrap items-center gap-2 text-zinc-500">
        <span
          className={
            "rounded px-1.5 py-0.5 text-[10px] font-bold " +
            attentionTone(item.bucket, item.severity)
          }
        >
          {item.statusLabel}
        </span>
        {item.lastRunAt ? formatKstDateTime(item.lastRunAt) : "기록 없음"}
        {item.runUrl ? (
          <a href={item.runUrl} target="_blank" rel="noreferrer" className="text-violet-300 hover:text-violet-200">
            원문 ↗
          </a>
        ) : null}
      </span>
    </li>
  );
}

function Fold({
  summary,
  open,
  children,
}: {
  summary: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="mt-3 rounded-2xl border border-white/10 bg-[#11131a] p-4">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-300">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function AutomationAttentionSummary({
  dashboard,
  githubWorkflowCount,
  schedulerCount,
}: {
  dashboard: AttentionDashboard;
  githubWorkflowCount: number | null;
  schedulerCount: number;
}) {
  return (
    <section className="mt-6" aria-label="자동화 상태 요약">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="확인 필요"
          value={dashboard.action.length}
          unit="건"
          tone={dashboard.action.length > 0 ? "text-amber-300" : "text-zinc-100"}
          hint="실행 실패·점검 문제·승인 대기·조회 장애. 같은 원인은 1건"
        />
        <SummaryCard
          label="자동 처리 중"
          value={dashboard.auto.length}
          unit="건"
          tone={dashboard.auto.length > 0 ? "text-sky-300" : "text-zinc-100"}
          hint="실행 중인 것이 확인된 작업만"
        />
        <SummaryCard
          label="정상"
          value={dashboard.ok.length}
          unit="개"
          tone="text-emerald-300"
          hint="최신 실행·점검이 정상으로 확인됨"
        />
        <SummaryCard
          label="미확인"
          value={dashboard.unknown.length}
          unit="건"
          tone="text-zinc-200"
          hint="기록 없음·오래된 결과·조회 불가. 정상으로 세지 않음"
        />
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">
        GitHub 정기 자동화{" "}
        {githubWorkflowCount == null ? "목록 조회 불가" : `${githubWorkflowCount}개(main 등록 기준)`} · 사이트 내부 scheduler{" "}
        {schedulerCount}개(durable registry 기준)
      </p>
    </section>
  );
}

export function AutomationAttentionList({ dashboard }: { dashboard: AttentionDashboard }) {
  return (
    <section className="mt-6" id="attention-now" aria-label="지금 확인할 일">
      <h2 className="text-lg font-black">지금 확인할 일</h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        실제 조치가 필요한 항목만 모았습니다. 연구 후보, 지난 실패 기록, 확인되지 않은 상태는 여기에
        섞지 않고 아래에서 따로 보여 줍니다.
      </p>

      {dashboard.action.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-4 text-sm text-emerald-200">
          지금 바로 확인할 항목이 없습니다.
          {dashboard.unknown.length > 0
            ? ` 다만 상태를 확인하지 못한 항목이 ${dashboard.unknown.length}건 있어 정상으로 세지 않았습니다.`
            : ""}
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {dashboard.action.map((item) => (
            <AttentionCard key={item.key} item={item} />
          ))}
        </ul>
      )}

      {dashboard.auto.length > 0 ? (
        <Fold open summary={`자동 처리 중 ${dashboard.auto.length}건`}>
          <ul className="space-y-2">
            {dashboard.auto.map((item) => (
              <CompactRow key={item.key} item={item} />
            ))}
          </ul>
        </Fold>
      ) : null}

      {dashboard.unknown.length > 0 ? (
        <Fold
          open={dashboard.action.length === 0}
          summary={`상태 미확인 ${dashboard.unknown.length}건 · 정상으로 계산하지 않음`}
        >
          <ul className="space-y-3">
            {dashboard.unknown.map((item) => (
              <AttentionCard key={item.key} item={item} />
            ))}
          </ul>
        </Fold>
      ) : null}

      {dashboard.ok.length > 0 ? (
        <Fold summary={`정상 ${dashboard.ok.length}개`}>
          <ul className="space-y-2">
            {dashboard.ok.map((item) => (
              <CompactRow key={item.key} item={item} />
            ))}
          </ul>
        </Fold>
      ) : null}

      {dashboard.history.length > 0 ? (
        <Fold summary={`과거 기록 ${dashboard.history.length}건 · 현재 일정이 없는 workflow`}>
          <p className="mb-2 text-xs leading-relaxed text-zinc-500">
            main에 schedule이 없어 다시 실행되지 않는 workflow입니다. 마지막 실행 결과를 기록으로만
            보여 주며 확인 필요 건수에 넣지 않습니다.
          </p>
          <ul className="space-y-2">
            {dashboard.history.map((row) => (
              <li
                key={row.path}
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-white/5 bg-black/15 px-3 py-2 text-xs"
              >
                <span className="min-w-0 break-words text-zinc-300">
                  {row.name} <span className="break-all font-mono text-[11px] text-zinc-600">{row.path}</span>
                </span>
                <a
                  href={row.runUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  {formatKstDateTime(row.lastRunAt)} · {row.outcomeLabel}
                  {row.latestRunFailed ? " (과거 기록)" : ""} ↗
                </a>
              </li>
            ))}
          </ul>
        </Fold>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
        외부 Cursor Automation이 후속 조치를 하고 있는지는 이 화면이 조회하지 않습니다. 연동 증거가
        없으므로 &apos;자동 처리 중&apos;이나 &apos;처리 완료&apos;로 계산하지 않습니다.
      </p>
    </section>
  );
}
