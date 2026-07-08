"use client";

import { useMemo, useState } from "react";
import type { StatusWidget } from "@/lib/statusWidget/types";

export type StatusWidgetTriggerDraft = {
  trigger_id: string;
  status_key: string;
  operator: "<=" | ">=" | "==" | "!=" | "<" | ">";
  value: string | number | boolean;
  fire_once: boolean;
  event_key: string;
  effect_text: string;
  character_knowledge: "unknown" | "known" | "revealed_on_trigger";
  is_enabled: boolean;
};

const OPERATORS = ["<=", ">=", "==", "!=", "<", ">"] as const;
const KNOWLEDGE_OPTIONS = ["unknown", "known", "revealed_on_trigger"] as const;
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function normalizeTriggerDraft(raw: Partial<StatusWidgetTriggerDraft> = {}): StatusWidgetTriggerDraft {
  return {
    trigger_id: raw.trigger_id ?? "",
    status_key: raw.status_key ?? "",
    operator: raw.operator ?? "<=",
    value: raw.value ?? "",
    fire_once: raw.fire_once ?? true,
    event_key: raw.event_key ?? "",
    effect_text: raw.effect_text ?? "",
    character_knowledge: raw.character_knowledge ?? "revealed_on_trigger",
    is_enabled: raw.is_enabled ?? true,
  };
}

function validationError(trigger: StatusWidgetTriggerDraft): string | null {
  if (!SNAKE_CASE_RE.test(trigger.trigger_id.trim())) return "trigger_id는 snake_case로 입력해 주세요.";
  if (!trigger.status_key.trim()) return "status_key를 입력해 주세요.";
  if (!OPERATORS.includes(trigger.operator)) return "연산자를 선택해 주세요.";
  if (String(trigger.value).trim().length === 0) return "비교값을 입력해 주세요.";
  if (!SNAKE_CASE_RE.test(trigger.event_key.trim())) return "event_key는 snake_case로 입력해 주세요.";
  if (!/[가-힣]/.test(trigger.effect_text.trim())) return "effect_text는 한국어 문장으로 입력해 주세요.";
  return null;
}

