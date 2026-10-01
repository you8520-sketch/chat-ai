import { fieldPlaceholderKey } from "./fieldKeys";
import type { StatusWidget, StatusWidgetField } from "./types";

export type BuiltinStatusWidgetTemplateId = "clean" | "compact";

const DEFAULT_FIELDS: StatusWidget["fields"] = [
  {
    id: "시간",
    label: "시간",
    instruction: "현재 장면의 시각을 짧게 작성한다.",
  },
  {
    id: "장소",
    label: "장소",
    instruction: "현재 장면의 장소를 짧게 작성한다.",
  },
  {
    id: "현재상황",
    label: "현재상황",
    instruction: "지금 벌어지는 핵심 상황을 한 줄로 작성한다.",
  },
  {
    id: "현재목표",
    label: "현재목표",
    instruction: "NPC가 지금 이루려는 단기 목표를 짧게 작성한다.",
  },
  {
    id: "속마음",
    label: "속마음",
    instruction: "NPC의 현재 내면을 자연스러운 1인칭 한 줄로 작성한다.",
  },
];

const SHELL =
  "width:100%;min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word;";

function templateValue(field: StatusWidgetField): string {
  const key = fieldPlaceholderKey(field);
  return key ? `{{${key}}}` : "";
}

function escapeLabel(label: string): string {
  return label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function keyedFields(fields: StatusWidget["fields"]): StatusWidgetField[] {
  return fields.filter((field) => fieldPlaceholderKey(field).length > 0);
}

function findField(
  fields: StatusWidgetField[],
  key: string
): StatusWidgetField | undefined {
  return fields.find((field) => fieldPlaceholderKey(field) === key);
}

function metadataHtml(time?: StatusWidgetField, place?: StatusWidgetField): string {
  const parts = [time, place]
    .filter((field): field is StatusWidgetField => Boolean(field))
    .map((field) => templateValue(field));
  if (parts.length === 0) return "";
  return `<span style="min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;">${parts.join(" · ")}</span>`;
}

function numericRangeLabel(field: StatusWidgetField): string {
  const numeric = field.numericState;
  if (!numeric) return "";
  const min = numeric.integer ? String(Math.trunc(numeric.min)) : String(numeric.min);
  const max = numeric.integer ? String(Math.trunc(numeric.max)) : String(numeric.max);
  return `${min}–${max}`;
}

function cleanFieldHtml(field: StatusWidgetField): string {
  const label = escapeLabel(field.label.trim() || field.id || "상태값");
  const value = templateValue(field);
  if (field.numericState) {
    const range = escapeLabel(numericRangeLabel(field));
    return `<div style="min-width:0;max-width:100%;padding:12px;border-radius:12px;background:#1a1d27;border:1px solid rgba(196,181,253,0.45);box-sizing:border-box;"><div style="font-size:11px;color:#c4b5fd;overflow-wrap:anywhere;">${label}</div><div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;min-width:0;"><span style="min-width:0;color:#fafafa;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;word-break:break-word;">${value}</span>${range ? `<span style="border:1px solid rgba(196,181,253,0.28);border-radius:999px;padding:1px 6px;color:#a1a1aa;font-size:10px;">${range}</span>` : ""}</div></div>`;
  }
  return `<div style="min-width:0;max-width:100%;padding:12px;border-radius:12px;background:rgba(255,255,255,0.03);box-sizing:border-box;"><div style="font-size:11px;color:#a1a1aa;overflow-wrap:anywhere;">${label}</div><div style="margin-top:6px;min-width:0;color:#f4f4f5;overflow-wrap:anywhere;word-break:break-word;">${value}</div></div>`;
}

function compactFieldHtml(field: StatusWidgetField): string {
  const label = escapeLabel(field.label.trim() || field.id || "상태값");
  const value = templateValue(field);
  if (field.numericState) {
    const range = escapeLabel(numericRangeLabel(field));
    return `<div style="display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;min-width:0;max-width:100%;padding-top:6px;border-top:1px solid rgba(196,181,253,0.35);"><span style="flex:0 1 auto;max-width:100%;min-width:0;color:#c4b5fd;overflow-wrap:anywhere;">${label}</span><span style="flex:1 1 8rem;min-width:0;max-width:100%;color:#fafafa;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;word-break:break-word;">${value}${range ? ` <span style="color:#a1a1aa;">${range}</span>` : ""}</span></div>`;
  }
  return `<div style="display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;min-width:0;max-width:100%;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);"><span style="flex:0 1 auto;max-width:100%;min-width:0;color:#a1a1aa;overflow-wrap:anywhere;">${label}</span><span style="flex:1 1 8rem;min-width:0;max-width:100%;color:#f4f4f5;overflow-wrap:anywhere;word-break:break-word;">${value}</span></div>`;
}

function situationHtml(field: StatusWidgetField, compact: boolean): string {
  const label = escapeLabel(field.label.trim() || "현재상황");
  const value = templateValue(field);
  if (compact) {
    return `<div style="margin-top:8px;min-width:0;max-width:100%;"><div style="font-size:11px;color:#a1a1aa;overflow-wrap:anywhere;">${label}</div><div style="margin-top:2px;min-width:0;font-size:15px;font-weight:600;line-height:1.45;color:#fafafa;overflow-wrap:anywhere;word-break:break-word;">${value}</div></div>`;
  }
  return `<div style="margin-top:14px;min-width:0;max-width:100%;"><div style="font-size:11px;color:#a1a1aa;overflow-wrap:anywhere;">${label}</div><div style="margin-top:4px;min-width:0;font-size:18px;font-weight:600;line-height:1.45;color:#fafafa;overflow-wrap:anywhere;word-break:break-word;">${value}</div></div>`;
}

function cleanHtml(fields: StatusWidget["fields"]): string {
  const keyed = keyedFields(fields);
  const time = findField(keyed, "시간");
  const place = findField(keyed, "장소");
  const situation = findField(keyed, "현재상황");
  const rest = keyed.filter((field) => field !== time && field !== place && field !== situation);
  const meta = metadataHtml(time, place);
  const grid = rest.map((field) => cleanFieldHtml(field)).join("");
  return `<div style="${SHELL}margin:0;padding:16px;border-radius:16px;background:#12141a;border:1px solid rgba(255,255,255,0.12);color:#ececf1;font-family:inherit;line-height:1.55;"><div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;min-width:0;max-width:100%;"><div style="min-width:0;max-width:100%;font-size:15px;font-weight:700;overflow-wrap:anywhere;word-break:break-word;">{{char}}</div>${meta ? `<div style="display:flex;flex-wrap:wrap;gap:6px;min-width:0;max-width:100%;font-size:12px;color:#a1a1aa;">${meta}</div>` : ""}</div>${situation ? situationHtml(situation, false) : ""}${grid ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:10px;margin-top:14px;min-width:0;max-width:100%;">${grid}</div>` : ""}</div>`;
}

function compactHtml(fields: StatusWidget["fields"]): string {
  const keyed = keyedFields(fields);
  const time = findField(keyed, "시간");
  const place = findField(keyed, "장소");
  const situation = findField(keyed, "현재상황");
  const rest = keyed.filter((field) => field !== time && field !== place && field !== situation);
  const meta = metadataHtml(time, place);
  const rows = rest.map((field) => compactFieldHtml(field)).join("");
  return `<div style="${SHELL}margin:0;padding:10px 12px;border-radius:12px;background:#101218;border:1px solid rgba(255,255,255,0.1);color:#e4e4e7;font-family:inherit;font-size:13px;line-height:1.45;"><div style="display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;min-width:0;max-width:100%;font-size:12px;color:#a1a1aa;"><span style="min-width:0;max-width:100%;font-weight:700;color:#ececf1;overflow-wrap:anywhere;word-break:break-word;">{{char}}</span>${meta}</div>${situation ? situationHtml(situation, true) : ""}${rows ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;min-width:0;max-width:100%;">${rows}</div>` : ""}</div>`;
}

const TEMPLATE_NAMES: Record<BuiltinStatusWidgetTemplateId, string> = {
  clean: "클린 카드",
  compact: "컴팩트 패널",
};

export function buildBuiltinStatusWidgetTemplate(
  id: BuiltinStatusWidgetTemplateId,
  fields: StatusWidget["fields"] = DEFAULT_FIELDS
): StatusWidget {
  switch (id) {
    case "clean":
      return {
        version: 1,
        name: TEMPLATE_NAMES.clean,
        placement: "bottom",
        fields: fields.map((field) => ({ ...field })),
        htmlTemplate: cleanHtml(fields),
      };
    case "compact":
      return {
        version: 1,
        name: TEMPLATE_NAMES.compact,
        placement: "bottom",
        fields: fields.map((field) => ({ ...field })),
        htmlTemplate: compactHtml(fields),
      };
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export const BUILTIN_STATUS_WIDGET_TEMPLATES: Record<
  BuiltinStatusWidgetTemplateId,
  StatusWidget
> = {
  clean: buildBuiltinStatusWidgetTemplate("clean"),
  compact: buildBuiltinStatusWidgetTemplate("compact"),
};

export function cloneStatusWidgetTemplate(template: StatusWidget): StatusWidget {
  return {
    ...template,
    fields: template.fields.map((field) => ({ ...field })),
  };
}
