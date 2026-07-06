import { fieldPlaceholderKey } from "./fieldKeys";
import type { StatusWidget, StatusWidgetField } from "./types";

export type BuiltinStatusWidgetTemplateId = "modern" | "sf";

const DEFAULT_FIELDS: StatusWidget["fields"] = [
  {
    id: "시간",
    label: "시간",
    instruction:
      "장면의 현재 시각. 짧게 (예: 14:30, 오후 2시 30분). 이전 턴 시간에서 장면 경과를 반영.",
  },
  {
    id: "장소",
    label: "장소",
    instruction: "현재 장면이 일어나는 장소 이름. 짧게.",
  },
  {
    id: "속마음",
    label: "속마음",
    instruction: "NPC의 속마음·의식의 흐름을 한 줄로. 1인칭 내면.",
  },
  {
    id: "현재상황",
    label: "현재상황",
    instruction: "지금 벌어지는 상황을 한 줄로 요약.",
  },
  {
    id: "의식의흐름",
    label: "의식의흐름",
    instruction:
      "NPC의 의식의 흐름을 간단히 작성한다. 출력 예시 : 안기고싶다 → 내가 미친건가? → 가끔은 괜찮을지도",
  },
];

function templateValue(field: StatusWidgetField): string {
  const key = fieldPlaceholderKey(field);
  return key ? `{{${key}}}` : "—";
}

function escapeLabel(label: string): string {
  return label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function contentFields(fields: StatusWidget["fields"]): StatusWidget["fields"] {
  return fields.filter((field) => {
    const key = fieldPlaceholderKey(field);
    return key !== "시간" && key !== "장소";
  });
}

function modernHtml(fields: StatusWidget["fields"]): string {
  const rows = contentFields(fields)
    .map((field) => {
      const label = escapeLabel(field.label.trim() || field.id || "상태값");
      return `<div style="display:flex;gap:12px;align-items:flex-start;min-width:max-content;"><span style="flex:0 0 auto;min-width:max-content;color:#58a6ff;font-weight:600;white-space:nowrap;">▪ ${label}</span><span style="flex:1 1 auto;min-width:260px;color:#f0f6fc;overflow-wrap:anywhere;">${templateValue(field)}</span></div>`;
    })
    .join("");

  return `<div style="width:max-content;min-width:550px;max-width:none;margin:12px auto;padding:18px 20px;border-radius:14px;background:#0d1117;border:1px solid #21262d;box-shadow:0 12px 24px rgba(0,0,0,0.5);font-family:'Pretendard',sans-serif;color:#c9d1d9;line-height:1.6;word-break:keep-all;"><div style="display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #21262d;white-space:nowrap;"><div style="display:flex;align-items:center;gap:6px;white-space:nowrap;"><span style="display:inline-block;width:6px;height:6px;background:#58a6ff;border-radius:50%;"></span><span style="font-size:13px;font-weight:700;color:#f0f6fc;letter-spacing:0.02em;white-space:nowrap;">STATUS REPORT</span></div><span style="font-size:11px;color:#8b949e;background:#161b22;padding:2px 8px;border-radius:20px;white-space:nowrap;">{{시간}} · {{장소}}</span></div><div style="display:flex;flex-direction:column;gap:14px;font-size:14px;">${rows}</div></div>`;
}

function neonHtml(fields: StatusWidget["fields"]): string {
  const rows = contentFields(fields)
    .map((field) => {
      const label = escapeLabel(
        field.label.trim() || field.id || "STATUS",
      ).toUpperCase();
      return `<div style="display:flex;gap:12px;align-items:flex-start;min-width:max-content;"><span style="flex:0 0 auto;min-width:max-content;color:#00f0ff;font-weight:600;letter-spacing:0.02em;white-space:nowrap;">[${label.replaceAll("_", " ")}]</span><span style="flex:1 1 auto;min-width:260px;color:#d0f0ff;overflow-wrap:anywhere;">${templateValue(field)}</span></div>`;
    })
    .join("");

  return `<div style="width:max-content;min-width:550px;max-width:none;margin:12px auto;padding:18px 20px;border-radius:6px;background:#030508;border:1px solid #00f0ff;box-shadow:0 0 15px rgba(0,240,255,0.15), inset 0 0 10px rgba(0,240,255,0.05);font-family:'Orbitron',sans-serif;color:#c0e0ff;line-height:1.6;word-break:keep-all;"><div style="display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:14px;padding-bottom:10px;border-bottom:1px dashed rgba(0,240,255,0.3);white-space:nowrap;"><span style="font-size:13px;font-weight:700;color:#00f0ff;letter-spacing:0.1em;text-shadow:0 0 8px rgba(0,240,255,0.6);white-space:nowrap;">[ SYSTEM OVERVIEW ]</span><span style="font-size:11px;color:#6bbcff;letter-spacing:0.05em;white-space:nowrap;">{{시간}} // {{장소}}</span></div><div style="display:flex;flex-direction:column;gap:12px;font-size:14px;">${rows}</div></div>`;
}

export function buildBuiltinStatusWidgetTemplate(
  id: BuiltinStatusWidgetTemplateId,
  fields: StatusWidget["fields"] = DEFAULT_FIELDS,
): StatusWidget {
  return {
    version: 1,
    name: id === "modern" ? "현대풍" : "네온 스타일",
    placement: "bottom",
    fields: fields.map((field) => ({ ...field })),
    htmlTemplate: id === "modern" ? modernHtml(fields) : neonHtml(fields),
  };
}

export const BUILTIN_STATUS_WIDGET_TEMPLATES: Record<
  BuiltinStatusWidgetTemplateId,
  StatusWidget
> = {
  modern: buildBuiltinStatusWidgetTemplate("modern"),
  sf: buildBuiltinStatusWidgetTemplate("sf"),
};

export function cloneStatusWidgetTemplate(
  template: StatusWidget,
): StatusWidget {
  return {
    ...template,
    fields: template.fields.map((field) => ({ ...field })),
  };
}
