"use client";

import { useMemo, useState } from "react";

import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import {
  applyFieldLabelChange,
  fieldPlaceholderKey,
  uniqueStatusValueKey,
} from "@/lib/statusWidget/fieldKeys";
import {
  buildStatusWidgetEditorPreviewValues,
} from "@/lib/statusWidget/editorPreview";
import { renderStatusWidgetHtml } from "@/lib/statusWidget/render";
import {
  estimateStatusWidgetContextChars,
  formatWidgetBudgetHint,
} from "@/lib/statusWidget/contextBudget";
import type { StatusWidget, StatusWidgetField } from "@/lib/statusWidget/types";

const FORBIDDEN_TAGS =
  "script, iframe, svg, img, a, form, input, textarea, select, button, object, embed, math, style, link, meta, base, applet";

type Props = {
  value: StatusWidget;
  onChange: (widget: StatusWidget) => void;
  disabled?: boolean;
};

function cloneWidget(w: StatusWidget): StatusWidget {
  return {
    ...w,
    fields: w.fields.map((f) => ({ ...f })),
  };
}

export default function StatusWidgetEditor({ value, onChange, disabled }: Props) {
  const [previewOn, setPreviewOn] = useState(true);

  const widgetReservedChars = useMemo(() => estimateStatusWidgetContextChars(value), [value]);

  const previewHtml = useMemo(
    () => renderStatusWidgetHtml(value, buildStatusWidgetEditorPreviewValues(value)),
    [value]
  );

  const usableKeys = useMemo(
    () => value.fields.map((f) => fieldPlaceholderKey(f)).filter((k) => k.length > 0),
    [value.fields]
  );

  function updateFieldInstruction(index: number, instruction: string) {
    const next = cloneWidget(value);
    next.fields[index] = { ...next.fields[index]!, instruction };
    onChange(next);
  }

  function updateFieldLabel(index: number, label: string) {
    onChange(applyFieldLabelChange(value, index, label));
  }

  function addField() {
    const next = cloneWidget(value);
    const n = next.fields.length + 1;
    const label = `상태값 ${n}`;
    const existingKeys = next.fields.map(fieldPlaceholderKey).filter(Boolean);
    const id = uniqueStatusValueKey(label, existingKeys);
    next.fields.push({ id, label, instruction: "" });
    onChange(next);
  }

  function removeField(index: number) {
    if (value.fields.length <= 1) return;
    const next = cloneWidget(value);
    next.fields.splice(index, 1);
    onChange(next);
  }

  function insertPlaceholder(key: string) {
    onChange({ ...value, htmlTemplate: value.htmlTemplate + `{{${key}}}` });
  }

  function loadDefault() {
    onChange(cloneWidget(DEFAULT_STATUS_WIDGET));
  }

  return (
    <div className="space-y-4 rounded-xl border border-violet-500/25 bg-violet-950/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-violet-200">상태창 위젯</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPreviewOn((v) => !v)}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"
          >
            미리보기 {previewOn ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={loadDefault}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"
          >
            기본 템플릿
          </button>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500">
        HTML 키는 상태값 이름에서 자동 생성됩니다.
      </p>

      <p className="text-[11px] text-violet-300/90">{formatWidgetBudgetHint(widgetReservedChars)}</p>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-400">① 상태값 · ② 지시사항</span>
          <button
            type="button"
            disabled={disabled}
            onClick={addField}
            className="text-xs font-semibold text-violet-400 hover:text-violet-300"
          >
            + 상태값 추가
          </button>
        </div>
        {value.fields.map((field, i) => (
          <FieldCard
            key={`field-${i}`}
            field={field}
            disabled={disabled}
            canRemove={value.fields.length > 1}
            onLabelChange={(label) => updateFieldLabel(i, label)}
            onInstructionChange={(instruction) => updateFieldInstruction(i, instruction)}
            onRemove={() => removeField(i)}
          />
        ))}
      </div>

      {usableKeys.length > 0 && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
          <div>
            <p className="text-xs font-bold text-violet-200">사용 가능한 상태값</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              클릭하면 아래 HTML 작성칸에 <span className="font-mono text-violet-300/90">{`{{…}}`}</span>{" "}
              가 삽입됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {usableKeys.map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => insertPlaceholder(key)}
                className="rounded-md border border-violet-500/40 bg-[#0b0d14] px-2.5 py-1 font-mono text-[11px] text-violet-100 hover:bg-violet-500/15 disabled:opacity-40"
              >
                {`{{${key}}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <span className="text-xs font-semibold text-gray-400">③ 위젯 콘텐츠 (HTML)</span>
        <p className="mt-0.5 text-[10px] text-gray-600">사용 불가 태그: {FORBIDDEN_TAGS}</p>
        <div className={`mt-2 grid gap-3 ${previewOn ? "lg:grid-cols-2" : ""}`}>
          <textarea
            disabled={disabled}
            value={value.htmlTemplate}
            onChange={(e) => onChange({ ...value, htmlTemplate: e.target.value })}
            rows={14}
            spellCheck={false}
            placeholder="위 「사용 가능한 상태값」을 클릭해 HTML에 넣거나, 직접 작성하세요."
            className="w-full rounded-lg border border-white/10 bg-[#0b0d14] px-3 py-2 font-mono text-[11px] text-emerald-100/90"
          />
          {previewOn && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500">
                레이아웃 미리보기 · 각 칸에는 해당 상태값의{" "}
                <span className="text-gray-400">지시사항</span>이 (괄호) 안에 표시됩니다. 채팅에서는
                AI가 장면에 맞는 값만 출력합니다.
              </p>
              <div
                className="min-h-[200px] overflow-auto rounded-lg border border-white/10 bg-[#0a0a0c] p-2"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-400">
        <span>표시 위치</span>
        <select
          disabled={disabled}
          value={value.placement}
          onChange={(e) =>
            onChange({ ...value, placement: e.target.value === "top" ? "top" : "bottom" })
          }
          className="rounded border border-white/10 bg-black/40 px-2 py-1 text-white"
        >
          <option value="bottom">본문 하단</option>
          <option value="top">본문 상단</option>
        </select>
      </label>
    </div>
  );
}

function FieldCard({
  field,
  disabled,
  canRemove,
  onLabelChange,
  onInstructionChange,
  onRemove,
}: {
  field: StatusWidgetField;
  disabled?: boolean;
  canRemove: boolean;
  onLabelChange: (label: string) => void;
  onInstructionChange: (instruction: string) => void;
  onRemove: () => void;
}) {
  const key = fieldPlaceholderKey(field);

  return (
    <div className="rounded-lg border border-white/10 bg-[#0b0d14]/80 p-3 space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <label className="min-w-[140px] flex-1">
          <span className="text-[10px] text-gray-500">상태값</span>
          <input
            disabled={disabled}
            value={field.label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="예: 시간, 속마음, 호감도"
            className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
          />
        </label>
        {key ? (
          <div className="shrink-0 pt-4">
            <span className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[10px] text-violet-200/90">
              {`{{${key}}}`}
            </span>
          </div>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            className="ml-auto pt-4 text-[10px] text-rose-400 hover:underline"
          >
            삭제
          </button>
        ) : null}
      </div>
      <label className="block">
        <span className="text-[10px] text-gray-500">지시사항 (AI용)</span>
        <textarea
          disabled={disabled}
          value={field.instruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          rows={2}
          placeholder="예: 현재 대화 시점의 시간을 24시간 형식으로 작성하세요. 출력 예시: 14:30"
          className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
        />
      </label>
    </div>
  );
}
