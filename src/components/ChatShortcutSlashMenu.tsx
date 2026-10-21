"use client";

import { useEffect, useRef } from "react";
import type { ChatShortcutListItem, ChatShortcutListPhase } from "@/components/ChatShortcutsDock";

export const SHORTCUT_SLASH_EMPTY_MESSAGE = "일치하는 단축어 없음";

export function slashOptionId(menuId: string, index: number): string {
  return `${menuId}-option-${index}`;
}

/** Name and one-line description only. The saved body is never rendered here. */
export function ChatShortcutSlashMenu({
  id,
  items,
  phase,
  activeIndex,
  onPick,
  onActiveChange,
}: {
  id: string;
  items: readonly ChatShortcutListItem[];
  phase: ChatShortcutListPhase;
  activeIndex: number;
  onPick: (item: ChatShortcutListItem) => void;
  onActiveChange: (index: number) => void;
}) {
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items]);

  const statusText =
    phase === "idle" || phase === "loading"
      ? items.length === 0
        ? "단축어를 불러오는 중…"
        : null
      : phase === "error" && items.length === 0
        ? "단축어를 불러오지 못했습니다."
        : items.length === 0
          ? SHORTCUT_SLASH_EMPTY_MESSAGE
          : null;

  return (
    <div
      data-testid="chat-shortcut-slash-menu"
      onMouseDown={(event) => event.preventDefault()}
      className="absolute inset-x-0 bottom-full z-40 mb-1 overflow-hidden rounded-xl border border-white/15 bg-[#161616] shadow-2xl shadow-black/60"
    >
      {statusText ? (
        <p
          role="status"
          data-testid="chat-shortcut-slash-empty"
          className="px-3 py-3 text-xs text-zinc-300"
        >
          {statusText}
        </p>
      ) : (
        <ul
          id={id}
          role="listbox"
          aria-label="개인 단축어"
          className="max-h-[min(14rem,36dvh)] overflow-y-auto overscroll-contain py-1"
        >
          {items.map((item, index) => {
            const active = index === activeIndex;
            return (
              <li
                key={item.id}
                id={slashOptionId(id, index)}
                ref={active ? activeRef : undefined}
                role="option"
                aria-selected={active}
                data-testid="chat-shortcut-slash-option"
                data-active={active ? "true" : undefined}
                onMouseMove={() => {
                  if (!active) onActiveChange(index);
                }}
                onClick={() => onPick(item)}
                className={`flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1.5 ${
                  active ? "bg-violet-500/20" : "hover:bg-white/5"
                }`}
              >
                <span className="truncate text-[13px] font-semibold text-zinc-100">
                  {item.favorite ? "★ " : ""}
                  {item.name}
                </span>
                {item.description ? (
                  <span className="truncate text-xs text-zinc-400">{item.description}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
