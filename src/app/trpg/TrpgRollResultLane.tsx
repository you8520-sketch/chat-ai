import {
  trpgRollResultNumberClass,
  trpgRollResultOutcomeClass,
  type TrpgD20Tone,
} from "@/lib/trpg/actionCardUi";

export default function TrpgRollResultLane({
  d20,
  tone,
  outcome,
  layout,
  compactName,
}: {
  d20: number;
  tone: TrpgD20Tone;
  outcome: "성공" | "실패";
  layout: "desktop" | "mobile";
  compactName?: string;
}) {
  const numberClass = trpgRollResultNumberClass(tone);
  const outcomeClass = trpgRollResultOutcomeClass(tone);

  if (layout === "mobile") {
    return (
      <div
        className="mb-3 flex min-h-12 items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2 sm:hidden"
        data-trpg-roll-result="mobile"
      >
        {compactName ? (
          <span className="min-w-0 truncate text-[13px] font-bold text-zinc-200">{compactName}</span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-baseline gap-2">
          <span className={`text-[28px] font-extrabold leading-none tabular-nums ${numberClass}`}>{d20}</span>
          <span className={`text-[12px] font-semibold ${outcomeClass}`}>{outcome}</span>
        </span>
      </div>
    );
  }

  return (
    <div
      className="hidden h-[72px] w-[72px] shrink-0 flex-col justify-center font-sans sm:flex"
      data-trpg-roll-result="desktop"
    >
      <p className={`text-[34px] font-extrabold leading-none tabular-nums ${numberClass}`}>{d20}</p>
      <p className={`mt-1 text-[12px] font-semibold ${outcomeClass}`}>{outcome}</p>
    </div>
  );
}
