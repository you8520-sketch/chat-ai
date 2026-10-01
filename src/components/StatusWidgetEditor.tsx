"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import StatusWidgetPreview from "@/components/StatusWidgetPreview";
import { compileJsxComponentSource } from "@/lib/jsxComponent/compile";
import type { JsxCapability } from "@/lib/jsxComponent/types";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import {
  BUILTIN_STATUS_WIDGET_TEMPLATES,
  buildBuiltinStatusWidgetTemplate,
  type BuiltinStatusWidgetTemplateId,
} from "@/lib/statusWidget/builtinTemplates";
import { defaultStatusWidgetJsxSource } from "@/lib/statusWidget/jsxAuthoring";
import {
  applyFieldLabelChange,
  fieldPlaceholderKey,
  uniqueStatusValueKey,
} from "@/lib/statusWidget/fieldKeys";
import {
  estimateStatusWidgetContextChars,
  formatWidgetBudgetHint,
  STATUS_WIDGET_CONTEXT_MAX,
} from "@/lib/statusWidget/contextBudget";
import type { StatusWidget, StatusWidgetField } from "@/lib/statusWidget/types";
import type { StatusWidgetProfileNames } from "@/lib/statusWidget/render";

const FORBIDDEN_TAGS =
  "script, iframe, svg, img, a, form, input, textarea, select, button, object, embed, math, style, link, meta, base, applet";

type TemplateChoice = BuiltinStatusWidgetTemplateId | "html" | "jsx";

const TEMPLATE_OPTIONS: Array<{
  id: TemplateChoice;
  label: string;
  desc: string;
}> = [
  { id: "clean", label: "클린 카드", desc: "여백 있는 중립 카드" },
  { id: "compact", label: "컴팩트 패널", desc: "촘촘한 정보 패널" },
  { id: "html", label: "HTML 직접제작", desc: "HTML 편집" },
  { id: "jsx", label: "JSX 직접제작", desc: "필드가 props로 전달" },
];

type Props = {
  value: StatusWidget;
  onChange: (widget: StatusWidget) => void;
  disabled?: boolean;
  /** 미리보기용 {{char}}/{{user}} 치환 (없으면 캐릭터/유저) */
  profileNames?: StatusWidgetProfileNames | null;
};

function cloneWidget(w: StatusWidget): StatusWidget {
  return {
    ...w,
    fields: w.fields.map((f) => ({ ...f })),
  };
}

function detectTemplateChoice(widget: StatusWidget): TemplateChoice {
  if (widget.jsxSource?.trim()) return "jsx";
  const ids: BuiltinStatusWidgetTemplateId[] = ["clean", "compact"];
  for (const id of ids) {
    const built = buildBuiltinStatusWidgetTemplate(id, widget.fields);
    if (built.htmlTemplate === widget.htmlTemplate) return id;
  }
  if (
    widget.htmlTemplate === BUILTIN_STATUS_WIDGET_TEMPLATES.clean.htmlTemplate ||
    widget.htmlTemplate === BUILTIN_STATUS_WIDGET_TEMPLATES.compact.htmlTemplate
  ) {
    return widget.htmlTemplate === BUILTIN_STATUS_WIDGET_TEMPLATES.compact.htmlTemplate
      ? "compact"
      : "clean";
  }
  return "html";
}

function jsxCapabilityLabel(capability: JsxCapability): string {
  switch (capability) {
    case "local_state":
      return "로컬 상태";
    case "animation":
      return "애니메이션";
    case "canvas":
      return "캔버스";
    case "chat_send":
      return "채팅 전송 요청";
    case "external_network":
      return "외부 네트워크";
    case "storage":
      return "저장소";
    case "navigation":
      return "페이지 이동";
    default: {
      const _never: never = capability;
      return _never;
    }
  }
}

function withoutJsx(widget: StatusWidget): StatusWidget {
  const next: StatusWidget = {
    version: widget.version,
    name: widget.name,
    htmlTemplate: widget.htmlTemplate,
    fields: widget.fields,
    placement: widget.placement,
  };
  return next;
}

