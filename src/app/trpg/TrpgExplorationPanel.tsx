"use client";

import { useMemo, useState } from "react";
import {
  explorationQueueCost,
  type ExplorationCommand,
  type PublicExploration,
  type PublicExplorationRoom,
} from "@/lib/trpg/explorationPublic";

const MARKER_LABEL: Record<PublicExplorationRoom["markers"][number], string> = {
  clue: "단서",
  reward: "물자",
  hazard: "위험",
  exit: "출구",
  passage: "통로",
};

function roomLinked(exploration: PublicExploration, from: string, to: string): boolean {
  return exploration.edges.some((edge) => (edge.from === from && edge.to === to) || (edge.to === from && edge.from === to));
}

function roomAfterQueue(exploration: PublicExploration, queue: readonly ExplorationCommand[]): string | null {
  let room = exploration.currentRoomId;
  for (const command of queue) {
    if (command.op !== "move" || !room) continue;
    if (roomLinked(exploration, room, command.roomId)) room = command.roomId;
  }
  return room;
}

function commandLabel(exploration: PublicExploration, command: ExplorationCommand, index: number, queue: readonly ExplorationCommand[]): string {
  if (command.op === "search") return command.depth === "careful" ? "정밀 조사" : "조사";
  const room = exploration.rooms.find((item) => item.id === command.roomId);
  const name = room?.visited ? room.label : "?";
  const last = name.charCodeAt(name.length - 1);
  const jong = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : 0;
  const particle = jong === 0 || jong === 8 ? "로" : "으로";
  return `${name}${particle} 이동`;
}

export default function TrpgExplorationPanel({
  exploration,
  queue,
  locked,
  onQueue,
  onRemove,
  initiallyOpen = false,
}: {
  exploration?: PublicExploration | null;
  queue: readonly ExplorationCommand[];
  locked: boolean;
  onQueue?: (command: ExplorationCommand) => void;
  onRemove?: (index: number) => void;
  /** Preview and tests only. The game room leaves this false so the panel starts collapsed. */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const plannedRoom = useMemo(() => (exploration ? roomAfterQueue(exploration, queue) : null), [exploration, queue]);
  if (!exploration) return null;
  const cost = explorationQueueCost(queue);
  const short = cost > exploration.ap;
  const here = exploration.rooms.find((room) => room.current);
  const maxX = Math.max(...exploration.rooms.map((room) => room.x), 1);
  const maxY = Math.max(...exploration.rooms.map((room) => room.y), 1);

  return (
    <section
      data-trpg-exploration={open ? "expanded" : "collapsed"}
      data-exploration-ap={exploration.ap}
      data-exploration-risk={exploration.risk}
      className="mb-3 rounded-2xl border border-white/10 bg-[#12151f] text-zinc-100"
    >
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">탐험 지도</span>
          <span className="block truncate text-xs text-zinc-400">
            {here?.label ?? "위치 확인 중"} · 행동력 {exploration.ap} · 위험도 {exploration.risk}
            {exploration.alarm ? " · 위험 고조" : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs text-zinc-300">{open ? "접기" : "펼치기"}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          <div className="relative h-72 w-full sm:h-80" data-trpg-exploration-map>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {exploration.edges.map((edge) => {
                const from = exploration.rooms.find((room) => room.id === edge.from);
                const to = exploration.rooms.find((room) => room.id === edge.to);
                if (!from || !to) return null;
                const x1 = (from.x / maxX) * 78 + 11;
                const y1 = (1 - from.y / maxY) * 72 + 14;
                const x2 = (to.x / maxX) * 78 + 11;
                const y2 = (1 - to.y / maxY) * 72 + 14;
                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="rgba(255,255,255,0.78)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            {exploration.rooms.map((room) => {
              const reachable = Boolean(plannedRoom && room.id !== plannedRoom && roomLinked(exploration, plannedRoom, room.id));
              return (
                <button
                  key={room.id}
                  type="button"
                  disabled={locked || !onQueue || !reachable}
                  data-exploration-room={room.id}
                  data-exploration-known={room.visited ? "yes" : "no"}
                  onClick={() => onQueue?.({ op: "move", roomId: room.id })}
                  className={`absolute flex h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-lg border px-1 text-[11px] leading-tight ${
                    room.current ? "border-violet-300 bg-violet-600 text-white" : room.visited ? "border-white/20 bg-[#1c2230]" : "border-dashed border-white/30 bg-[#0e1118] text-zinc-400"
                  } disabled:opacity-80`}
                  style={{ left: `${(room.x / maxX) * 78 + 11}%`, top: `${(1 - room.y / maxY) * 72 + 14}%` }}
                >
                  <span className="max-w-16 truncate">{room.visited ? room.label : "?"}</span>
                  {room.markers.length ? (
                    <span className="text-[9px] text-amber-200">{room.markers.map((marker) => MARKER_LABEL[marker]).join(" ")}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-xl border border-white/15 px-3 text-sm"
              disabled={locked || !onQueue || !plannedRoom}
              onClick={() => onQueue?.({ op: "search", depth: "normal" })}
            >
              조사 1
            </button>
            <button
              type="button"
              className="min-h-11 rounded-xl border border-white/15 px-3 text-sm"
              disabled={locked || !onQueue || !plannedRoom}
              onClick={() => onQueue?.({ op: "search", depth: "careful" })}
            >
              정밀 조사 2
            </button>
          </div>
          <p className={`text-xs ${short ? "text-rose-300" : "text-zinc-400"}`} data-exploration-queue-cost={cost}>
            제출 예정 {cost} / 행동력 {exploration.ap}
            {short ? " · 행동력이 부족합니다" : ""}. 지도는 명령을 만들 뿐이고, 확정은 서버가 합니다.
          </p>
          {queue.length ? (
            <ul className="space-y-1 text-sm">
              {queue.map((command, index) => (
                <li key={`${command.op}-${index}`} className="flex items-center justify-between gap-2">
                  <span>{index + 1}. {commandLabel(exploration, command, index, queue)}</span>
                  <button type="button" className="min-h-11 px-2 text-xs text-zinc-300" onClick={() => onRemove?.(index)}>
                    빼기
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500">인접한 방을 누르거나 조사하면 이번 행동에 붙습니다. 자유 입력과 함께 보낼 수 있습니다.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
