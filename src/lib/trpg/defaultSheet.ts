import type { StatusWidget } from "@/lib/statusWidget/types";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";

const STAT_FIELDS = DEFAULT_TRPG_STAT_DEFS.map((d) => ({
  id: d.key,
  label: d.label,
  instruction: d.description,
}));

/** Display-only template. Game state is never parsed back out of this HTML. */
export const DEFAULT_TRPG_SHEET_WIDGET: StatusWidget = {
  version: 1,
  name: "TRPG 시트",
  placement: "bottom",
  fields: [
    { id: "name", label: "이름", instruction: "캐릭터명" },
    { id: "player", label: "플레이어", instruction: "플레이어 표시명" },
    { id: "level", label: "레벨", instruction: "레벨" },
    { id: "hp", label: "HP", instruction: "현재/최대 HP" },
    { id: "location", label: "위치", instruction: "현재 위치" },
    { id: "conditions", label: "상태이상", instruction: "상태이상" },
    { id: "inventory", label: "소지품", instruction: "소지품" },
    { id: "modifiers", label: "보정", instruction: "주사위 보정치" },
    ...STAT_FIELDS,
  ],
  htmlTemplate: `<div class="trpg-sheet" data-trpg-sheet="1">
<p><strong>{{name}}</strong> · {{player}} · Lv {{level}}</p>
<p>HP {{hp}}</p>
<p>힘 {{str}} 민첩 {{dex}} 지능 {{int}} 지혜 {{wis}} 매력 {{cha}} 체력 {{con}}</p>
<p>위치 {{location}}</p>
<p>상태 {{conditions}}</p>
<p>소지 {{inventory}}</p>
<p>보정 {{modifiers}}</p>
</div>`,
};
