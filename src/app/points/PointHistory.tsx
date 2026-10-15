"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import ChargeCancelButton from "@/components/ChargeCancelButton";
import StatusNotice, { type StatusNoticeTone } from "@/components/StatusNotice";
import { ATTENDANCE_POINTS_VALID_DAYS, ATTENDANCE_TIMEZONE } from "@/lib/attendanceConstants";
import { FREE_POINTS_VALID_YEARS } from "@/lib/plans";
import {
  canShowChargeCancelButton,
  CHARGE_PAGE_SIZE,
  USAGE_PAGE_SIZE,
  type PointUsageLog,
} from "@/lib/pointUsageLog";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export type HistoryTab = "usage" | "paid" | "free";

export type HistoryPageData = {
  logs: PointUsageLog[];
  page: number;
  total: number;
  totalPages: number;
};

type TabState = HistoryPageData & { loading: boolean; failed: boolean };

type Note = { tone: StatusNoticeTone; text: string };

const TABS: ReadonlyArray<{ id: HistoryTab; label: string; empty: string }> = [
  { id: "usage", label: "사용 내역", empty: "아직 포인트를 사용한 내역이 없어요." },
  { id: "paid", label: "유료 충전", empty: "아직 결제 충전 내역이 없어요." },
  { id: "free", label: "무료 적립·출석", empty: "아직 무료 적립·출석 내역이 없어요." },
];

function formatLogTimestamp(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: ATTENDANCE_TIMEZONE });
}

function LogReason({ reason, createdAt }: { reason: string; createdAt: string }) {
  const withModel = reason.match(/^대화 · (.+?) \((.+)\)$/);
  return (
    <div className="min-w-0 flex-1">
      {withModel ? (
        <>
          <p className="break-words text-sm font-medium text-zinc-100 [overflow-wrap:anywhere]">
            대화 · {withModel[1]}
          </p>
          <p className="break-words text-[13px] leading-snug text-zinc-400 [overflow-wrap:anywhere]">{withModel[2]}</p>
        </>
      ) : (
        <p className="break-words text-sm font-medium text-zinc-100 [overflow-wrap:anywhere]">{reason}</p>
      )}
      <p className="mt-0.5 text-xs tabular-nums text-zinc-400">{formatLogTimestamp(createdAt)}</p>
    </div>
  );
}

