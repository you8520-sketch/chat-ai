"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  PERSONA_IMAGE_FOCUS_DEFAULT,
  PERSONA_IMAGE_SCALE_DEFAULT,
  PERSONA_IMAGE_SCALE_MAX,
  PERSONA_IMAGE_SCALE_MIN,
  personaImageBaseUrl,
  personaImageRenderStyle,
  personaImageScale,
  sanitizePersonaImageFocus,
  sanitizePersonaImageScale,
  withPersonaImageScale,
} from "@/lib/userPersonasClient";

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

const SCALE_STEP = 0.15;

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

  const storedUrl = value.image_url.trim();
  const url = personaImageBaseUrl(storedUrl);
  const scale = personaImageScale(storedUrl);
  const focusX = sanitizePersonaImageFocus(
    value.image_focus_x,
    PERSONA_IMAGE_FOCUS_DEFAULT.x
  );
  const focusY = sanitizePersonaImageFocus(
    value.image_focus_y,
    PERSONA_IMAGE_FOCUS_DEFAULT.y
  );

  const setTransform = useCallback(
    (x: number, y: number, nextScale = scale) => {
      onChange({
        image_url: withPersonaImageScale(
          value.image_url,
          sanitizePersonaImageScale(nextScale, PERSONA_IMAGE_SCALE_DEFAULT)
        ),
        image_focus_x: clamp01(x),
        image_focus_y: clamp01(y),
      });
    },
    [onChange, scale, value.image_url]
  );

  const setScale = useCallback(
    (nextScale: number) => {
      setTransform(focusX, focusY, nextScale);
    },
    [focusX, focusY, setTransform]
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
        image_url: withPersonaImageScale(
          data.urls[0],
          PERSONA_IMAGE_SCALE_DEFAULT
        ),
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

    // The image follows the pointer. Higher zoom uses a gentler focal movement.
    const zoomSensitivity = Math.max(1, scale);
    const dx = (e.clientX - drag.startX) / rect.width / zoomSensitivity;
    const dy = (e.clientY - drag.startY) / rect.height / zoomSensitivity;
    setTransform(
      drag.originFocusX - dx,
      drag.originFocusY - dy,
      scale
    );
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function onWheel(e: WheelEvent<HTMLDivElement>) {
    if (disabled || !url) return;
    e.preventDefault();
    setScale(scale + (e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP));
  }

  function clearImage() {
    onChange({
      image_url: "",
      image_focus_x: PERSONA_IMAGE_FOCUS_DEFAULT.x,
      image_focus_y: PERSONA_IMAGE_FOCUS_DEFAULT.y,
    });
    setError("");
  }

  function resetTransform() {
    setTransform(
      PERSONA_IMAGE_FOCUS_DEFAULT.x,
      PERSONA_IMAGE_FOCUS_DEFAULT.y,
      PERSONA_IMAGE_SCALE_DEFAULT
    );
  }

  const frameClass = compact
    ? "h-44 w-44"
    : "h-56 w-56 sm:h-64 sm:w-64";

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-zinc-300">대표 이미지</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
            이미지 전체를 저장하며 파일 자체는 자르지 않습니다. 미리보기에서 드래그하고 휠이나 버튼으로 확대하세요.
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
        <div className="space-y-1.5">
          <div
            ref={frameRef}
            className={`${frameClass} relative touch-none overflow-hidden rounded-2xl border border-white/10 bg-[#0e1120] ${
              url && !disabled ? "cursor-grab active:cursor-grabbing" : ""
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onWheel={onWheel}
          >
            {url ? (
              <>
                <img
                  src={url}
                  alt="페르소나 대표 이미지 미리보기"
                  className="h-full w-full select-none object-cover"
                  style={personaImageRenderStyle(storedUrl, focusX, focusY)}
                  draggable={false}
                />
                <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
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
          {url ? (
            <p className="text-center text-[10px] text-zinc-500">
              드래그로 위치 이동 · 마우스 휠로 확대/축소
            </p>
          ) : null}
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
            <>
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
              >
                {uploading ? "업로드 중…" : "이미지 바꾸기"}
              </button>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-label="이미지 축소"
                  disabled={disabled || scale <= PERSONA_IMAGE_SCALE_MIN}
                  onClick={() => setScale(scale - SCALE_STEP)}
                  className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.03] text-sm font-bold text-zinc-300 hover:bg-white/10 disabled:opacity-30"
                >
                  −
                </button>
                <span className="min-w-[3.8rem] text-center text-[11px] tabular-nums text-zinc-300">
                  {scale.toFixed(2)}×
                </span>
                <button
                  type="button"
                  aria-label="이미지 확대"
                  disabled={disabled || scale >= PERSONA_IMAGE_SCALE_MAX}
                  onClick={() => setScale(scale + SCALE_STEP)}
                  className="h-8 w-8 rounded-lg border border-white/10 bg-white/[0.03] text-sm font-bold text-zinc-300 hover:bg-white/10 disabled:opacity-30"
                >
                  ＋
                </button>
              </div>

              <button
                type="button"
                disabled={disabled}
                onClick={resetTransform}
                className="text-[10px] text-violet-300/90 hover:text-violet-200 disabled:opacity-40"
              >
                위치·확대 초기화
              </button>
            </>
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
