import type { CSSProperties } from "react";

import {
  HERO_ITEM_ATTR,
  REVEAL_BEATS,
  REVEAL_FACT_SCATTER,
  REVEAL_ITEM_ATTR,
  revealFactKey,
} from "@/lib/characterReveal";
import { formatRecordFileLabel, type PublicProfileFact } from "@/lib/publicProfileFacts";

/**
 * 공개 기본 인적사항을 얇은 기준선(FILE 번호) + 작은 캡션/값 한 줄로 그리는 인물 기록.
 * 프로필 hero와 reveal 오버레이가 같은 마크업을 쓰므로 조립이 끝났을 때 어긋나지 않는다.
 * 값이 없는 항목은 이미 목록에서 빠져 있고, 목록이 비면 아무것도 그리지 않는다.
 */
export default function CharacterRecord({
  characterId,
  facts,
  variant,
  itemStyle,
}: {
  characterId: number;
  facts: readonly PublicProfileFact[];
  variant: "hero" | "overlay";
  /** overlay 전용: reveal 단계에서 hero 항목으로 이동하는 변수. */
  itemStyle?: (key: string) => CSSProperties | undefined;
}) {
  if (facts.length === 0) return null;
  const overlay = variant === "overlay";
  const itemAttr = overlay ? REVEAL_ITEM_ATTR : HERO_ITEM_ATTR;
  const item = (key: string) => ({ [itemAttr]: key });
  const wrapperClass = overlay ? "rv-item" : "";
  const wrapperStyle = (key: string) => (overlay ? itemStyle?.(key) : undefined);

  return (
    <div className="w-[min(100%,18rem)] md:ml-auto" data-character-record={variant}>
      <div
        {...item("record")}
        className={`${wrapperClass} flex items-center gap-3`}
        style={wrapperStyle("record")}
      >
        <span
          aria-hidden
          className={`h-px flex-1 bg-[#f0e7d4]/30 ${overlay ? "rv-draw" : ""}`}
          style={overlay ? ({ animationDelay: `${REVEAL_BEATS.recordStartMs}ms`, animationDuration: `${REVEAL_BEATS.recordMs}ms` } as CSSProperties) : undefined}
        />
        <span
          className={`text-[10px] font-bold uppercase tracking-[0.22em] text-[#f0e7d4]/55 ${overlay ? "rv-scatter" : ""}`}
          style={
            overlay
              ? ({
                  "--s-x": "14px",
                  "--s-y": "0px",
                  "--s-r": "0deg",
                  animationDelay: `${REVEAL_BEATS.recordStartMs + 120}ms`,
                  animationDuration: `${REVEAL_BEATS.recordMs}ms`,
                } as CSSProperties)
              : undefined
          }
        >
          {formatRecordFileLabel(characterId)}
        </span>
      </div>
      <ul aria-label="공개 기본 정보" className="mt-2.5 flex list-none gap-6 p-0 md:justify-end">
        {facts.map((fact, i) => {
          const key = revealFactKey(fact.key);
          const scatter = REVEAL_FACT_SCATTER[i % REVEAL_FACT_SCATTER.length];
          return (
            <li key={fact.key} {...item(key)} className={wrapperClass} style={wrapperStyle(key)}>
              <div
                className={overlay ? "rv-scatter" : undefined}
                style={
                  overlay
                    ? ({
                        "--s-x": scatter.x,
                        "--s-y": scatter.y,
                        "--s-r": `${scatter.r}deg`,
                        animationDelay: `${REVEAL_BEATS.factStartMs + i * REVEAL_BEATS.factStepMs}ms`,
                        animationDuration: `${REVEAL_BEATS.factMs}ms`,
                      } as CSSProperties)
                    : undefined
                }
              >
                <span className="block text-[10px] font-semibold uppercase leading-4 tracking-[0.18em] text-[#f0e7d4]/50">
                  {fact.label}
                </span>
                <span className="mt-0.5 block text-sm font-semibold leading-5 text-[#f0e7d4]">{fact.value}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
