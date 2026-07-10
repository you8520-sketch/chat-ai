"use client";

import { useMemo } from "react";
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

export type StatusKeyOption = {
  key: string;
  label: string;
};

export type DetectedTriggerCandidate = Partial<StatusWidgetTriggerDraft> & {
  source_text?: string;
};

const OPERATORS = ["<=", ">=", "==", "!=", "<", ">"] as const;
const KNOWLEDGE_OPTIONS = ["unknown", "known", "revealed_on_trigger"] as const;
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const OPERATOR_LABELS: Record<StatusWidgetTriggerDraft["operator"], string> = {
  "<=": "이하가 되면",
  ">=": "이상이 되면",
  "==": "같아지면",
  "!=": "달라지면",
  "<": "미만이 되면",
  ">": "초과가 되면",
};

export const KNOWLEDGE_LABELS: Record<StatusWidgetTriggerDraft["character_knowledge"], string> = {
  unknown: "캐릭터는 모름",
  known: "캐릭터도 알고 있음",
  revealed_on_trigger: "사건이 발생하면 알게 됨",
};

const COMMON_STATUS_OPTIONS: StatusKeyOption[] = [
  { key: "d_day", label: "D-DAY" },
  { key: "affection", label: "호감도" },
  { key: "trust", label: "신뢰도" },
  { key: "distrust", label: "불신도" },
  { key: "corruption", label: "오염도" },
  { key: "route_flag", label: "루트 플래그" },
];

const COMMON_STATUS_LABELS = Object.fromEntries(
  COMMON_STATUS_OPTIONS.map((option) => [option.key, option.label])
) as Record<string, string>;

const OPERATOR_ID_PART: Record<StatusWidgetTriggerDraft["operator"], string> = {
  "<=": "lte",
  ">=": "gte",
  "==": "eq",
  "!=": "neq",
  "<": "lt",
  ">": "gt",
};

const PRESETS: Array<{
  label: string;
  trigger: Partial<StatusWidgetTriggerDraft> &
    Pick<StatusWidgetTriggerDraft, "status_key" | "operator" | "value" | "effect_text">;
}> = [
  {
    label: "D-DAY가 0 이하가 되면",
    trigger: {
      status_key: "d_day",
      operator: "<=",
      value: 0,
      fire_once: true,
      effect_text: "카운트가 끝났다. 약속된 사건이 다음 장면에서 자연스럽게 발생한다.",
      character_knowledge: "revealed_on_trigger",
    },
  },
  {
    label: "호감도가 80 이상이 되면",
    trigger: {
      status_key: "affection",
      operator: ">=",
      value: 80,
      fire_once: true,
      effect_text: "호감이 충분히 쌓였다. 관계가 한 단계 가까워지는 사건이 자연스럽게 발생한다.",
      character_knowledge: "revealed_on_trigger",
    },
  },
  {
    label: "신뢰도가 20 이하가 되면",
    trigger: {
      status_key: "trust",
      operator: "<=",
      value: 20,
      fire_once: true,
      effect_text: "신뢰가 무너졌다. 오해와 경계심이 드러나는 사건이 자연스럽게 발생한다.",
      character_knowledge: "revealed_on_trigger",
    },
  },
  {
    label: "오염도가 100 이상이 되면",
    trigger: {
      status_key: "corruption",
      operator: ">=",
      value: 100,
      fire_once: true,
      effect_text: "오염이 한계에 도달했다. 숨겨진 변화가 장면 안에서 자연스럽게 드러난다.",
      character_knowledge: "revealed_on_trigger",
    },
  },
  {
    label: "루트 플래그가 true가 되면",
    trigger: {
      status_key: "route_flag",
      operator: "==",
      value: "true",
      fire_once: true,
      effect_text: "새로운 루트 조건이 열렸다. 다음 장면에서 관련 사건이 자연스럽게 이어진다.",
      character_knowledge: "revealed_on_trigger",
    },
  },
];

