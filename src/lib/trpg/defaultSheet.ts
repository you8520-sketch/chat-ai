import type { StatusWidget } from "@/lib/statusWidget/types";
import { DEFAULT_TRPG_STAT_DEFS } from "./stats";
import type { TrpgStatDefinition } from "./types";

export function buildTrpgSheetWidget(defs: readonly TrpgStatDefinition[] = DEFAULT_TRPG_STAT_DEFS): StatusWidget {
  const used = defs.length > 0 ? defs : DEFAULT_TRPG_STAT_DEFS;
  const statLine = used.map((d) => `${d.label} {{${d.key}}}`).join(" ");
  return {
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
      ...used.map((d) => ({ id: d.key, label: d.label, instruction: d.description })),
    ],
    htmlTemplate: `<div class="trpg-sheet" data-trpg-sheet="1">
<p><strong>{{name}}</strong> · {{player}} · Lv {{level}}</p>
<p>HP {{hp}}</p>
<p>${statLine}</p>
<p>위치 {{location}}</p>
<p>상태 {{conditions}}</p>
<p>소지 {{inventory}}</p>
<p>보정 {{modifiers}}</p>
</div>`,
  };
}

/** Display-only template. Game state is never parsed back out of this HTML. */
export const DEFAULT_TRPG_SHEET_WIDGET: StatusWidget = buildTrpgSheetWidget();
