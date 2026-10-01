"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import JsxComponentSandbox from "@/components/JsxComponentSandbox";
import { compileJsxComponentSource } from "@/lib/jsxComponent/compile";
import { JSX_SANDBOX_HEIGHT_PX } from "@/lib/jsxComponent/limits";
import { buildStatusWidgetEditorPreviewValues } from "@/lib/statusWidget/editorPreview";
import { statusWidgetPreviewSandboxProps } from "@/lib/statusWidget/previewRuntime";
import {
  renderStatusWidgetHtml,
  type StatusWidgetProfileNames,
} from "@/lib/statusWidget/render";
import type { StatusWidget, StatusWidgetValues } from "@/lib/statusWidget/types";

type Props = {
  widget: StatusWidget;
  profileNames?: StatusWidgetProfileNames | null;
  values?: StatusWidgetValues;
  /** Mount the JSX sandbox only once the preview is near the viewport. */
  lazy?: boolean;
  /** Public community surfaces must not execute creator JSX until the viewer opts in. */
  requireInteraction?: boolean;
  className?: string;
};

export default function StatusWidgetPreview({
  widget,
  profileNames,
  values,
  lazy = false,
  requireInteraction = false,
  className,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy && !requireInteraction);
  const previewValues = useMemo(
    () => values ?? buildStatusWidgetEditorPreviewValues(widget, profileNames),
    [values, widget, profileNames]
  );
  const source = widget.jsxSource?.trim() ?? "";
  const compiled = useMemo(
    () => (source ? compileJsxComponentSource(source) : null),
    [source]
  );

  useEffect(() => {
    if (requireInteraction || !lazy || !source) return;
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazy, requireInteraction, source]);

  if (source) {
    if (!compiled?.ok) {
      return (
        <p className="p-3 text-xs text-rose-300">
          {compiled?.error || "JSX를 컴파일할 수 없습니다."}
        </p>
      );
    }
    const sandbox = statusWidgetPreviewSandboxProps(compiled.compiled, previewValues);
    return (
      <div ref={rootRef} className={className ?? "min-w-0 max-w-full overflow-hidden"}>
        {visible ? (
          <JsxComponentSandbox {...sandbox} />
        ) : requireInteraction ? (
          <button
            type="button"
            onClick={() => setVisible(true)}
            className="flex w-full items-center justify-center rounded-xl border border-white/10 bg-[#0a0a0c] px-3 text-xs font-semibold text-zinc-300 transition hover:bg-white/5"
            style={{ height: Math.min(160, JSX_SANDBOX_HEIGHT_PX) }}
          >
            JSX 미리보기 열기
          </button>
        ) : (
          <div
            className="flex items-center justify-center rounded-xl border border-white/10 bg-[#0a0a0c] text-xs text-zinc-500"
            style={{ height: Math.min(160, JSX_SANDBOX_HEIGHT_PX) }}
          >
            JSX 미리보기
          </div>
        )}
      </div>
    );
  }

  const html = renderStatusWidgetHtml(widget, previewValues, profileNames);
  if (!html.trim()) return null;
  return (
    <div
      className={className ?? "min-w-0 max-w-full overflow-hidden"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
