"use client";

import { statModifier } from "@/lib/trpg/stats";
import type { TrpgSheetHudCard } from "@/lib/trpg/sheetView";
import type { TrpgStatDefinition } from "@/lib/trpg/types";

function hpBarClass(hp: number, maxHp: number): string {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio > 0.5) return "bg-emerald-400";
  if (ratio > 0.25) return "bg-amber-400";
  return "bg-rose-400";
}

export default function TrpgSelfSheetHud({
  card,
  statDefs,
}: {
  card: TrpgSheetHudCard;
  statDefs: TrpgStatDefinition[];
}) {
  const sheet = card.sheet;
  const maxHp = Math.max(sheet.maxHp, 1);
  const hpPct = Math.max(0, Math.min(100, Math.round((sheet.hp / maxHp) * 100)));
  const inventory = sheet.inventory.filter((item) => item.trim());
  const conditions = sheet.conditions.filter((item) => item.trim());

  return (
    <section
      aria-label="내 캐릭터 시트"
      className="sticky bottom-0 z-30 mt-3 border-t border-white/10 bg-[#101010]/95 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-md"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-violet-200">{sheet.name}</p>
        <div className="flex min-w-[9rem] flex-1 items-center gap-2 sm:max-w-xs sm:flex-none">
          <p className="shrink-0 text-xs tabular-nums text-zinc-300">
            HP {sheet.hp}/{sheet.maxHp}
          </p>
          <div className="h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full ${hpBarClass(sheet.hp, sheet.maxHp)}`} style={{ width: `${hpPct}%` }} />
          </div>
        </div>
        {sheet.location.trim() ? (
          <p className="text-xs text-zinc-500">{sheet.location.trim()}</p>
        ) : null}
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] leading-relaxed text-zinc-400">
        {statDefs.map((def) => {
          const value = sheet.stats[def.key];
          const n = typeof value === "number" ? value : 5;
          const mod = statModifier(n);
          return (
            <span key={def.key} className="tabular-nums">
              {def.label} {n}
              <span className="text-zinc-600">({mod >= 0 ? `+${mod}` : String(mod)})</span>
            </span>
          );
        })}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
        <span className="text-zinc-500">소지 </span>
        {inventory.length > 0 ? inventory.join(" · ") : "없음"}
      </p>
      {conditions.length > 0 ? (
        <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/80">
          <span className="text-zinc-500">상태 </span>
          {conditions.join(" · ")}
        </p>
      ) : null}
    </section>
  );
}