export default function StatusWidgetEditor({
  value,
  onChange,
  disabled,
  profileNames,
}: Props) {
  const [templateChoice, setTemplateChoice] = useState<TemplateChoice>(() =>
    detectTemplateChoice(value)
  );
  const [copiedJsxProp, setCopiedJsxProp] = useState<string | null>(null);

  const widgetReservedChars = useMemo(
    () => estimateStatusWidgetContextChars(value),
    [value]
  );

  const widgetBudgetNearLimit = widgetReservedChars >= STATUS_WIDGET_CONTEXT_MAX * 0.85;

  const usableKeys = useMemo(
    () => value.fields.map((f) => fieldPlaceholderKey(f)).filter((k) => k.length > 0),
    [value.fields]
  );

  const jsxCompile = useMemo(() => {
    const source = value.jsxSource?.trim() ?? "";
    if (templateChoice !== "jsx" || !source) return null;
    return compileJsxComponentSource(source);
  }, [templateChoice, value.jsxSource]);

  function applyBuiltinTemplateToFields(fields: StatusWidget["fields"]): StatusWidget | null {
    if (templateChoice === "html" || templateChoice === "jsx") return null;
    const rebuilt = buildBuiltinStatusWidgetTemplate(templateChoice, fields);
    return { ...rebuilt, placement: value.placement };
  }

  /** initialValue 입력 UI 임시 비활성 — 저장·테스트는 invent/first-fill만 사용 */
  function stripFieldInitialValues(widget: StatusWidget): StatusWidget {
    return {
      ...widget,
      fields: widget.fields.map(({ initialValue: _omit, ...field }) => field),
    };
  }

  function commitFieldChange(next: StatusWidget) {
    const stripped = stripFieldInitialValues(next);
    onChange(applyBuiltinTemplateToFields(stripped.fields) ?? stripped);
  }

  function updateFieldInstruction(index: number, instruction: string) {
    const next = cloneWidget(value);
    next.fields[index] = { ...next.fields[index]!, instruction };
    commitFieldChange(next);
  }

  function updateFieldLabel(index: number, label: string) {
    const next = applyFieldLabelChange(value, index, label);
    commitFieldChange(next);
  }

  function addField() {
    const next = cloneWidget(value);
    const n = next.fields.length + 1;
    const label = `상태값 ${n}`;
    const existingKeys = next.fields.map(fieldPlaceholderKey).filter(Boolean);
    const id = uniqueStatusValueKey(label, existingKeys);
    next.fields.push({ id, label, instruction: "" });
    commitFieldChange(next);
  }

  function removeField(index: number) {
    if (value.fields.length <= 1) return;
    const next = cloneWidget(value);
    next.fields.splice(index, 1);
    commitFieldChange(next);
  }

  function insertPlaceholder(key: string) {
    onChange({ ...value, htmlTemplate: value.htmlTemplate + `{{${key}}}` });
  }

  async function copyJsxProp(key: string) {
    const snippet = `{props[${JSON.stringify(key)}]}`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedJsxProp(key);
      window.setTimeout(() => {
        setCopiedJsxProp((current) => (current === key ? null : current));
      }, 1_500);
    } catch {
      setCopiedJsxProp(null);
    }
  }

  function applyTemplate(choice: TemplateChoice) {
    setTemplateChoice(choice);
    const fields = value.fields.map((field) => ({ ...field }));
    if (choice === "html") {
      const htmlTemplate = value.htmlTemplate.trim()
        ? value.htmlTemplate
        : buildBuiltinStatusWidgetTemplate("clean", fields).htmlTemplate;
      onChange(
        stripFieldInitialValues(
          withoutJsx({
            ...value,
            htmlTemplate,
            fields,
          })
        )
      );
      return;
    }
    if (choice === "jsx") {
      const jsxSource = value.jsxSource?.trim()
        ? value.jsxSource
        : defaultStatusWidgetJsxSource(fields);
      onChange(
        stripFieldInitialValues({
          ...value,
          fields,
          jsxSource,
        })
      );
      return;
    }
    const picked = buildBuiltinStatusWidgetTemplate(choice, fields);
    onChange(
      stripFieldInitialValues({
        ...picked,
        placement: value.placement,
      })
    );
  }

  function loadDefault() {
    setTemplateChoice("clean");
    onChange(stripFieldInitialValues(cloneWidget(DEFAULT_STATUS_WIDGET)));
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-[#131626] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">상태창 위젯</h3>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/widgets"
            className="inline-flex min-h-11 items-center rounded-xl border border-white/10 px-3 text-xs text-zinc-300 hover:bg-white/5"
          >
            공유 상태창 둘러보기
          </Link>
          <button
            type="button"
            disabled={disabled}
            onClick={loadDefault}
            className="min-h-11 rounded-xl border border-white/10 px-3 text-xs text-zinc-300 hover:bg-white/5"
          >
            기본 템플릿
          </button>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-zinc-400">
        상태창은 기본 적용됩니다. 클린 카드와 컴팩트 패널은 상태값·지시사항만 바꾸면
        디자인이 다시 맞춰지고, HTML 직접제작과 JSX 직접제작은 표현만 다룹니다. 상태값
        추출은 같은 필드를 사용합니다.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {TEMPLATE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => applyTemplate(option.id)}
            className={`rounded-xl border px-3 py-2 text-left transition ${
              templateChoice === option.id
                ? "border-violet-500 bg-violet-600/20 text-violet-100 ring-1 ring-violet-500/40"
                : "border-white/10 bg-[#161922] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
            }`}
          >
            <span className="block text-xs font-bold">{option.label}</span>
            <span className="mt-0.5 block text-[10px] opacity-75">{option.desc}</span>
          </button>
        ))}
      </div>

      <p
        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
          widgetBudgetNearLimit
            ? "border-rose-500/50 bg-rose-500/10 text-rose-200 shadow-[0_0_18px_rgba(244,63,94,0.16)]"
            : "border-white/10 bg-white/[0.03] text-zinc-400"
        }`}
      >
        {formatWidgetBudgetHint(widgetReservedChars)}
      </p>

      <div className="space-y-1">
        <p className="text-xs text-zinc-400">
          상태창 미리보기 · 채팅 전송은 꺼져 있습니다. 아래 상태값/지시사항 변경이 즉시
          반영됩니다.
        </p>
        <div className="min-h-[160px] min-w-0 overflow-auto rounded-lg border border-white/10 bg-[#0a0a0c] p-2">
          <StatusWidgetPreview widget={value} profileNames={profileNames} />
        </div>
        {templateChoice === "jsx" && jsxCompile && !jsxCompile.ok ? (
          <p className="text-xs text-rose-300">
            {jsxCompile.error} 컴파일에 실패하면 저장 시 JSX는 제외됩니다.
          </p>
        ) : null}
        {templateChoice === "jsx" && jsxCompile?.ok ? (
          <p className="text-xs text-zinc-500">
            {jsxCompile.capabilities.length > 0
              ? `기능: ${jsxCompile.capabilities.map(jsxCapabilityLabel).join(", ")}`
              : "추가 기능 없음"}
            {jsxCompile.chatSend ? " · 미리보기에서는 채팅 전송이 꺼져 있습니다." : ""}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-zinc-200">① 상태값 · ② 지시사항</span>
          <button
            type="button"
            disabled={disabled}
            onClick={addField}
            className="min-h-11 rounded-xl bg-violet-600 px-3.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + 상태값 추가
          </button>
        </div>
        <p className="text-xs leading-relaxed text-zinc-500">
          날짜·현재시각·계절·날씨 등은 지시사항에 형식만 적어도 됩니다. 예: 시각{" "}
          <span className="text-zinc-400">HH:MM</span>, 날짜{" "}
          <span className="text-zinc-400">장면 날짜</span>. 첫 값은 AI가 장면에 맞게
          채웁니다.
        </p>
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

      {templateChoice === "html" && usableKeys.length > 0 && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-[#161922] p-3">
          <div>
            <p className="text-xs font-semibold text-zinc-200">사용 가능한 상태값</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              클릭하면 아래 HTML 작성칸에{" "}
              <span className="font-mono text-zinc-300">{`{{…}}`}</span> 가 삽입됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {usableKeys.map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => insertPlaceholder(key)}
                className="min-h-11 rounded-lg border border-white/10 bg-[#0b0d14] px-2.5 font-mono text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-40"
              >
                {`{{${key}}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {templateChoice === "jsx" && usableKeys.length > 0 && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-[#161922] p-3">
          <div>
            <p className="text-xs font-semibold text-zinc-200">JSX props</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              상태값 키가 props로 전달됩니다. 클릭하면 표현식을 복사합니다. 원하는 JSX 위치에
              붙여넣으세요. JSX 소스는 RP 프롬프트에 넣지 않습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {usableKeys.map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => void copyJsxProp(key)}
                className="min-h-11 rounded-lg border border-white/10 bg-[#0b0d14] px-2.5 font-mono text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-40"
              >
                {copiedJsxProp === key ? "복사됨 ✓" : `props[${JSON.stringify(key)}]`}
              </button>
            ))}
          </div>
        </div>
      )}

      {templateChoice === "html" && (
        <div>
          <span className="text-xs font-semibold text-zinc-400">③ 위젯 콘텐츠 (HTML)</span>
          <p className="mt-0.5 text-xs text-zinc-400">사용 불가 태그: {FORBIDDEN_TAGS}</p>
          <div className="mt-2 grid gap-3">
            <textarea
              disabled={disabled}
              value={value.htmlTemplate}
              onChange={(e) => onChange({ ...value, htmlTemplate: e.target.value })}
              rows={14}
              spellCheck={false}
              placeholder="위 「사용 가능한 상태값」을 클릭해 HTML에 넣거나, 직접 작성하세요."
              className="w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20"
            />
          </div>
        </div>
      )}

      {templateChoice === "jsx" && (
        <div>
          <span className="text-xs font-semibold text-zinc-400">③ 위젯 콘텐츠 (JSX)</span>
          <p className="mt-0.5 text-xs text-zinc-400">
            채팅과 같은 샌드박스에서 미리봅니다. import, 네트워크, 저장소, 페이지 이동은
            사용할 수 없습니다.
          </p>
          <div className="mt-2 grid gap-3">
            <textarea
              disabled={disabled}
              value={value.jsxSource ?? ""}
              onChange={(e) => onChange({ ...value, jsxSource: e.target.value })}
              rows={14}
              spellCheck={false}
              placeholder="export default function StatusWidgetView(props) { return <div>{props['시간']}</div>; }"
              className="w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20"
            />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <span>표시 위치</span>
        <select
          disabled={disabled}
          value={value.placement}
          onChange={(e) =>
            onChange({
              ...value,
              placement: e.target.value === "top" ? "top" : "bottom",
            })
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
    <div className="space-y-2 rounded-xl border border-white/10 bg-[#161922] p-3">
      <div className="flex flex-wrap items-start gap-2">
        <label className="min-w-[140px] flex-1">
          <span className="text-xs text-zinc-400">상태값</span>
          <input
            disabled={disabled}
            value={field.label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="예: 시간, 속마음, 호감도"
            className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#0b0d14] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20"
          />
        </label>
        {key ? (
          <div className="shrink-0 pt-4">
            <span className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[10px] text-zinc-300">
              {`{{${key}}}`}
            </span>
          </div>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            className="ml-auto min-h-11 px-2 text-xs text-rose-400 hover:underline"
          >
            삭제
          </button>
        ) : null}
      </div>
      <label className="block">
        <span className="text-xs text-zinc-400">지시사항 (AI용)</span>
        <textarea
          disabled={disabled}
          value={field.instruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          rows={2}
          placeholder="예: 현재 대화 시점의 시간을 24시간 형식으로 작성하세요. 출력 예시: 14:30"
          className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#0b0d14] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20"
        />
      </label>
    </div>
  );
}
