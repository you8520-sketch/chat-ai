"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminOpsIncident,
  AdminOpsIncidentSource,
} from "@/lib/adminOpsInboxShared";

type SourceFilter = "all" | AdminOpsIncidentSource;

const SOURCE_LABEL: Record<AdminOpsIncidentSource, string> = {
  scheduler: "스케줄러",
  payout: "크리에이터 출금",
  point_refund: "포인트 환불",
};

function ageLabel(ageMinutes: number | null): string {
  if (ageMinutes == null) return "경과시간 미확정";
  if (ageMinutes < 60) return `${ageMinutes}분 경과`;
  const hours = Math.floor(ageMinutes / 60);
  if (hours < 48) return `${hours}시간 경과`;
  return `${Math.floor(hours / 24)}일 경과`;
}

export default function AdminOpsInboxClient({
  initialIncidents,
  stuckExecutionMinutes,
}: {
  initialIncidents: AdminOpsIncident[];
  stuckExecutionMinutes: number;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<SourceFilter>("all");
  const visible = useMemo(
    () =>
      filter === "all"
        ? initialIncidents
        : initialIncidents.filter((incident) => incident.source === filter),
    [filter, initialIncidents]
  );

  const critical = initialIncidents.filter((incident) => incident.severity === "critical").length;
  const warning = initialIncidents.length - critical;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 text-zinc-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-200">
            ← 설정
          </Link>
          <h1 className="mt-2 text-2xl font-black">운영 예외함</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-500">
            canonical durable 상태를 읽어 모은 read-only projection입니다. 이 화면은 상태를
            변경하거나 provider 재요청·재송금·재환불을 수행하지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-xl border border-white/10 bg-[#11131a] px-4 py-2 text-sm font-semibold hover:bg-[#181b24]"
        >
          새로고침
        </button>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
          <p className="text-xs text-zinc-500">열린 운영 예외</p>
          <p className="mt-2 text-2xl font-black">{initialIncidents.length}건</p>
        </div>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-950/10 p-4">
          <p className="text-xs text-rose-300/70">Critical</p>
          <p className="mt-2 text-2xl font-black text-rose-300">{critical}건</p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-4">
          <p className="text-xs text-amber-300/70">Warning</p>
          <p className="mt-2 text-2xl font-black text-amber-300">{warning}건</p>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-sky-500/20 bg-sky-950/10 p-4 text-xs leading-relaxed text-zinc-400">
        <p>
          진행 상태인 CLAIMED / DISPATCHED / REQUESTED는 즉시 사고로 분류하지 않고{" "}
          <strong className="text-zinc-200">{stuckExecutionMinutes}분</strong> 이상 지속될 때만
          예외함에 표시합니다. RECONCILIATION_REQUIRED와 scheduler의 실패·stale·누락은
          canonical 상태를 그대로 반영합니다.
        </p>
      </section>

      <div className="mt-5 flex flex-wrap gap-2">
        {([
          ["all", "전체"],
          ["scheduler", SOURCE_LABEL.scheduler],
          ["payout", SOURCE_LABEL.payout],
          ["point_refund", SOURCE_LABEL.point_refund],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              filter === id ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <section className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-6">
          <p className="font-bold text-emerald-300">현재 표시할 운영 예외가 없습니다.</p>
          <p className="mt-1 text-sm text-zinc-500">
            비활성 scheduler와 registry 적용 전 슬롯은 incident로 계산하지 않습니다.
          </p>
        </section>
      ) : (
        <ul className="mt-6 space-y-3">
          {visible.map((incident) => (
            <li
              key={incident.id}
              className="rounded-2xl border border-white/10 bg-[#11131a] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                        incident.severity === "critical"
                          ? "bg-rose-500/15 text-rose-300"
                          : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {incident.severity.toUpperCase()}
                    </span>
                    <span className="text-xs text-zinc-500">{SOURCE_LABEL[incident.source]}</span>
                    <span className="font-mono text-[11px] text-zinc-600">{incident.state}</span>
                  </div>
                  <h2 className="mt-2 font-bold text-zinc-100">{incident.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{incident.summary}</p>
                  <p className="mt-2 font-mono text-[11px] text-zinc-600">
                    {incident.sourceRef}
                    {incident.occurredAt ? ` · ${incident.occurredAt} UTC` : ""}
                    {incident.ageMinutes != null ? ` · ${ageLabel(incident.ageMinutes)}` : ""}
                  </p>
                </div>
                {incident.href ? (
                  <Link
                    href={incident.href}
                    className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-white/5"
                  >
                    owner 화면 →
                  </Link>
                ) : (
                  <span className="shrink-0 text-[11px] text-zinc-600">전용 admin owner 없음</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
