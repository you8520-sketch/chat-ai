"use client";

import {
  resolveTrpgD20Tone,
  trpgActionCardCompactName,
  trpgRollOutcomeLabel,
} from "@/lib/trpg/actionCardUi";
import type { TrpgSuccessTier } from "@/lib/trpg/types";
import TrpgRollResultLane from "../TrpgRollResultLane";

const FIXTURES: Array<{ name: string; kind: "human" | "ai_character"; d20: number; tier: TrpgSuccessTier }> = [
  { name: "강이현", kind: "ai_character", d20: 15, tier: "SUCCESS" },
  { name: "권태현", kind: "human", d20: 6, tier: "FAILURE" },
  { name: "강이현", kind: "ai_character", d20: 16, tier: "SUCCESS" },
  { name: "권태현", kind: "human", d20: 2, tier: "FAILURE" },
];

export default function TrpgResultLabClient() {
  return (
    <div className="min-h-[100dvh] bg-[#07080c] px-4 py-6 text-zinc-100">
      <h1 className="text-lg font-semibold">TRPG action-card result lane</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Static D20 SVG is gone. Large numeric result only. Production overlay stays Prototype A.
      </p>
      <div className="mt-5 space-y-4">
        {FIXTURES.map((row) => {
          const tone = resolveTrpgD20Tone(row.d20, row.tier);
          const outcome = trpgRollOutcomeLabel(row.tier);
          const compactName = trpgActionCardCompactName(row.name, row.kind);
          return (
            <article
              key={`${row.d20}-${row.tier}-${row.name}`}
              className="rounded-xl border border-white/10 bg-[#131626] p-4 sm:p-5"
              data-trpg-action-card
            >
              <TrpgRollResultLane
                layout="mobile"
                d20={row.d20}
                tone={tone}
                outcome={outcome}
                compactName={compactName}
              />
              <div className="flex items-start gap-3">
                <TrpgRollResultLane layout="desktop" d20={row.d20} tone={tone} outcome={outcome} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-200">
                    {row.name}
                    {row.kind === "ai_character" ? (
                      <span className="ml-1.5 text-[10px] font-medium text-orange-300/80">AI</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-300">
                    본문 가로폭을 확보한 상태의 예시 문장입니다.
                  </p>
                  <p className="mt-1.5 text-[11px] font-medium text-zinc-500">GM 판정용</p>
                  <p className="text-[11px] tabular-nums text-zinc-500">
                    지능 · d20 {row.d20} + 0 = {row.d20} vs DC 12 · {outcome}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
