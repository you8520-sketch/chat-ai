"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
} from "react";
import { sanitizeCreatorCommentHtml } from "@/lib/creatorCommentHtmlSanitize";

const COLORS = [
  { label: "흰색", value: "#f3f4f6" },
  { label: "보라", value: "#c4b5fd" },
  { label: "하늘", value: "#67e8f9" },
  { label: "초록", value: "#6ee7b7" },
  { label: "노랑", value: "#fcd34d" },
  { label: "분홍", value: "#fda4af" },
] as const;

const SIZES = [
  { label: "작게", value: "0.875rem" },
  { label: "보통", value: "1rem" },
  { label: "크게", value: "1.25rem" },
  { label: "아주 크게", value: "1.5rem" },
] as const;

const btnCls =
  "rounded-lg border border-violet-500/40 bg-[#12152a] px-2.5 py-1.5 text-xs font-bold text-violet-100 transition hover:border-violet-400/70 hover:bg-violet-500/15";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return "";
  return normalized
    .split("\n")
    .map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`)
    .join("");
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function normalizeInitialHtml(value: string): string {
  return looksLikeHtml(value) ? sanitizeCreatorCommentHtml(value) : plainTextToHtml(value);
}

function wrapSelection(style: Partial<CSSStyleDeclaration>, tagName = "span") {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const wrapper = document.createElement(tagName);
  if (style.fontSize) wrapper.style.fontSize = style.fontSize;
  if (style.lineHeight) wrapper.style.lineHeight = style.lineHeight;
  if (style.color) wrapper.style.color = style.color;
  try {
    range.surroundContents(wrapper);
  } catch {
    const fragment = range.extractContents();
    wrapper.appendChild(fragment);
    range.insertNode(wrapper);
  }
  selection.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(wrapper);
  selection.addRange(nextRange);
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  disabled?: boolean;
};

export default function PublicDescriptionEditor({
  value,
  onChange,
  maxLength,
  disabled = false,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastExternalValueRef = useRef(value);
  const [colorOpen, setColorOpen] = useState(false);

  useEffect(() => {
    if (!editorRef.current) return;
    if (value === lastExternalValueRef.current && editorRef.current.innerHTML) return;
    const html = normalizeInitialHtml(value);
    editorRef.current.innerHTML = html;
    lastExternalValueRef.current = value;
  }, [value]);

  function syncValue() {
    const raw = editorRef.current?.innerHTML ?? "";
    const next = sanitizeCreatorCommentHtml(raw).slice(0, maxLength);
    lastExternalValueRef.current = next;
    onChange(next);
  }

  function applyBold() {
    document.execCommand("bold");
    syncValue();
  }

  function applyStyle(style: Partial<CSSStyleDeclaration>) {
    wrapSelection(style);
    syncValue();
    setColorOpen(false);
    editorRef.current?.focus();
  }

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    window.requestAnimationFrame(syncValue);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-violet-500/30 bg-[#0a0d18] p-2">
        <span className="mr-1 text-[10px] font-semibold text-violet-400/90">
          선택영역
        </span>
        <button type="button" className={btnCls} onClick={applyBold} disabled={disabled}>
          굵게
        </button>
        {SIZES.map((size) => (
          <button
            key={size.value}
            type="button"
            className={btnCls}
            onClick={() => applyStyle({ fontSize: size.value, lineHeight: "1.55" })}
            disabled={disabled}
          >
            {size.label}
          </button>
        ))}
        <div className="relative">
          <button
            type="button"
            className={btnCls}
            onClick={() => setColorOpen((v) => !v)}
            disabled={disabled}
          >
            색상
          </button>
          {colorOpen ? (
            <div className="absolute left-0 top-full z-20 mt-1 flex flex-wrap gap-1 rounded-xl border border-violet-500/40 bg-[#12152a] p-2 shadow-xl shadow-black/40">
              {COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-semibold hover:bg-white/5"
                  style={{ color: color.value }}
                  onClick={() => applyStyle({ color: color.value })}
                >
                  {color.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={syncValue}
        onBlur={syncValue}
        onPaste={handlePaste}
        className="min-h-[320px] w-full overflow-y-auto rounded-xl border-2 border-violet-500/45 bg-[#0c0e1a] px-4 py-3 text-[15px] leading-relaxed text-violet-50 outline-none ring-0 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.06)] focus:border-violet-400/75 focus:ring-2 focus:ring-violet-400/25 empty:before:text-gray-500 empty:before:content-[attr(data-placeholder)]"
        data-placeholder={"일반 메모장처럼 줄글로 작성하세요.\A\AEnter로 줄을 띄우고, 강조할 문장은 드래그해서 굵기·크기·색상을 적용할 수 있습니다."}
      />
    </div>
  );
}
