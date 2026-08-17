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
      <div className="mb-2 flex items-baseline gap-2 sm:hidden" data-trpg-roll-result="mobile">
        <span className={`text-[28px] font-extrabold leading-none tabular-nums ${numberClass}`}>{d20}</span>
        <span className={`text-[12px] font-semibold ${outcomeClass}`}>{outcome}</span>
        {compactName ? (
          <span className="min-w-0 truncate text-[12px] text-zinc-500">· {compactName}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="hidden w-20 shrink-0 flex-col font-sans sm:flex"
      data-trpg-roll-result="desktop"
    >
      <p className={`text-[36px] font-extrabold leading-none tabular-nums ${numberClass}`}>{d20}</p>
      <p className={`mt-1 text-[12px] font-semibold ${outcomeClass}`}>{outcome}</p>
    </div>
  );
}
