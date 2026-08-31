"use client";

import { useEffect, useId, useState } from "react";
import { statModifier } from "@/lib/trpg/stats";
import {
  compactConditions,
  formatOngoingBadge,
  hpBarClass,
  inventoryCount,
  mergeDisplayConditions,
  selfHudAriaLabel,
} from "@/lib/trpg/sheetHud";
import type { TrpgSheetHudCard } from "@/lib/trpg/sheetView";
import type { TrpgStatDefinition } from "@/lib/trpg/types";
import type { TrpgMechanicsHudLine, TrpgPublicOngoingEffect } from "@/lib/trpg/snapshot";

function HpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const safeMax = Math.max(maxHp, 1);
  const hpPct = Math.max(0, Math.min(100, Math.round((hp / safeMax) * 100)));
  return (
    <div
      className="h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={hp}
      aria-label={`HP ${hp}/${maxHp}`}
    >
      <div className={`h-full rounded-full ${hpBarClass(hp, maxHp)}`} style={{ width: `${hpPct}%` }} />
    </div>
  );
}

function ConditionBadges({
  conditions,
  effects = [],
}: {
  conditions: string[];
  effects?: TrpgPublicOngoingEffect[];
}) {
  const badges = [
    ...conditions.map((item) => ({ key: `n:${item}`, label: item, title: item })),
    ...effects.map((effect) => ({
      key: `e:${effect.label}:${effect.severity}`,
      label: formatOngoingBadge(effect),
      title: effect.recoveryHint,
    })),
  ];
  if (badges.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1">
      {badges.map((item) => (
        <li
          key={item.key}
          title={item.title}
          className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-100"
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function ExpandedSheet({
  card,
  statDefs,
  ongoingEffects,
  mechanicsLines,
}: {
  card: TrpgSheetHudCard;
  statDefs: TrpgStatDefinition[];
  ongoingEffects: TrpgPublicOngoingEffect[];
  mechanicsLines: string[];
}) {
  const sheet = card.sheet;
  const inventory = sheet.inventory.filter((item) => item.trim());
  const conditions = sheet.conditions.filter((item) => item.trim());
  return (
    <div className="space-y-3 text-sm text-zinc-200">
      <div>
        <p className="text-xs text-zinc-500">능력치</p>
        <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
          {statDefs.map((def) => {
            const value = sheet.stats[def.key];
            const n = typeof value === "number" ? value : 5;
            const mod = statModifier(n);
            return (
              <li key={def.key} className="tabular-nums text-zinc-300">
                {def.label} {n}
                <span className="text-zinc-500">({mod >= 0 ? `+${mod}` : String(mod)})</span>
              </li>
            );
          })}
        </ul>
      </div>
      {sheet.modifiersNote.trim() ? (
        <p className="text-xs text-zinc-400">
          <span className="text-zinc-500">보정 </span>
          {sheet.modifiersNote}
        </p>
      ) : null}
      {mechanicsLines.length > 0 ? (
        <div data-trpg-mechanics-lines>
          <p className="text-xs text-zinc-500">판정 결과</p>
          <ul className="mt-1 space-y-0.5 text-xs tabular-nums text-zinc-300">
            {mechanicsLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="text-xs text-zinc-500">상태</p>
        {conditions.length > 0 || ongoingEffects.length > 0 ? (
          <div className="mt-1">
            <ConditionBadges conditions={conditions} effects={ongoingEffects} />
          </div>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">없음</p>
        )}
      </div>
      <div>
        <p className="text-xs text-zinc-500">소지품</p>
        {inventory.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-1">
            {inventory.map((item) => (
              <li
                key={item}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-200"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">없음</p>
        )}
      </div>
    </div>
  );
}

export default function TrpgSelfSheetHud({
  card,
  statDefs,
  ongoingEffects = [],
  mechanicsLines = [],
}: {
  card: TrpgSheetHudCard;
  statDefs: TrpgStatDefinition[];
  ongoingEffects?: TrpgPublicOngoingEffect[];
  mechanicsLines?: TrpgMechanicsHudLine[];
}) {
  const sheet = card.sheet;
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const inventory = sheet.inventory.filter((item) => item.trim());
  const selfEffects = ongoingEffects.filter((effect) => effect.participantId === sheet.participantId);
  const selfLines = mechanicsLines.filter((line) => line.participantId === sheet.participantId).map((line) => line.text);
  const narrativeConditions = sheet.conditions.filter((item) => item.trim());
  const conditions = mergeDisplayConditions(
    narrativeConditions,
    selfEffects.map((effect) => effect.label)
  );
  const compactCondition = compactConditions(conditions, 1)[0];
  const itemCount = inventoryCount(inventory);
  const label = selfHudAriaLabel(sheet);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <section
      aria-label={label}
      className="sticky bottom-0 z-30 mt-3 border-t border-white/10 bg-[#101010]/95 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur-md"
    >
      <div className="hidden md:block">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-violet-200">{sheet.name}</p>
          <div className="flex min-w-[9rem] flex-1 items-center gap-2 sm:max-w-xs sm:flex-none">
            <p className="shrink-0 text-xs tabular-nums text-zinc-300">
              HP {sheet.hp}/{sheet.maxHp}
            </p>
            <HpBar hp={sheet.hp} maxHp={sheet.maxHp} />
          </div>
          {selfLines[0] ? (
            <p className="text-xs tabular-nums text-zinc-400" data-trpg-mechanics-summary>
              {selfLines[0]}
              {selfLines[1] ? ` · ${selfLines[1]}` : ""}
            </p>
          ) : null}
          {sheet.location.trim() ? (
            <p className="text-xs text-zinc-400">{sheet.location.trim()}</p>
          ) : null}
          <ConditionBadges conditions={narrativeConditions.slice(0, 2)} effects={selfEffects.slice(0, 2)} />
          <p
            className="text-xs text-zinc-400"
            aria-label={`소지품 ${itemCount}개`}
            title={`현재 소지품 ${itemCount}개`}
            data-trpg-inventory-count={itemCount}
          >
            소지품 {itemCount}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="ml-auto inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5"
            aria-expanded={expanded}
            aria-controls={panelId}
          >
            {expanded ? "접기" : "자세히"}
          </button>
        </div>
        {expanded ? (
          <div id={panelId} className="mt-3 border-t border-white/5 pt-3">
            <ExpandedSheet
              card={card}
              statDefs={statDefs}
              ongoingEffects={selfEffects}
              mechanicsLines={selfLines}
            />
          </div>
        ) : null}
      </div>

      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-h-11 w-full items-center gap-2 text-left text-xs text-zinc-200"
          aria-expanded={expanded}
          aria-controls={`${panelId}-sheet`}
        >
          <span className="tabular-nums font-semibold">
            HP {sheet.hp}/{sheet.maxHp}
          </span>
          <span className="text-zinc-600" aria-hidden>
            |
          </span>
          <span className="truncate text-amber-100">{compactCondition || "상태 없음"}</span>
          <span className="text-zinc-600" aria-hidden>
            |
          </span>
          <span aria-label={`소지품 ${itemCount}개`} title={`현재 소지품 ${itemCount}개`}>
            소지품 {itemCount}
          </span>
          <span className="ml-auto text-zinc-400" aria-hidden>
            ↑
          </span>
        </button>
      </div>

      {expanded ? (
        <div className="md:hidden">
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/55"
            aria-label="시트 닫기"
            onClick={() => setExpanded(false)}
          />
          <div
            id={`${panelId}-sheet`}
            role="dialog"
            aria-modal="true"
            aria-label={`${sheet.name} 시트`}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-2xl border border-white/10 bg-[#121212] px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-violet-200">{sheet.name}</p>
                <p className="mt-1 text-xs tabular-nums text-zinc-300">
                  HP {sheet.hp}/{sheet.maxHp}
                </p>
                {sheet.location.trim() ? (
                  <p className="mt-0.5 text-xs text-zinc-400">{sheet.location.trim()}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/10 text-sm text-zinc-200"
              >
                닫기
              </button>
            </div>
            <div className="mb-3">
              <HpBar hp={sheet.hp} maxHp={sheet.maxHp} />
            </div>
            <ExpandedSheet
              card={card}
              statDefs={statDefs}
              ongoingEffects={selfEffects}
              mechanicsLines={selfLines}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