function fieldKey(field: StatusWidget["fields"][number]): string {
  const id = field.id?.trim();
  if (id) return id;
  return field.label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export default function StatusWidgetTriggerEditor({
  value,
  onChange,
  statusWidget,
  disabled,
}: {
  value: StatusWidgetTriggerDraft[];
  onChange: (triggers: StatusWidgetTriggerDraft[]) => void;
  statusWidget: StatusWidget;
  disabled?: boolean;
}) {
  const [sampleJson, setSampleJson] = useState("{\n  \"d_day\": 0,\n  \"affection\": 82\n}");

  const statusKeys = useMemo(
    () => Array.from(new Set(statusWidget.fields.map(fieldKey).filter(Boolean))),
    [statusWidget.fields]
  );

  const errors = value.map(validationError);

  const previewMatches = useMemo(() => {
    let sample: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(sampleJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        sample = parsed as Record<string, unknown>;
      }
    } catch {
      return [];
    }
    return value
      .filter((trigger) => trigger.is_enabled && !validationError(trigger))
      .filter((trigger) => {
        const actual = sample[trigger.status_key];
        if (actual == null) return false;
        const expectedRaw = String(trigger.value).trim();
        const expectedNumber = Number(expectedRaw);
        const actualNumber = Number(actual);
        if (["<=", ">=", "<", ">"].includes(trigger.operator)) {
          if (!Number.isFinite(expectedNumber) || !Number.isFinite(actualNumber)) return false;
          if (trigger.operator === "<=") return actualNumber <= expectedNumber;
          if (trigger.operator === ">=") return actualNumber >= expectedNumber;
          if (trigger.operator === "<") return actualNumber < expectedNumber;
          if (trigger.operator === ">") return actualNumber > expectedNumber;
        }
        const expected =
          expectedRaw === "true" ? true : expectedRaw === "false" ? false : expectedRaw;
        const same = String(actual).toLowerCase() === String(expected).toLowerCase();
        return trigger.operator === "==" ? same : !same;
      })
      .map((trigger) => trigger.trigger_id);
  }, [sampleJson, value]);

  function update(index: number, patch: Partial<StatusWidgetTriggerDraft>) {
    onChange(value.map((trigger, i) => (i === index ? { ...trigger, ...patch } : trigger)));
  }

  function addTrigger() {
    onChange([
      ...value,
      normalizeTriggerDraft({
        trigger_id: `status_trigger_${value.length + 1}`,
        event_key: `status_event_${value.length + 1}`,
        status_key: statusKeys[0] ?? "",
      }),
    ]);
  }

  function removeTrigger(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-amber-200">상태창 트리거</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            상태창 값이 특정 조건에 도달했을 때 다음 턴에 사건을 발생시키는 규칙입니다.
            예: d_day &lt;= 0, affection &gt;= 80.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
            트리거의 작동 조건은 캐릭터 설정 본문에 직접 적기보다 이곳에 분리해서 등록하는 것이 안전합니다.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={addTrigger}
          className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
        >
          + 트리거 추가
        </button>
      </div>

      {value.length === 0 ? (
        <p className="rounded-lg border border-white/5 bg-black/20 px-3 py-3 text-xs text-zinc-500">
          등록된 트리거가 없습니다.
        </p>
      ) : (
        <div className="space-y-3">
          {value.map((trigger, index) => (
            <div key={`${trigger.trigger_id}-${index}`} className="rounded-lg border border-white/10 bg-[#0b0d14]/90 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={trigger.is_enabled}
                    disabled={disabled}
                    onChange={(e) => update(index, { is_enabled: e.target.checked })}
                  />
                  활성화
                </label>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeTrigger(index)}
                  className="text-xs text-rose-400 hover:underline disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <TriggerInput label="trigger_id" value={trigger.trigger_id} disabled={disabled} onChange={(v) => update(index, { trigger_id: v })} />
                <TriggerInput label="event_key" value={trigger.event_key} disabled={disabled} onChange={(v) => update(index, { event_key: v })} />
                <label className="block">
                  <span className="text-[10px] text-zinc-500">status_key</span>
                  <input
                    list="status-widget-trigger-keys"
                    disabled={disabled}
                    value={trigger.status_key}
                    onChange={(e) => update(index, { status_key: e.target.value })}
                    className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
                  />
                </label>
                <div className="grid grid-cols-[5rem_1fr] gap-2">
                  <label className="block">
                    <span className="text-[10px] text-zinc-500">operator</span>
                    <select
                      disabled={disabled}
                      value={trigger.operator}
                      onChange={(e) => update(index, { operator: e.target.value as StatusWidgetTriggerDraft["operator"] })}
                      className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
                    >
                      {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
                    </select>
                  </label>
                  <TriggerInput label="value" value={String(trigger.value)} disabled={disabled} onChange={(v) => update(index, { value: v })} />
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={trigger.fire_once}
                    disabled={disabled}
                    onChange={(e) => update(index, { fire_once: e.target.checked })}
                  />
                  한 번만 실행
                </label>
                <label className="block">
                  <span className="text-[10px] text-zinc-500">character_knowledge</span>
                  <select
                    disabled={disabled}
                    value={trigger.character_knowledge}
                    onChange={(e) => update(index, { character_knowledge: e.target.value as StatusWidgetTriggerDraft["character_knowledge"] })}
                    className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
                  >
                    {KNOWLEDGE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>
              </div>
              <label className="mt-2 block">
                <span className="text-[10px] text-zinc-500">effect_text</span>
                <textarea
                  disabled={disabled}
                  value={trigger.effect_text}
                  onChange={(e) => update(index, { effect_text: e.target.value })}
                  rows={3}
                  className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs leading-relaxed text-white"
                  placeholder="카운트가 끝났다. 지금부터 약속된 사건이 자연스럽게 발생한다."
                />
              </label>
              {errors[index] ? <p className="mt-2 text-[11px] text-rose-300">{errors[index]}</p> : null}
            </div>
          ))}
        </div>
      )}

      <datalist id="status-widget-trigger-keys">
        {statusKeys.map((key) => <option key={key} value={key} />)}
      </datalist>

      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <p className="text-xs font-semibold text-zinc-300">미리보기</p>
        <textarea
          value={sampleJson}
          onChange={(e) => setSampleJson(e.target.value)}
          rows={4}
          spellCheck={false}
          className="mt-2 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-200"
        />
        <p className="mt-2 text-[11px] text-zinc-500">
          실행 예상: {previewMatches.length > 0 ? previewMatches.join(", ") : "없음"}
        </p>
      </div>
    </div>
  );
}

function TriggerInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <input
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
      />
    </label>
  );
}
