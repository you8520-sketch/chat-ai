"use client";

import { useMemo } from "react";
import StatusWidgetCard from "@/components/StatusWidgetCard";
import { fieldPlaceholderKey } from "@/lib/statusWidget/fieldKeys";
import {
  renderStatusWidgetHtml,
  type StatusWidgetProfileNames,
} from "@/lib/statusWidget/render";
import type {
  ParsedStatusWidgetTurnValues,
  StatusWidget,
  StatusWidgetField,
  StatusWidgetValues,
} from "@/lib/statusWidget/types";

export const STATUS_WIDGET_EDIT_VALUE_MAX = 1000;

function readFieldValue(values: StatusWidgetValues, field: StatusWidgetField): string {
  const key = fieldPlaceholderKey(field);
  for (const lookup of [field.id, key]) {
    const v = values[lookup];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function writeFieldValue(
  values: StatusWidgetValues,
  field: StatusWidgetField,
  next: string
): StatusWidgetValues {
  const key = fieldPlaceholderKey(field) || field.id;
  const out: StatusWidgetValues = { ...values };
  // Drop alternate id key so one canonical key remains
  if (field.id && field.id !== key) delete out[field.id];
  const trimmed = next.slice(0, STATUS_WIDGET_EDIT_VALUE_MAX);
  if (trimmed.trim()) out[key] = trimmed;
  else delete out[key];
  return out;
}

type WidgetEditItem = {
  source: "character" | "user";
  widget: StatusWidget;
  values: StatusWidgetValues;
};

type Props = {
  items: WidgetEditItem[];
  draft: ParsedStatusWidgetTurnValues;
  onChange: (next: ParsedStatusWidgetTurnValues) => void;
  profileNames?: StatusWidgetProfileNames | null;
};

/** 상태창 위젯 — HTML이 아니라 카드 형태로, 라벨(이름)은 고정·값만 수정 */
export default function StatusWidgetValuesEditor({
  items,
  draft,
  onChange,
  profileNames,
}: Props) {
  const previews = useMemo(
    () =>
      items.map(({ source, widget, values }) => ({
        source,
        html: renderStatusWidgetHtml(widget, values, profileNames),
        name: widget.name?.trim() || (source === "user" ? "유저 상태창" : "상태창"),
      })),
    [items, profileNames]
  );

  if (items.length === 0) return null;

  const updateSource = (source: "character" | "user", values: StatusWidgetValues) => {
    onChange({
      ...draft,
      [source]: Object.keys(values).length > 0 ? values : null,
    });
  };

  return (
    <div className="mt-4 space-y-4">
      <p className="text-center text-[11px] font-semibold text-zinc-500">상태창 값 수정</p>
      {items.map(({ source, widget, values }) => (
        <div
          key={source}
          className="overflow-hidden rounded-xl border border-white/10 bg-[#0d1117] shadow-[0_12px_24px_rgba(0,0,0,0.35)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
            <span className="text-[12px] font-bold tracking-wide text-zinc-100">
              {widget.name?.trim() || (source === "user" ? "유저 상태창" : "STATUS")}
            </span>
            <span className="text-[10px] text-zinc-500">값만 수정 · 이름 고정</span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3">
            {widget.fields.map((field) => {
              const label = field.label.trim() || field.id || "상태값";
              const key = fieldPlaceholderKey(field) || field.id;
              return (
                <label key={`${source}-${key}`} className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                  <span className="shrink-0 pt-1.5 text-[13px] font-semibold text-[#58a6ff] sm:min-w-[5.5rem]">
                    • {label}
                  </span>
                  <textarea
                    value={readFieldValue(values, field)}
                    maxLength={STATUS_WIDGET_EDIT_VALUE_MAX}
                    rows={2}
                    onChange={(e) =>
                      updateSource(source, writeFieldValue(values, field, e.target.value))
                    }
                    placeholder="출력된 상태 값"
                    className="min-h-[2.5rem] w-full flex-1 resize-y rounded-md border border-white/10 bg-[#161b22] px-2.5 py-1.5 text-[13px] leading-relaxed text-[#f0f6fc] outline-none focus:border-[#58a6ff]/50"
                  />
                </label>
              );
            })}
          </div>
          {previews
            .filter((p) => p.source === source && p.html.trim())
            .map((p) => (
              <div key={`${source}-preview`} className="border-t border-white/10 px-2 pb-2">
                <p className="px-2 pt-2 text-[10px] text-zinc-600">미리보기</p>
                <StatusWidgetCard html={p.html} />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