function slugifyIdPart(value: unknown): string {
  return (
    String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "_")
      .replace(/[가-힣]/g, "")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_") || "value"
  );
}

function uniqueId(base: string, existing: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function generateTriggerIds(
  trigger: Pick<StatusWidgetTriggerDraft, "status_key" | "operator" | "value">,
  existing: StatusWidgetTriggerDraft[] = []
): Pick<StatusWidgetTriggerDraft, "trigger_id" | "event_key"> {
  const key = slugifyIdPart(trigger.status_key || "status");
  const op = OPERATOR_ID_PART[trigger.operator] ?? "when";
  const compareValue = slugifyIdPart(trigger.value);
  const triggerBase = `${key}_${op}_${compareValue}`;
  const eventBase = `${key}_event`;
  return {
    trigger_id: uniqueId(triggerBase, new Set(existing.map((item) => item.trigger_id).filter(Boolean))),
    event_key: uniqueId(eventBase, new Set(existing.map((item) => item.event_key).filter(Boolean))),
  };
}

export function normalizeTriggerDraft(
  raw: Partial<StatusWidgetTriggerDraft> = {},
  existing: StatusWidgetTriggerDraft[] = []
): StatusWidgetTriggerDraft {
  const base = {
    status_key: raw.status_key ?? "",
    operator: raw.operator ?? "<=",
    value: raw.value ?? "",
  };
  const generated = generateTriggerIds(base, existing);
  return {
    trigger_id: raw.trigger_id?.trim() || generated.trigger_id,
    status_key: base.status_key,
    operator: base.operator,
    value: base.value,
    fire_once: raw.fire_once ?? true,
    event_key: raw.event_key?.trim() || generated.event_key,
    effect_text: raw.effect_text ?? "",
    character_knowledge: raw.character_knowledge ?? "revealed_on_trigger",
    is_enabled: raw.is_enabled ?? true,
  };
}

export function validationError(trigger: StatusWidgetTriggerDraft, options?: StatusKeyOption[]): string | null {
  if (!trigger.status_key.trim()) return "어떤 상태창 값을 기준으로 할지 선택해 주세요.";
  if (options && !options.some((option) => option.key === trigger.status_key)) {
    return "상태창에 실제로 존재하는 값을 선택해 주세요.";
  }
  if (!OPERATORS.includes(trigger.operator)) return "실행 조건을 선택해 주세요.";
  if (String(trigger.value).trim().length === 0) {
    return "조건을 비교할 값을 입력해 주세요. 예: D-DAY 종료 조건이면 0";
  }
  if (!trigger.effect_text.trim()) return "조건이 만족되었을 때 발생할 사건을 적어 주세요.";
  if (!/[가-힣]/.test(trigger.effect_text.trim())) {
    return "발생할 사건은 제작자가 읽을 수 있는 한국어 문장으로 적어 주세요.";
  }
  if (!SNAKE_CASE_RE.test(trigger.trigger_id.trim()) || !SNAKE_CASE_RE.test(trigger.event_key.trim())) {
    return "내부 조건 정보가 올바르지 않습니다. 상태값이나 조건을 다시 선택해 주세요.";
  }
  if (!KNOWLEDGE_OPTIONS.includes(trigger.character_knowledge)) return "캐릭터가 이 조건을 아는지 선택해 주세요.";
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

function fieldLabel(field: StatusWidget["fields"][number]): string {
  const key = fieldKey(field);
  return field.label?.trim() || COMMON_STATUS_LABELS[key] || key;
}

export function statusKeyOptionsFromWidget(statusWidget: StatusWidget): StatusKeyOption[] {
  const fromWidget = statusWidget.fields
    .map((field) => ({ key: fieldKey(field), label: fieldLabel(field) }))
    .filter((option) => option.key);
  const seen = new Set<string>();
  return [...COMMON_STATUS_OPTIONS, ...fromWidget].filter((option) => {
    if (seen.has(option.key)) return false;
    seen.add(option.key);
    return true;
  });
}

export function labelForStatusKey(statusKey: string, options: StatusKeyOption[]): string {
  return options.find((option) => option.key === statusKey)?.label || COMMON_STATUS_LABELS[statusKey] || statusKey;
}

export function formatTriggerSentence(trigger: StatusWidgetTriggerDraft, options: StatusKeyOption[] = []): string {
  const label = labelForStatusKey(trigger.status_key, options);
  const value = String(trigger.value ?? "").trim() || "값";
  const condition = OPERATOR_LABELS[trigger.operator] ?? "조건이 되면";
  return `${label}가 ${value} ${condition} 다음 턴에 사건이 발생합니다.`;
}

export function applyDetectedTriggerCandidate(
  candidate: Partial<StatusWidgetTriggerDraft>,
  existing: StatusWidgetTriggerDraft[] = []
): StatusWidgetTriggerDraft {
  return normalizeTriggerDraft(
    {
      ...candidate,
      fire_once: candidate.fire_once ?? true,
      character_knowledge: candidate.character_knowledge ?? "revealed_on_trigger",
      is_enabled: candidate.is_enabled ?? true,
    },
    existing
  );
}

export default function StatusWidgetTriggerEditor({
  value,
  onChange,
  statusWidget,
  disabled,
  detectedCandidates = [],
}: {
  value: StatusWidgetTriggerDraft[];
  onChange: (triggers: StatusWidgetTriggerDraft[]) => void;
  statusWidget: StatusWidget;
  disabled?: boolean;
  detectedCandidates?: DetectedTriggerCandidate[];
}) {
  const statusOptions = useMemo(() => statusKeyOptionsFromWidget(statusWidget), [statusWidget]);
  const errors = value.map((trigger) => validationError(trigger, statusOptions));

  function update(index: number, patch: Partial<StatusWidgetTriggerDraft>) {
    onChange(value.map((trigger, i) => (i === index ? { ...trigger, ...patch } : trigger)));
  }

  function updateCondition(index: number, patch: Partial<StatusWidgetTriggerDraft>) {
    onChange(
      value.map((trigger, i) => {
        if (i !== index) return trigger;
        const updated = { ...trigger, ...patch };
        const existing = value.filter((_, j) => j !== index);
        return { ...updated, ...generateTriggerIds(updated, existing) };
      })
    );
  }

  function addTrigger(seed: Partial<StatusWidgetTriggerDraft> = {}) {
    onChange([...value, normalizeTriggerDraft(seed, value)]);
  }

  function applyCandidate(candidate: DetectedTriggerCandidate) {
    onChange([...value, applyDetectedTriggerCandidate(candidate, value)]);
  }

  function removeTrigger(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-[#131626] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">상태창 사건 조건</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            상태창 값이 특정 조건이 되면 다음 턴에 사건이 발생합니다.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => addTrigger()}
          className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-50"
        >
          + 사건 조건 추가
        </button>
      </div>

      {detectedCandidates.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-white/10 bg-[#161922] p-3">
          <p className="text-xs font-semibold text-zinc-100">자동 감지된 사건 조건</p>
          {detectedCandidates.map((candidate, index) => {
            const draft = applyDetectedTriggerCandidate(candidate, value);
            return (
              <div key={`${candidate.source_text ?? index}`} className="rounded border border-white/10 bg-black/20 p-3">
                {candidate.source_text ? (
                  <p className="text-[11px] leading-relaxed text-zinc-400">원문: "{candidate.source_text}"</p>
                ) : null}
                <p className="mt-2 text-xs font-semibold text-zinc-200">
                  추천 조건: {formatTriggerSentence(draft, statusOptions)}
                </p>
                <p className="mt-1 text-[11px] text-zinc-300">→ {draft.effect_text || "사건 내용을 입력해 주세요."}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => applyCandidate(candidate)}
                    className="min-h-11 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-200 disabled:opacity-50"
                  >
                    적용
                  </button>
                  <button type="button" className="min-h-11 rounded-lg border border-white/10 px-3 text-xs text-zinc-400">
                    수정
                  </button>
                  <button type="button" className="min-h-11 rounded-lg border border-white/10 px-3 text-xs text-zinc-400">
                    무시
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={disabled}
            onClick={() => addTrigger(preset.trigger)}
            className="min-h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-zinc-300 hover:border-white/20 hover:text-zinc-100 disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {value.length === 0 ? (
        <p className="rounded-lg border border-white/5 bg-black/20 px-3 py-3 text-xs text-zinc-500">
          등록된 사건 조건이 없습니다.
        </p>
      ) : (
        <div className="space-y-3">
          {value.map((trigger, index) => (
            <div key={`${trigger.trigger_id}-${index}`} className="rounded-lg border border-white/10 bg-[#0b0d14]/90 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={trigger.is_enabled}
                    disabled={disabled}
                    onChange={(e) => update(index, { is_enabled: e.target.checked })}
                  />
                  사용
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

              <p className="mb-3 rounded border border-white/5 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-200">
                현재 설정: {formatTriggerSentence(trigger, statusOptions)}
              </p>

              <div className="grid gap-3 md:grid-cols-[1fr_8rem_1fr]">
                <label className="block">
                  <span className="text-xs font-semibold text-zinc-300">상태값</span>
                  <select
                    disabled={disabled}
                    value={statusOptions.some((option) => option.key === trigger.status_key) ? trigger.status_key : ""}
                    onChange={(e) => updateCondition(index, { status_key: e.target.value })}
                    className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-xs text-zinc-100 outline-none focus:border-violet-500/60"
                  >
                    <option value="">상태값 선택</option>
                    {statusOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <TriggerInput
                  label="비교값"
                  value={String(trigger.value)}
                  disabled={disabled}
                  helper="예: 0, 80, true"
                  onChange={(v) => updateCondition(index, { value: v })}
                />
                <label className="block">
                  <span className="text-xs font-semibold text-zinc-300">조건</span>
                  <select
                    disabled={disabled}
                    value={trigger.operator}
                    onChange={(e) =>
                      updateCondition(index, { operator: e.target.value as StatusWidgetTriggerDraft["operator"] })
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-xs text-zinc-100 outline-none focus:border-violet-500/60"
                  >
                    {OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-3 block">
                <span className="text-xs font-semibold text-zinc-300">발생할 사건</span>
                <textarea
                  disabled={disabled}
                  value={trigger.effect_text}
                  onChange={(e) => update(index, { effect_text: e.target.value })}
                  rows={3}
                  className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-2 text-xs leading-relaxed text-white"
                  placeholder="조건이 만족되었을 때 다음 턴에 자연스럽게 발생할 사건을 적어 주세요."
                />
              </label>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={trigger.fire_once}
                    disabled={disabled}
                    onChange={(e) => update(index, { fire_once: e.target.checked })}
                  />
                  한 번만 실행
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-zinc-300">캐릭터가 이 조건을 아는지</span>
                  <select
                    disabled={disabled}
                    value={trigger.character_knowledge}
                    onChange={(e) =>
                      update(index, {
                        character_knowledge: e.target.value as StatusWidgetTriggerDraft["character_knowledge"],
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-xs text-zinc-100 outline-none focus:border-violet-500/60"
                  >
                    {KNOWLEDGE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {KNOWLEDGE_LABELS[opt]}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[10px] text-zinc-500">
                    상태창 값은 유저에게 보일 수 있지만, 캐릭터가 그 의미를 아는지는 별도 설정입니다.
                  </span>
                </label>
              </div>

              {errors[index] ? <p className="mt-2 text-[11px] text-rose-300">{errors[index]}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TriggerInput({
  label,
  value,
  disabled,
  helper,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  helper?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-zinc-300">{label}</span>
      <input
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-xs text-zinc-100 outline-none focus:border-violet-500/60 disabled:opacity-70"
      />
      {helper ? <span className="mt-1 block text-[10px] text-zinc-500">{helper}</span> : null}
    </label>
  );
}
