"use client";

import { useMemo, useState } from "react";
import {
  explorationQueueCost,
  publicOpenExits,
  type ExplorationCommand,
  type PublicExploration,
  type PublicExplorationDiscovery,
  type PublicExplorationRoom,
} from "@/lib/trpg/explorationPublic";

const MARKER_LABEL: Record<PublicExplorationRoom["markers"][number], string> = {
  clue: "단서",
  reward: "물자",
  hazard: "위험",
  exit: "목표",
  passage: "통로",
};

const DISCOVERY_LABEL: Record<PublicExplorationDiscovery["kind"], string> = {
  clue: "단서",
  item: "획득",
  open: "길 열림",
  hazard: "위험",
};

function roomAfterQueue(exploration: PublicExploration, queue: readonly ExplorationCommand[]): string | null {
  let room = exploration.currentRoomId;
  for (const command of queue) {
    if (command.op !== "move" || !room) continue;
    if (publicOpenExits(exploration, room).includes(command.roomId)) room = command.roomId;
  }
  return room;
}

function goalParticle(name: string): "로" | "으로" {
  const last = name.charCodeAt(name.length - 1);
  const jong = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : 0;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

function commandLabel(exploration: PublicExploration, command: ExplorationCommand): string {
  if (command.op === "search") return command.depth === "careful" ? "정밀 조사" : "조사";
  const name = exploration.rooms.find((item) => item.id === command.roomId)?.label ?? "?";
  return `${name}${goalParticle(name)} 이동`;
}

function lockedFrom(exploration: PublicExploration, roomId: string | null): PublicExplorationRoom[] {
  if (!roomId) return [];
  return exploration.edges.flatMap((edge) => {
    if (!edge.locked) return [];
    const other = edge.from === roomId ? edge.to : edge.to === roomId ? edge.from : "";
    const room = other ? exploration.rooms.find((item) => item.id === other) : undefined;
    return room ? [room] : [];
  });
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
  const planned = exploration.rooms.find((room) => room.id === plannedRoom);
  const exits = publicOpenExits(exploration, plannedRoom)
    .map((id) => exploration.rooms.find((room) => room.id === id))
    .filter((room): room is PublicExplorationRoom => Boolean(room));
  const shut = lockedFrom(exploration, plannedRoom);
  const legacy = exploration.legacy;
  const maxX = Math.max(...exploration.rooms.map((room) => room.x), 1);
  const maxY = Math.max(...exploration.rooms.map((room) => room.y), 1);
  const left = (x: number) => (x / maxX) * 78 + 11;
  const top = (y: number) => (1 - y / maxY) * 72 + 14;
  const canQueue = !locked && Boolean(onQueue);

  return (
    <section
      data-trpg-exploration={open ? "expanded" : "collapsed"}
      data-exploration-ap={exploration.ap}
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
          <span className="block truncate text-xs text-zinc-400" data-exploration-summary>
            {here?.label ?? "위치 확인 중"} · 행동력 {exploration.ap}
            {legacy ? ` · 위험도 ${legacy.risk}${legacy.alarm ? " · 위험 고조" : ""}` : ""}
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
                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    x1={left(from.x)}
                    y1={top(from.y)}
                    x2={left(to.x)}
                    y2={top(to.y)}
                    stroke={edge.locked ? "rgba(252,211,77,0.7)" : "rgba(255,255,255,0.78)"}
                    strokeWidth="2"
                    strokeDasharray={edge.locked ? "4 4" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
            {exploration.rooms.map((room) => {
              const reachable = exits.some((exit) => exit.id === room.id);
              return (
                <button
                  key={room.id}
                  type="button"
                  title={room.label}
                  aria-label={room.label}
                  disabled={!canQueue || !reachable}
                  data-exploration-room={room.id}
                  data-exploration-known={room.visited ? "yes" : "no"}
                  onClick={() => onQueue?.({ op: "move", roomId: room.id })}
                  className={`absolute flex h-11 min-w-11 max-w-[5.5rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-lg border px-1 text-[11px] leading-tight ${
                    room.current
                      ? "border-violet-300 bg-violet-600 text-white"
                      : reachable && canQueue
                        ? "border-emerald-300/70 bg-[#173026]"
                        : room.visited
                          ? "border-white/20 bg-[#1c2230]"
                          : "border-dashed border-white/30 bg-[#0e1118] text-zinc-400"
                  } disabled:opacity-80`}
                  style={{ left: `${left(room.x)}%`, top: `${top(room.y)}%` }}
                >
                  <span className="max-w-full truncate">{room.label}</span>
                  {room.markers.length ? (
                    <span className="text-[9px] text-amber-200">{room.markers.map((marker) => MARKER_LABEL[marker]).join(" ")}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#171b27] px-3 py-2" data-exploration-place>
            <p className="text-xs text-zinc-400">{plannedRoom && plannedRoom !== exploration.currentRoomId ? "이동 후 위치" : "지금 위치"}</p>
            <p className="break-keep text-sm font-semibold">{planned?.label ?? "위치 확인 중"}</p>
            {planned?.summary ? <p className="mt-1 break-keep text-xs text-zinc-300">{planned.summary}</p> : null}
          </div>
          <div className="space-y-1" data-exploration-exits>
            <p className="text-xs text-zinc-400">열린 길</p>
            {exits.length ? (
              <div className="flex flex-wrap gap-2">
                {exits.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    disabled={!canQueue}
                    data-exploration-exit={room.id}
                    onClick={() => onQueue?.({ op: "move", roomId: room.id })}
                    className="min-h-11 max-w-full break-keep rounded-xl border border-emerald-300/40 px-3 text-left text-sm disabled:opacity-60"
                  >
                    {room.label}
                    {goalParticle(room.label)} 이동 1
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">지금 지날 수 있는 길이 없습니다.</p>
            )}
            {shut.length ? (
              <p className="break-keep text-xs text-amber-200/90" data-exploration-shut>
                닫힌 길: {shut.map((room) => room.label).join(", ")} · 단서나 조사로 열어야 합니다.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-xl border border-white/15 px-3 text-sm"
              disabled={!canQueue || !plannedRoom}
              onClick={() => onQueue?.({ op: "search", depth: "normal" })}
            >
              조사 1
            </button>
            <button
              type="button"
              className="min-h-11 rounded-xl border border-white/15 px-3 text-sm"
              disabled={!canQueue || !plannedRoom}
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
                  <span className="min-w-0 break-keep">
                    {index + 1}. {commandLabel(exploration, command)}
                  </span>
                  <button type="button" className="min-h-11 shrink-0 px-2 text-xs text-zinc-300" onClick={() => onRemove?.(index)}>
                    빼기
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500">열린 길을 누르거나 조사하면 이번 행동에 붙습니다. 자유 입력과 함께 보낼 수 있습니다.</p>
          )}
          {exploration.discoveries.length ? (
            <div className="space-y-1" data-exploration-discoveries>
              <p className="text-xs text-zinc-400">일행이 알아낸 것</p>
              <ul className="space-y-1">
                {exploration.discoveries.map((item, index) => (
                  <li key={`${item.place}-${index}`} className="break-keep rounded-lg bg-white/5 px-2 py-1.5 text-xs text-zinc-200">
                    <span className="mr-1 font-semibold text-amber-200">{DISCOVERY_LABEL[item.kind]}</span>
                    <span className="text-zinc-400">{item.place} · </span>
                    {item.text}
                    {item.item ? <span className="text-emerald-200"> ({item.item})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
