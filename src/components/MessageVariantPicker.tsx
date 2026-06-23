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
    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
      <button
        type="button"
        disabled={disabled || activeVariant <= 0}
        onClick={() => onSelect(activeVariant - 1)}
        className="rounded px-2 py-0.5 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="이전 버전"
      >
        ◀
      </button>
      <span className="min-w-[3rem] text-center tabular-nums">
        {activeVariant + 1} / {variantCount}
      </span>
      <button
        type="button"
        disabled={disabled || activeVariant >= variantCount - 1}
        onClick={() => onSelect(activeVariant + 1)}
        className="rounded px-2 py-0.5 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="다음 버전"
      >
        ▶
      </button>
    </div>
  );
}
