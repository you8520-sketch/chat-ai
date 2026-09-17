"use client";

export default function MessageVariantPicker({
  variantCount,
  activeVariant,
  disabled,
  onSelect,
}: {
  variantCount: number;
  activeVariant: number;
  disabled?: boolean;
  onSelect: (index: number) => void;
}) {
  if (variantCount <= 1) return null;

  return (
    <div
      className="flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-zinc-900/70 px-0.5 text-xs leading-none text-zinc-200 shadow-sm backdrop-blur-sm"
      role="navigation"
      aria-label="재생성 버전"
    >
      <button
        type="button"
        disabled={disabled || activeVariant <= 0}
        onClick={() => onSelect(activeVariant - 1)}
        className="flex h-6 min-w-[1.75rem] items-center justify-center rounded-md px-1.5 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="이전 버전"
      >
        ◀
      </button>
      <span className="min-w-[2.75rem] px-0.5 text-center text-[11px] font-medium tabular-nums text-zinc-100">
        {activeVariant + 1} / {variantCount}
      </span>
      <button
        type="button"
        disabled={disabled || activeVariant >= variantCount - 1}
        onClick={() => onSelect(activeVariant + 1)}
        className="flex h-6 min-w-[1.75rem] items-center justify-center rounded-md px-1.5 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
        aria-label="다음 버전"
      >
        ▶
      </button>
    </div>
  );
}
