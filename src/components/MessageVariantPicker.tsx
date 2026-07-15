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
    <div className="flex h-4 items-center gap-0.5 rounded-md bg-black/35 text-[9px] leading-none text-zinc-400 backdrop-blur-sm">
      <button
        type="button"
        disabled={disabled || activeVariant <= 0}
        onClick={() => onSelect(activeVariant - 1)}
        className="h-4 rounded px-1 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="이전 버전"
      >
        ◀
      </button>
      <span className="min-w-[2.25rem] text-center tabular-nums">
        {activeVariant + 1} / {variantCount}
      </span>
      <button
        type="button"
        disabled={disabled || activeVariant >= variantCount - 1}
        onClick={() => onSelect(activeVariant + 1)}
        className="h-4 rounded px-1 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="다음 버전"
      >
        ▶
      </button>
    </div>
  );
}
