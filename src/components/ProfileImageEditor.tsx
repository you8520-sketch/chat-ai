"use client";



import { useState } from "react";

import type { LayoutHint } from "@/lib/profileTypography";



export const PROFILE_IMAGE_DRAG_MIME = "application/x-hobbyai-profile-image";



const LAYOUTS: { value: LayoutHint; label: string; hint: string }[] = [

  { value: "right", label: "오른쪽", hint: "본문 왼쪽 · 이미지 오른쪽" },

  { value: "left", label: "왼쪽", hint: "이미지 왼쪽 · 본문 오른쪽" },

  { value: "top", label: "상단", hint: "이미지 위 · 본문 아래" },

  { value: "inline", label: "본문만", hint: "갤러리 숨김 · 본문 삽입 이미지만" },

];



type Props = {
  urls: string[];
  layoutHint: LayoutHint;
  onUrlsChange: (urls: string[]) => void;
  onLayoutChange: (layout: LayoutHint) => void;
  onInsertToBiography: (markdownLine: string) => void;
};



export function profileImageMarkdown(url: string, index: number): string {

  return `![이미지 ${index + 1}](${url})`;

}



export default function ProfileImageEditor({

  urls,

  layoutHint,

  onUrlsChange,

  onLayoutChange,

  onInsertToBiography,

}: Props) {

  const [dragIndex, setDragIndex] = useState<number | null>(null);



  function reorder(from: number, to: number) {

    if (from === to || from < 0 || to < 0 || from >= urls.length || to >= urls.length) return;

    const next = [...urls];

    const [item] = next.splice(from, 1);

    next.splice(to, 0, item);

    onUrlsChange(next);

  }



  function remove(index: number) {

    onUrlsChange(urls.filter((_, i) => i !== index));

  }



  function beginImageDrag(e: React.DragEvent, url: string, index: number) {

    setDragIndex(index);

    e.dataTransfer.effectAllowed = "copyMove";

    e.dataTransfer.setData(PROFILE_IMAGE_DRAG_MIME, url);

    e.dataTransfer.setData("text/plain", profileImageMarkdown(url, index));

  }



  return (

    <div className="space-y-3 rounded-xl border border-white/10 bg-[#0e1120] p-3">

      <div>

        <p className="text-xs font-semibold text-gray-300">이미지 배치</p>

        <p className="mt-0.5 text-[10px] text-gray-500">
          썸네일을 공개 소개 소스 편집창으로 드래그 · 놓은 위치에 이미지 주소 삽입
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">

          {LAYOUTS.map((l) => (

            <button

              key={l.value}

              type="button"

              title={l.hint}

              onClick={() => onLayoutChange(l.value)}

              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${

                layoutHint === l.value

                  ? "bg-violet-600 text-white"

                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"

              }`}

            >

              {l.label}

            </button>

          ))}

        </div>

      </div>



      {urls.length === 0 ? (

        <p className="text-[11px] text-gray-600">아래 URL 입력란에 이미지 주소를 넣으면 여기서 배치할 수 있습니다.</p>

      ) : (

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">

          {urls.map((url, i) => (

            <div

              key={`${url}-${i}`}

              draggable

              onDragStart={(e) => beginImageDrag(e, url, i)}

              onDragEnd={() => {
                setDragIndex(null);
              }}

              onDragOver={(e) => e.preventDefault()}

              onDrop={() => {

                if (dragIndex !== null) reorder(dragIndex, i);

                setDragIndex(null);

              }}

              className={`group relative cursor-grab overflow-hidden rounded-lg border active:cursor-grabbing ${

                dragIndex === i ? "border-violet-500/60 opacity-60" : "border-white/10"

              }`}

            >

              {/* eslint-disable-next-line @next/next/no-img-element */}

              <img src={url} alt="" className="aspect-[3/4] w-full object-cover object-top" draggable={false} />

              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white">

                {i + 1}

                {i === 0 && layoutHint !== "inline" ? " · 대표" : ""}

              </span>

              <div className="flex border-t border-white/10 bg-black/80">

                <button

                  type="button"

                  onClick={() => onInsertToBiography(profileImageMarkdown(url, i))}

                  className="flex-1 py-1 text-[9px] font-bold text-cyan-300 hover:bg-cyan-500/10"

                >

                  본문 삽입

                </button>

                <button

                  type="button"

                  onClick={() => remove(i)}

                  className="border-l border-white/10 px-2 py-1 text-[9px] text-rose-300 hover:bg-rose-500/10"

                >

                  ✕

                </button>

              </div>

            </div>

          ))}

        </div>

      )}

    </div>

  );

}



export function insertIntoTextarea(
  textarea: HTMLTextAreaElement | null,
  snippet: string,
  current: string,
  onChange: (next: string) => void
) {
  if (!textarea) {
    onChange(current.trim() ? `${current.trimEnd()}\n\n${snippet}` : snippet);
    return;
  }
  insertIntoTextareaAt(textarea, textarea.selectionStart, snippet, current, onChange);
}

/** textarea 내 (clientX, clientY) 좌표 → 문자 인덱스 (font-mono 기준) */
export function getTextareaIndexFromPoint(
  textarea: HTMLTextAreaElement,
  clientX: number,
  clientY: number
): number {
  const rect = textarea.getBoundingClientRect();
  const style = window.getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 16;
  const padTop = parseFloat(style.paddingTop) || 0;
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;

  const y = clientY - rect.top - borderTop - padTop + textarea.scrollTop;
  const line = Math.max(0, Math.floor(y / lineHeight));

  const lines = textarea.value.split("\n");
  let index = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    index += lines[i].length + 1;
  }

  const lineText = lines[line] ?? "";
  const x = clientX - rect.left - borderLeft - padLeft + textarea.scrollLeft;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return Math.min(textarea.value.length, index + lineText.length);
  ctx.font = style.font;
  let col = 0;
  for (; col <= lineText.length; col++) {
    if (ctx.measureText(lineText.slice(0, col)).width > x) break;
  }
  return Math.min(textarea.value.length, index + Math.max(0, col - 1));
}

export function insertIntoTextareaAt(
  textarea: HTMLTextAreaElement | null,
  index: number,
  snippet: string,
  current: string,
  onChange: (next: string) => void
) {
  const start = Math.max(0, Math.min(index, current.length));
  const before = current.slice(0, start);
  const after = current.slice(start);
  const needsLead = before.length > 0 && !before.endsWith("\n");
  const needsTrail = after.length > 0 && !after.startsWith("\n");
  const insert = `${needsLead ? "\n\n" : ""}${snippet}${needsTrail ? "\n\n" : ""}`;
  const next = before + insert + after;
  onChange(next);
  if (!textarea) return;
  requestAnimationFrame(() => {
    const pos = before.length + insert.length;
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
  });
}



export function MarkdownToolbar({

  onInsert,

  imageUrls,

}: {

  onInsert: (snippet: string) => void;

  imageUrls: string[];

}) {

  return (

    <div className="mb-1.5 flex flex-wrap gap-1">

      {[

        { label: "## 제목", snippet: "## 섹션 제목\n\n" },

        { label: "목록", snippet: "- 항목\n- 항목\n" },

        { label: "인용", snippet: "> 인용문\n\n" },

        { label: "구분선", snippet: "---\n\n" },

      ].map((b) => (

        <button

          key={b.label}

          type="button"

          onClick={() => onInsert(b.snippet)}

          className="rounded-md bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-400 hover:bg-gray-700 hover:text-gray-200"

        >

          {b.label}

        </button>

      ))}

      {imageUrls.length > 0 && (

        <select

          className="rounded-md border border-gray-700 bg-gray-800 px-1 py-0.5 text-[10px] text-gray-300"

          defaultValue=""

          onChange={(e) => {

            const url = e.target.value;

            if (!url) return;

            const idx = imageUrls.indexOf(url);

            onInsert(`${profileImageMarkdown(url, idx >= 0 ? idx : 0)}\n\n`);

            e.target.value = "";

          }}

        >

          <option value="">본문에 이미지…</option>

          {imageUrls.map((url, i) => (

            <option key={url} value={url}>

              이미지 {i + 1}

            </option>

          ))}

        </select>

      )}

    </div>

  );

}