function PointLogList({
  logs,
  empty,
  onToast,
  onRefresh,
}: {
  logs: PointUsageLog[];
  empty: string;
  onToast: (text: string, tone: Note["tone"]) => void;
  onRefresh: () => void;
}) {
  if (logs.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-zinc-400" data-testid="history-empty">
        {empty}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-white/5">
      {logs.map((l) => (
        <li key={l.id ?? `${l.created_at}-${l.reason}`} className="px-4 py-3" data-testid="history-row">
          <div className="flex items-start justify-between gap-3">
            <LogReason reason={l.reason} createdAt={l.created_at} />
            <span
              className={cn(
                "shrink-0 text-right text-base font-semibold tabular-nums",
                l.delta >= 0 ? "text-violet-300" : "text-rose-300",
              )}
            >
              {l.delta >= 0 ? "+" : ""}
              {l.delta.toLocaleString("ko-KR")}P
            </span>
          </div>
          {canShowChargeCancelButton(l) && (
            <div className="mt-2">
              <ChargeCancelButton
                pointLogId={l.id ?? 0}
                cancelled={!!l.charge_cancelled}
                state={l.charge_cancel_state}
                disabled={!l.can_cancel_charge}
                blockReason={l.charge_cancel_block_reason}
                onToast={onToast}
                onCancelled={onRefresh}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Pagination({
  page,
  totalPages,
  loading,
  onPage,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const btn =
    "min-h-11 min-w-20 rounded-xl border border-white/10 px-4 text-sm font-semibold text-zinc-200 transition hover:border-violet-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav className="mt-3 flex items-center justify-center gap-3" aria-label="포인트 내역 페이지">
      <button type="button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)} className={btn}>
        이전
      </button>
      <span className="min-w-16 text-center text-sm tabular-nums text-zinc-300" aria-current="page">
        {page} / {totalPages}
      </span>
      <button type="button" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)} className={btn}>
        다음
      </button>
    </nav>
  );
}

function toState(data: HistoryPageData): TabState {
  return { ...data, loading: false, failed: false };
}

type Props = {
  usage: HistoryPageData;
  paid: HistoryPageData;
  free: HistoryPageData;
  anchorId: string;
  onRefresh: () => void;
};

export default function PointHistory({ usage, paid, free, anchorId, onRefresh }: Props) {
  const [tab, setTab] = useState<HistoryTab>("usage");
  const [state, setState] = useState<Record<HistoryTab, TabState>>({
    usage: toState(usage),
    paid: toState(paid),
    free: toState(free),
  });
  const [note, setNote] = useState<Note | null>(null);
  const requestSeq = useRef<Record<HistoryTab, number>>({ usage: 0, paid: 0, free: 0 });
  const tabRefs = useRef<Record<HistoryTab, HTMLButtonElement | null>>({ usage: null, paid: null, free: null });

  useEffect(() => {
    setState((prev) => ({ ...prev, usage: toState(usage) }));
  }, [usage]);
  useEffect(() => {
    setState((prev) => ({ ...prev, paid: toState(paid) }));
  }, [paid]);
  useEffect(() => {
    setState((prev) => ({ ...prev, free: toState(free) }));
  }, [free]);

  const loadPage = useCallback(async (kind: HistoryTab, page: number) => {
    const seq = ++requestSeq.current[kind];
    setState((prev) => ({ ...prev, [kind]: { ...prev[kind], loading: true, failed: false } }));
    try {
      const res = await fetch(`/api/points/logs?type=${kind}&page=${page}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as HistoryPageData;
      if (seq !== requestSeq.current[kind]) return;
      setState((prev) => ({
        ...prev,
        [kind]: { logs: data.logs, page: data.page, total: data.total, totalPages: data.totalPages, loading: false, failed: false },
      }));
    } catch {
      if (seq !== requestSeq.current[kind]) return;
      setState((prev) => ({ ...prev, [kind]: { ...prev[kind], loading: false, failed: true } }));
    }
  }, []);

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    const next =
      e.key === "ArrowRight" ? (index + 1) % TABS.length : e.key === "ArrowLeft" ? (index + last) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    setNote(null);
    tabRefs.current[id]?.focus();
  }

  const current = state[tab];
  const meta = TABS.find((t) => t.id === tab)!;
  const caption =
    current.total <= 0
      ? null
      : tab === "usage"
        ? `최근 ${Math.min(current.total, 100).toLocaleString()}건 · ${USAGE_PAGE_SIZE}건씩 표시`
        : tab === "paid"
          ? `최근 ${Math.min(current.total, 100).toLocaleString()}건 · ${CHARGE_PAGE_SIZE}건씩 · 결제 충전·선물 수령`
          : `최근 ${Math.min(current.total, 100).toLocaleString()}건 · ${CHARGE_PAGE_SIZE}건씩 · 출석(${ATTENDANCE_POINTS_VALID_DAYS}일)·이벤트/충전 보너스(${FREE_POINTS_VALID_YEARS}년)`;

  return (
    <section id={anchorId} aria-labelledby="points-history-title" data-testid="point-history" className="scroll-mt-28">
      <h2 id="points-history-title" className={studioType.sectionTitle}>
        포인트 내역
      </h2>
      <div className={cn(studioSurface.tabList, "mt-3")} role="tablist" aria-label="포인트 내역 탭">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            id={`point-history-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="point-history-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => {
              setTab(t.id);
              setNote(null);
            }}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={cn(
              "min-h-11 flex-1 rounded-lg px-1 text-sm font-semibold transition",
              tab === t.id ? studioSurface.tabActive : studioSurface.tabIdle,
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {caption && <p className={cn(studioType.caption, "mt-2")}>{caption}</p>}

      {note && (
        <StatusNotice tone={note.tone} className="mt-3" testId="history-notice">
          {note.text}
        </StatusNotice>
      )}

      <div
        id="point-history-panel"
        role="tabpanel"
        aria-labelledby={`point-history-tab-${tab}`}
        aria-busy={current.loading}
        className={cn("mt-3 overflow-hidden", studioSurface.card)}
      >
        {current.loading ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-400" data-testid="history-loading">
            불러오는 중…
          </p>
        ) : current.failed ? (
          <div className="px-4 py-6 text-center" data-testid="history-failed" role="alert">
            <p className="text-sm text-rose-200">내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
            <button
              type="button"
              onClick={() => void loadPage(tab, current.page)}
              className="mt-3 min-h-11 rounded-xl border border-white/10 px-4 text-sm font-semibold text-zinc-200 hover:border-violet-500/40"
            >
              다시 불러오기
            </button>
          </div>
        ) : (
          <PointLogList
            logs={current.logs}
            empty={meta.empty}
            onToast={(text, tone) => setNote({ tone, text })}
            onRefresh={onRefresh}
          />
        )}
      </div>

      <Pagination page={current.page} totalPages={current.totalPages} loading={current.loading} onPage={(page) => void loadPage(tab, page)} />
    </section>
  );
}
