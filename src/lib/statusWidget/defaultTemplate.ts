import type { StatusWidget } from "./types";

/** 제작 페이지 기본 템플릿 — 에쉬(id=17) 저장 위젯과 동일 */
export const DEFAULT_STATUS_WIDGET: StatusWidget = {
  version: 1,
  name: "기본 상태창",
  placement: "bottom",
  fields: [
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
  ],
  htmlTemplate: `<div style="max-width:550px;margin:12px auto;padding:16px 18px;border-radius:12px;background:#050505;border:1px solid #181818;font-family:sans-serif;color:#e8e8e8;line-height:1.5;word-break:keep-all;">
  
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #222;">
    <span style="font-size:13px;font-weight:700;color:#d4af37;letter-spacing:0.05em;">◆ 상태창 ◆</span>
    <span style="font-size:11px;color:#cfcfcf;">{{시간}} · {{장소}}</span>
  </div>

  <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">

    <div style="display:flex;gap:10px;">
      <span style="flex:0 0 72px;color:#cfcfcf;font-weight:600;">속마음</span>
      <span style="flex:1;color:#ddd;">{{속마음}}</span>
    </div>

    <div style="display:flex;gap:10px;">
      <span style="flex:0 0 72px;color:#cfcfcf;font-weight:600;">현재상황</span>
      <span style="flex:1;color:#ddd;">{{현재상황}}</span>
    </div>

    <div style="display:flex;gap:10px;">
      <span style="flex:0 0 72px;color:#cfcfcf;font-weight:600;">의식의 흐름</span>
      <span style="flex:1;color:#ddd;">{{의식의흐름}}</span>
    </div>

  </div>

</div>`,
};
