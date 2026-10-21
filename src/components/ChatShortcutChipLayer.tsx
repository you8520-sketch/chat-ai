"use client";

import { Fragment, useLayoutEffect, useRef, type RefObject } from "react";
import {
  SHORTCUT_CHIP_OPEN,
  findShortcutTokens,
  type ShortcutChip,
} from "@/lib/chatShortcutChips";

/**
 * Paints shortcut chips over the composer textarea. The textarea stays the single
 * editing surface (IME, caret, selection, paste); this layer mirrors its text with
 * identical metrics, keeps its own glyphs transparent, and only draws the chip pill
 * plus a pointer-only × target on top of the textarea's own "★ 이름 ×" label text.
 */
export function ChatShortcutChipLayer({
  value,
  chips,
  textareaRef,
  fontStyle,
  onRemove,
}: {
  value: string;
  chips: readonly ShortcutChip[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fontStyle: { fontSize: string; lineHeight: string };
  onRemove: (tokenStart: number) => void;
}) {
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const inner = innerRef.current;
    if (!textarea || !inner) return;
    const sync = () => {
      inner.style.transform = `translateY(${-textarea.scrollTop}px)`;
    };
    sync();
    textarea.addEventListener("scroll", sync);
    return () => textarea.removeEventListener("scroll", sync);
  }, [textareaRef, value]);

  const tokens = findShortcutTokens(value, chips);
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token) => {
    if (token.start > cursor) {
      segments.push(<Fragment key={`t${cursor}`}>{value.slice(cursor, token.start)}</Fragment>);
    }
    const openAt =
      value[token.start] !== SHORTCUT_CHIP_OPEN && value[token.start + 1] === SHORTCUT_CHIP_OPEN
        ? token.start + 1
        : token.start;
    const labelText = value.slice(openAt + 3, token.end - 1);
    const removeAt = labelText.lastIndexOf("×");
    segments.push(
      <Fragment key={`c${token.start}`}>
        {value.slice(token.start, openAt + 3)}
        <span
          data-testid="chat-shortcut-chip"
          data-chip-name={token.chip.name}
          className="rounded-md bg-violet-500/30 shadow-[0_0_0_1px_rgba(167,139,250,0.6)]"
        >
          {labelText.slice(0, removeAt)}
          <span
            role="button"
            tabIndex={-1}
            aria-label={`${token.chip.name} 단축어 제거`}
            data-testid="chat-shortcut-chip-remove"
            className="pointer-events-auto relative cursor-pointer"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRemove(token.start)}
          >
            <span aria-hidden className="absolute -inset-x-2 -inset-y-2" />
            {labelText.slice(removeAt, removeAt + 1)}
          </span>
          {labelText.slice(removeAt + 1)}
        </span>
        {value.slice(token.end - 1, token.end)}
      </Fragment>
    );
    cursor = token.end;
  });
  if (cursor < value.length) {
    segments.push(<Fragment key={`t${cursor}`}>{value.slice(cursor)}</Fragment>);
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent px-3 py-2.5 [scrollbar-gutter:stable] sm:py-2"
      style={fontStyle}
    >
      <div ref={innerRef} className="whitespace-pre-wrap break-words text-transparent will-change-transform">
        {segments}
      </div>
    </div>
  );
}
