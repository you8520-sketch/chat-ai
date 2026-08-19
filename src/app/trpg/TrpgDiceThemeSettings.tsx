"use client";

import { TRPG_D20_THEME_OPTIONS, saveTrpgDiceTheme } from "@/lib/trpg/diceThemePrefs";
import { trpgD20StaticOverlaySpec, type TrpgD20ThemeId } from "@/lib/trpg/diceVisual";

export default function TrpgDiceThemeSettings({
  theme,
  onThemeChange,
}: {
  theme: TrpgD20ThemeId;
  onThemeChange: (theme: TrpgD20ThemeId) => void;
}) {
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <p className="mb-2 text-xs font-medium text-zinc-200">주사위 결과 테마</p>
      <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
        굴림 연출은 동일하고, 결과 D20 디자인만 바뀝니다.
      </p>
      <div className="space-y-2">
        {TRPG_D20_THEME_OPTIONS.map((option) => {
          const active = theme === option.id;
          const overlay = trpgD20StaticOverlaySpec(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                saveTrpgDiceTheme(option.id);
                onThemeChange(option.id);
              }}
              className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                active
                  ? "border-violet-400/40 bg-violet-500/10"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
              }`}
            >
              <div className="relative mt-0.5 h-11 w-11 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={overlay.baseAsset}
                  alt=""
                  className="h-11 w-11 object-contain opacity-90"
                  draggable={false}
                />
                <span
                  className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold"
                  style={{
                    color: overlay.numeral.colors.normal,
                    fontFamily: overlay.numeral.fontFamily,
                    textShadow: overlay.numeral.textShadow,
                  }}
                >
                  20
                </span>
              </div>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-100">{option.label}</span>
                <span className="mt-0.5 block text-[11px] text-zinc-500">{option.hint}</span>
                {!option.productionReady ? (
                  <span className="mt-1 inline-block rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200/90">
                    팔레트만 · 바디 에셋 준비 중
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
