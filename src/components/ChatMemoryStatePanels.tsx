"use client";

import { useMemo, useState } from "react";
import type {
  RelationshipLedgerEvent,
  RelationshipLedgerEventCategory,
  RelationshipLedgerEventValidity,
} from "@/lib/memory/memory-relationship-timeline-types";

export type MemoryTabId = "state" | "events" | "records" | "manual";

export const MEMORY_TABS: { id: MemoryTabId; label: string }[] = [
  { id: "state", label: "현재 상태" },
  { id: "events", label: "중요 사건" },
  { id: "records", label: "5턴 기록" },
  { id: "manual", label: "직접 기억" },
];

export type LedgerMeta = {
  honorifics: string[];
  items: string[];
  promises: { text: string; deadline?: string }[];
};

export type DeletableLedgerCategory = "items" | "promises";

const VALIDITY_LABEL: Record<RelationshipLedgerEventValidity, string> = {
  active: "현재 유효",
  ended: "종료됨",
  superseded: "이후 변경됨",
  absent: "현재 목록에 없음",
};

const VALIDITY_STYLE: Record<RelationshipLedgerEventValidity, string> = {
  active: "border-emerald-500/40 text-emerald-300",
  ended: "border-zinc-500/40 text-zinc-400",
  superseded: "border-zinc-600/40 text-zinc-500",
  absent: "border-amber-500/40 text-amber-300/90",
};

const CATEGORY_LABEL: Record<RelationshipLedgerEventCategory, string> = {
  promise: "약속",
  item: "소지품",
};

function changeLabel(event: RelationshipLedgerEvent): string {
  if (event.change === "created") return event.category === "promise" ? "약속됨" : "생김";
  if (event.change === "released") return event.category === "promise" ? "해제됨" : "사라짐";
  return "내용 변경";
}

