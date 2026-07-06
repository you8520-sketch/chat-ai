import type { StatusWidget } from "./types";

export type BuiltinStatusWidgetTemplateId =
  | "western_fantasy"
  | "eastern_fantasy"
  | "modern"
  | "sf";

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

function widget(name: string, htmlTemplate: string): StatusWidget {
  return {
    version: 1,
    name,
    placement: "bottom",
    fields: DEFAULT_FIELDS.map((f) => ({ ...f })),
    htmlTemplate,
  };
}

export const BUILTIN_STATUS_WIDGET_TEMPLATES: Record<
  BuiltinStatusWidgetTemplateId,
  StatusWidget
> = {
  western_fantasy: widget(
    "서양 판타지풍",
    `<div style="max-width:550px;margin:12px auto;padding:18px 20px;border-radius:10px;background:radial-gradient(circle at 50% 0%, rgba(212,175,55,0.08), transparent 70%), linear-gradient(#140f07, #070502);border:1px solid rgba(212,175,55,0.4);box-shadow:inset 0 0 15px rgba(212,175,55,0.1), 0 10px 25px rgba(0,0,0,0.8);font-family:'Cinzel','Times New Roman',serif;color:#e3dac9;line-height:1.6;word-break:keep-all;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(212,175,55,0.25);"><span style="font-size:14px;font-weight:700;color:#f3e5ab;letter-spacing:0.1em;text-shadow:0 0 8px rgba(212,175,55,0.4);">✦ STATUS WINDOW ✦</span><span style="font-size:12px;color:#b8a98f;">{{시간}} · {{장소}}</span></div><div style="display:flex;flex-direction:column;gap:12px;font-size:14px;"><div style="display:flex;gap:12px;align-items:flex-start;"><span style="flex:0 0 85px;color:#d4af37;font-weight:600;text-shadow:0 0 5px rgba(212,175,55,0.2);">◈ 속마음</span><span style="flex:1;color:#e8e2d0;font-style:italic;">{{속마음}}</span></div><div style="display:flex;gap:12px;align-items:flex-start;padding-top:4px;"><span style="flex:0 0 85px;color:#d4af37;font-weight:600;text-shadow:0 0 5px rgba(212,175,55,0.2);">◈ 현재상황</span><span style="flex:1;color:#e8e2d0;text-align:justify;">{{현재상황}}</span></div><div style="display:flex;gap:12px;align-items:flex-start;padding-top:4px;"><span style="flex:0 0 85px;color:#d4af37;font-weight:600;text-shadow:0 0 5px rgba(212,175,55,0.2);">◈ 의식의 흐름</span><span style="flex:1;color:#c5b394;">{{의식의흐름}}</span></div></div></div>`,
  ),
  eastern_fantasy: widget(
    "동양 판타지풍",
    `<div style="max-width:550px;margin:12px auto;padding:18px 20px;border-radius:4px;background:linear-gradient(160deg, #120909, #070404);border:1px solid #3a1a1a;border-top:3px solid #b22222;box-shadow:inset 0 0 20px rgba(178,34,34,0.1), 0 8px 20px rgba(0,0,0,0.9);font-family:'Gungsuh','Noto Serif KR',serif;color:#d9cfcf;line-height:1.6;word-break:keep-all;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(178,34,34,0.25);"><span style="font-size:14px;font-weight:700;color:#e65c5c;letter-spacing:0.15em;">— 狀態窓 (상태창) —</span><span style="font-size:12px;color:#a69292;">{{시간}} · {{장소}}</span></div><div style="display:flex;flex-direction:column;gap:12px;font-size:14px;"><div style="display:flex;gap:12px;align-items:flex-start;"><span style="flex:0 0 85px;color:#cc9999;font-weight:600;">[ 속마음 ]</span><span style="flex:1;color:#ece3e3;">{{속마음}}</span></div><div style="display:flex;gap:12px;align-items:flex-start;padding-top:4px;"><span style="flex:0 0 85px;color:#cc9999;font-weight:600;">[ 현재상황 ]</span><span style="flex:1;color:#ece3e3;text-align:justify;">{{현재상황}}</span></div><div style="display:flex;gap:12px;align-items:flex-start;padding-top:4px;"><span style="flex:0 0 85px;color:#cc9999;font-weight:600;">[ 의식의흐름 ]</span><span style="flex:1;color:#bfa7a7;">{{의식의흐름}}</span></div></div></div>`,
  ),
  modern: widget(
    "현대풍",
    `<div style="max-width:550px;margin:12px auto;padding:18px 20px;border-radius:14px;background:#0d1117;border:1px solid #21262d;box-shadow:0 12px 24px rgba(0,0,0,0.5);font-family:'Pretendard',sans-serif;color:#c9d1d9;line-height:1.6;word-break:keep-all;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #21262d;"><div style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:6px;height:6px;background:#58a6ff;border-radius:50%;"></span><span style="font-size:13px;font-weight:700;color:#f0f6fc;letter-spacing:0.02em;">STATUS REPORT</span></div><span style="font-size:11px;color:#8b949e;background:#161b22;padding:2px 8px;border-radius:20px;">{{시간}} · {{장소}}</span></div><div style="display:flex;flex-direction:column;gap:14px;font-size:14px;"><div style="display:flex;gap:12px;align-items:flex-start;"><span style="flex:0 0 85px;color:#58a6ff;font-weight:600;">▪ 속마음</span><span style="flex:1;color:#f0f6fc;">{{속마음}}</span></div><div style="display:flex;gap:12px;align-items:flex-start;"><span style="flex:0 0 85px;color:#58a6ff;font-weight:600;">▪ 현재상황</span><span style="flex:1;color:#f0f6fc;text-align:justify;">{{현재상황}}</span></div><div style="display:flex;gap:12px;align-items:flex-start;"><span style="flex:0 0 85px;color:#58a6ff;font-weight:600;">▪ 의식의 흐름</span><span style="flex:1;color:#8b949e;">{{의식의흐름}}</span></div></div></div>`,
  ),
  sf: widget(
    "SF풍",
    `<div style="max-width:550px;margin:12px auto;padding:18px 20px;border-radius:6px;background:#030508;border:1px solid #00f0ff;box-shadow:0 0 15px rgba(0,240,255,0.15), inset 0 0 10px rgba(0,240,255,0.05);font-family:'Orbitron',sans-serif;color:#c0e0ff;line-height:1.6;word-break:keep-all;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px dashed rgba(0,240,255,0.3);"><span style="font-size:13px;font-weight:700;color:#00f0ff;letter-spacing:0.1em;text-shadow:0 0 8px rgba(0,240,255,0.6);">[ SYSTEM_OVERVIEW ]</span><span style="font-size:11px;color:#6bbcff;letter-spacing:0.05em;">{{시간}} // {{장소}}</span></div><div style="display:flex;flex-direction:column;gap:12px;font-size:14px;"><div style="display:flex;gap:12px;align-items:flex-start;"><span style="flex:0 0 95px;color:#00f0ff;font-weight:600;letter-spacing:0.02em;">[INNER_MIND]</span><span style="flex:1;color:#d0f0ff;">{{속마음}}</span></div><div style="display:flex;gap:12px;align-items:flex-start;padding-top:4px;"><span style="flex:0 0 95px;color:#00f0ff;font-weight:600;letter-spacing:0.02em;">[SITUATION]</span><span style="flex:1;color:#d0f0ff;text-align:justify;">{{현재상황}}</span></div><div style="display:flex;gap:12px;align-items:flex-start;padding-top:4px;"><span style="flex:0 0 95px;color:#00f0ff;font-weight:600;letter-spacing:0.02em;">[THOUGHTS]</span><span style="flex:1;color:#70a0c0;">{{의식의흐름}}</span></div></div></div>`,
  ),
};

export function cloneStatusWidgetTemplate(
  template: StatusWidget,
): StatusWidget {
  return {
    ...template,
    fields: template.fields.map((field) => ({ ...field })),
  };
}
