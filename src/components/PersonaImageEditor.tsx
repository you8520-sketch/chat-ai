"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import {
  PERSONA_IMAGE_FOCUS_DEFAULT,
  personaImageObjectPosition,
  sanitizePersonaImageFocus,
} from "@/lib/userPersonas";

export type PersonaImageValue = {
  image_url: string;
  image_focus_x: number;
  image_focus_y: number;
};

type Props = {
  value: PersonaImageValue;
  onChange: (next: PersonaImageValue) => void;
  disabled?: boolean;
  /** Compact layout for chat settings drawer */
  compact?: boolean;
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export default function PersonaImageEditor({
  value,
  onChange,
  disabled = false,
  compact = false,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originFocusX: number;
    originFocusY: number;
  } | null>(null);

  const url = value.image_url.trim();
  const focusX = sanitizePersonaImageFocus(value.image_focus_x, PERSONA_IMAGE_FOCUS_DEFAULT.x);
  const focusY = sanitizePersonaImageFocus(value.image_focus_y, PERSONA_IMAGE_FOCUS_DEFAULT.y);

  const setFocus = useCallback(
    (x: number, y: number) => {
      onChange({
        image_url: value.image_url,
        image_focus_x: clamp01(x),
        image_focus_y: clamp01(y),
      });
    },
    [onChange, value.image_url]
  );

  async function uploadFile(file: File) {
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { ok?: boolean; urls?: string[]; error?: string };
      if (!res.ok || !data.urls?.[0]) {
        setError(data.error || "이미지 업로드에 실패했습니다.");
        return;
      }
      onChange({
        image_url: data.urls[0],
        image_focus_x: PERSONA_IMAGE_FOCUS_DEFAULT.x,
        image_focus_y: PERSONA_IMAGE_FOCUS_DEFAULT.y,
      });
    } catch {
      setError("이미지 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void uploadFile(file);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled || !url) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originFocusX: focusX,
      originFocusY: focusY,
    };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // Drag image with the pointer: content moves with finger → focus moves opposite.
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    setFocus(drag.originFocusX - dx, drag.originFocusY - dy);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }

  function clearImage() {
    onChange({
      image_url: "",
      image_focus_x: PERSONA_IMAGE_FOCUS_DEFAULT.x,
      image_focus_y: PERSONA_IMAGE_FOCUS_DEFAULT.y,
    });
    setError("");
  }

  const frameClass = compact
    ? "h-36 w-36"
    : "h-44 w-44 sm:h-52 sm:w-52";

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-zinc-300">대표 이미지</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
            전체 원본을 저장합니다(용량만 화질 유지선에서 압축). 미리보기에서 드래그해 얼굴 위치를
            맞출 수 있습니다.
          </p>
        </div>
        {url ? (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={clearImage}
            className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/5 disabled:opacity-40"
          >
            제거
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div
          ref={frameRef}
          className={`${frameClass} relative touch-none overflow-hidden rounded-2xl border border-white/10 bg-[#0e1120] ${
            url && !disabled ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {url ? (
            <>
              <img
                src={url}
                alt="페르소나 대표 이미지 미리보기"
                className="h-full w-full select-none object-cover"
                style={{ objectPosition: personaImageObjectPosition(focusX, focusY) }}
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
              <div className="pointer-events-none absolute left-1/2 top-[28%] h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
              <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-center text-[10px] text-zinc-200">
                드래그하여 얼굴 위치 조정
              </p>
            </>
          ) : (
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
              className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center text-[11px] text-zinc-500 transition hover:bg-white/[0.03] disabled:opacity-40"
            >
              <span className="text-lg text-zinc-400">＋</span>
              <span>{uploading ? "업로드 중…" : "이미지 선택"}</span>
            </button>
          )}
        </div>

        <div className="min-w-[10rem] flex-1 space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            disabled={disabled || uploading}
            onChange={onFileChange}
          />
          {url ? (
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
            >
              {uploading ? "업로드 중…" : "이미지 바꾸기"}
            </button>
          ) : null}

          {url ? (
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
              <label className="block space-y-1">
                <span className="flex justify-between text-[10px] text-zinc-500">
                  <span>가로 위치</span>
                  <span className="tabular-nums">{Math.round(focusX * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(focusX * 100)}
                  disabled={disabled}
                  onChange={(e) => setFocus(Number(e.target.value) / 100, focusY)}
                  className="w-full accent-violet-500"
                />
              </label>
              <label className="block space-y-1">
                <span className="flex justify-between text-[10px] text-zinc-500">
                  <span>세로 위치 (얼굴)</span>
                  <span className="tabular-nums">{Math.round(focusY * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(focusY * 100)}
                  disabled={disabled}
                  onChange={(e) => setFocus(focusX, Number(e.target.value) / 100)}
                  className="w-full accent-violet-500"
                />
              </label>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setFocus(PERSONA_IMAGE_FOCUS_DEFAULT.x, PERSONA_IMAGE_FOCUS_DEFAULT.y)
                }
                className="text-[10px] text-violet-300/90 hover:text-violet-200 disabled:opacity-40"
              >
                기본 얼굴 위치로 초기화
              </button>
            </div>
          ) : (
            <p className="text-[10px] leading-relaxed text-zinc-600">
              PNG/JPEG/WebP/GIF · 최대 4MB · 성인인증 필요
            </p>
          )}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