export function MemoryTabBar({
  active,
  onChange,
}: {
  active: MemoryTabId;
  onChange: (id: MemoryTabId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="기억 보기"
      className="grid grid-cols-4 gap-1 rounded-lg border border-white/5 bg-[#121212]/70 p-1"
    >
      {MEMORY_TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`rounded-md px-1 py-1.5 text-[11px] font-semibold transition-colors ${
              selected
                ? "bg-violet-500/20 text-violet-100"
                : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function SourceButton({
  turn,
  messageId,
  onJump,
}: {
  turn: number;
  messageId: number;
  onJump: (messageId: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(messageId)}
      className="rounded border border-sky-500/30 px-1.5 py-0.5 text-[10px] text-sky-200/90 hover:bg-sky-500/10"
      aria-label={`${turn}턴 원문 보기`}
    >
      제{turn}턴 원문 보기
    </button>
  );
}

function latestActiveEvent(
  events: readonly RelationshipLedgerEvent[],
  category: RelationshipLedgerEventCategory,
  key: string
): RelationshipLedgerEvent | undefined {
  return [...events]
    .reverse()
    .find(
      (event) =>
        event.category === category &&
        event.key === key &&
        event.change !== "released" &&
        event.validity === "active"
    );
}

function possessionKeyOf(line: string): string {
  const idx = line.indexOf(":");
  return idx > 0 ? line.slice(0, idx).trim() : line;
}

export function MemoryCurrentStatePanel({
  meta,
  events,
  busyKey,
  onDelete,
  onJump,
  onOpenEvents,
}: {
  meta: LedgerMeta;
  events: readonly RelationshipLedgerEvent[];
  busyKey: string | null;
  onDelete: (category: DeletableLedgerCategory, text: string) => void;
  onJump: (messageId: number) => void;
  onOpenEvents: () => void;
}) {
  const endedPromiseCount = new Set(
    events
      .filter((e) => e.category === "promise" && e.validity === "ended")
      .map((e) => e.key)
  ).size;

  return (
    <div className="space-y-3" role="tabpanel" aria-label="현재 상태">
      <p className="text-[10px] leading-relaxed text-zinc-500">
        지금 이야기에서 유효한 약속과 소지품입니다. 과거에 있었던 변화는 &apos;중요 사건&apos;에서 볼 수 있습니다.
      </p>

      <section className="rounded-lg border border-violet-500/20 bg-violet-950/10 p-2.5">
        <h3 className="mb-1.5 text-[11px] font-bold text-violet-200/90">
          유효한 약속 <span className="font-normal text-zinc-500">({meta.promises.length})</span>
        </h3>
        {meta.promises.length === 0 ? (
          <p className="text-[11px] text-zinc-500">
            현재 유효한 약속이 없습니다.
            {endedPromiseCount > 0 && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={onOpenEvents}
                  className="text-sky-300/90 underline-offset-2 hover:underline"
                >
                  종료된 약속 {endedPromiseCount}건 보기
                </button>
              </>
            )}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {meta.promises.map((promise) => {
              const source = latestActiveEvent(events, "promise", promise.text);
              const busy = busyKey === `promises:${promise.text}`;
              return (
                <li
                  key={promise.text}
                  className="rounded-md border border-white/10 bg-[#1a1a1a]/80 p-2"
                >
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-200">
                    {promise.text}
                  </p>
                  {promise.deadline && (
                    <p className="mt-0.5 text-[10px] text-zinc-500">기한: {promise.deadline}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-[10px] text-zinc-500">
                      {source ? `제${source.turn}턴 기록` : "기록 위치 없음"} · AI 자동 기록
                    </span>
                    <span className="flex gap-1.5">
                      {source && (
                        <SourceButton
                          turn={source.turn}
                          messageId={source.assistantMessageId}
                          onJump={onJump}
                        />
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete("promises", promise.text)}
                        className="rounded border border-rose-500/30 px-1.5 py-0.5 text-[10px] text-rose-300/90 hover:bg-rose-500/10 disabled:opacity-40"
                      >
                        {busy ? "삭제 중…" : "삭제"}
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-violet-500/20 bg-violet-950/10 p-2.5">
        <h3 className="mb-1.5 text-[11px] font-bold text-violet-200/90">
          소지품 <span className="font-normal text-zinc-500">({meta.items.length})</span>
        </h3>
        {meta.items.length === 0 ? (
          <p className="text-[11px] text-zinc-500">기록된 소지품이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {meta.items.map((line) => {
              const source = latestActiveEvent(events, "item", possessionKeyOf(line));
              const busy = busyKey === `items:${line}`;
              return (
                <li
                  key={line}
                  className="rounded-md border border-white/10 bg-[#1a1a1a]/80 p-2"
                >
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-200">
                    {line}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-[10px] text-zinc-500">
                      {source ? `제${source.turn}턴 기록` : "기록 위치 없음"} · AI 자동 기록
                    </span>
                    <span className="flex gap-1.5">
                      {source && (
                        <SourceButton
                          turn={source.turn}
                          messageId={source.assistantMessageId}
                          onJump={onJump}
                        />
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete("items", line)}
                        className="rounded border border-rose-500/30 px-1.5 py-0.5 text-[10px] text-rose-300/90 hover:bg-rose-500/10 disabled:opacity-40"
                      >
                        {busy ? "삭제 중…" : "삭제"}
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {meta.honorifics.length > 0 && (
        <section className="rounded-lg border border-white/5 bg-[#1a1a1a] p-2.5">
          <h3 className="mb-1 text-[11px] font-bold text-zinc-400">호칭</h3>
          <p className="text-[11px] leading-relaxed text-zinc-400">{meta.honorifics.join(" · ")}</p>
        </section>
      )}
    </div>
  );
}

type EventFilter = "all" | RelationshipLedgerEventCategory;

export function MemoryEventsPanel({
  events,
  onJump,
}: {
  events: readonly RelationshipLedgerEvent[];
  onJump: (messageId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EventFilter>("all");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...events]
      .reverse()
      .filter((event) => filter === "all" || event.category === filter)
      .filter((event) => {
        if (!needle) return true;
        const haystack = [
          event.label,
          event.previousLabel ?? "",
          CATEGORY_LABEL[event.category],
          changeLabel(event),
          VALIDITY_LABEL[event.validity],
          `${event.turn}턴`,
          `제${event.turn}턴`,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
  }, [events, query, filter]);

  if (events.length === 0) {
    return (
      <div role="tabpanel" aria-label="중요 사건" className="space-y-1 py-3 text-center">
        <p className="text-[11px] text-zinc-400">기록된 약속·소지품 변화가 아직 없습니다.</p>
        <p className="text-[10px] leading-relaxed text-zinc-600">
          대화에서 약속을 하거나 취소하면, 언제 일어났는지 여기에 남습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5" role="tabpanel" aria-label="중요 사건">
      <p className="text-[10px] leading-relaxed text-zinc-500">
        약속과 소지품이 바뀐 순간을 AI가 자동 기록한 목록입니다. &apos;해제됨&apos;은 취소·이행·만료를 구분하지 않습니다.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="사건 검색"
          aria-label="사건 검색"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#1a1a1a] px-2 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
        />
        <div className="flex gap-1">
          {(["all", "promise", "item"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={`rounded-md border px-2 py-1 text-[10px] ${
                filter === id
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-100"
                  : "border-white/10 text-zinc-500 hover:bg-white/5"
              }`}
            >
              {id === "all" ? "전체" : CATEGORY_LABEL[id]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-zinc-600">
        {visible.length}건{query.trim() || filter !== "all" ? ` / 전체 ${events.length}건` : ""}
      </p>
      {visible.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-zinc-500">검색 결과가 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((event) => (
            <li
              key={event.id}
              className="rounded-md border border-white/10 bg-[#1a1a1a]/80 p-2"
            >
              <div className="mb-1 flex flex-wrap items-center gap-1">
                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-200">
                  {CATEGORY_LABEL[event.category]} {changeLabel(event)}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${VALIDITY_STYLE[event.validity]}`}
                >
                  {VALIDITY_LABEL[event.validity]}
                </span>
              </div>
              <p
                className={`whitespace-pre-wrap text-[11px] leading-relaxed ${
                  event.validity === "active" ? "text-zinc-200" : "text-zinc-400"
                }`}
              >
                {event.label}
              </p>
              {event.previousLabel && (
                <p className="mt-0.5 text-[10px] text-zinc-600">이전: {event.previousLabel}</p>
              )}
              <div className="mt-1.5 flex items-center justify-between gap-1.5">
                <span className="text-[10px] text-zinc-500">제{event.turn}턴 · AI 자동 기록</span>
                <SourceButton
                  turn={event.turn}
                  messageId={event.assistantMessageId}
                  onJump={onJump}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
