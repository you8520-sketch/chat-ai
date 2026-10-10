import type { CSSProperties } from "react";

import CharacterRecord from "@/components/CharacterRecord";
import {
  REVEAL_BEATS,
  REVEAL_FIT_ATTR,
  REVEAL_ITEM_ATTR,
  REVEAL_TAG_SCATTER,
  revealGlyphDelayMs,
  revealGlyphMotion,
  revealGlyphRanks,
  revealTagKey,
  splitRevealGraphemes,
  type RevealLayout,
} from "@/lib/characterReveal";
import type { PublicProfileFact } from "@/lib/publicProfileFacts";
import { studioSurface } from "@/lib/studioDesign";

/**
 * Phase D-1 — 캐릭터 kinetic assembly의 순수 렌더러.
 * 상태·타이머·navigation은 `MenuTransitionHost`(단일 owner)가 갖고, 여기서는 scene만 그린다.
 * 접근 가능한 카드에서 클릭 시점에 이미 보이던 공개 이미지·이름·장르·한 줄 소개·키워드·공개 인적사항만 사용한다.
 */
export type RevealItemTarget = { tx: number; ty: number; scale: number };

export type CharacterScene = {
  id: number;
  src: string;
  lines: string[];
  genre: string;
  tagline: string;
  tags: string[];
  facts: PublicProfileFact[];
  layout: RevealLayout;
  /** 카드 이미지 위치에서 시작하는 FLIP + 잘림(clip) 보정. */
  start: { tx: number; ty: number; scale: number; clip: { top: number; right: number; bottom: number; left: number } };
  /** 클릭한 카드의 보이는 영역 — 배경 잉크 마스크가 여기서 열린다 (뷰포트 가장자리까지의 px 거리). */
  card: { top: number; right: number; bottom: number; left: number };
  /** reveal 시 프로필 hero 이미지 프레임으로 안착할 목표. 없으면 부드럽게 사라진다. */
  hero: { tx: number; ty: number; scale: number; src: string } | null;
  /** reveal 시 각 요소가 hero의 같은 요소 위치로 이동하는 양. 없는 키는 그 자리에서 사라진다. */
  items: Record<string, RevealItemTarget>;
};

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function itemStyle(scene: CharacterScene, key: string): CSSProperties | undefined {
  const to = scene.items[key];
  if (!to) return undefined;
  return {
    "--rv-itx": px(to.tx),
    "--rv-ity": px(to.ty),
    "--rv-isc": String(Math.round(to.scale * 1000) / 1000),
  } as CSSProperties;
}

function entry(delayMs: number, durationMs: number, vars?: Record<string, string>): CSSProperties {
  return { ...vars, animationDelay: `${delayMs}ms`, animationDuration: `${durationMs}ms` } as CSSProperties;
}

/** 줄 단위 마스크 안에서 글자(grapheme)마다 다른 방향·순서로 들어와 하나의 이름으로 결합한다. */
function NameAssembly({ lines }: { lines: string[] }) {
  const grouped = lines.map((line) => splitRevealGraphemes(line));
  const total = grouped.reduce((n, g) => n + g.filter((ch) => ch.trim() !== "").length, 0);
  const ranks = revealGlyphRanks(total);
  let cursor = 0;
  return (
    <>
      {grouped.map((glyphs, li) => (
        <span key={li} className="rv-name-line">
          {glyphs.map((ch, gi) => {
            if (ch.trim() === "") {
              return (
                <span key={gi} className="rv-g-space">
                  {"\u00a0"}
                </span>
              );
            }
            const k = cursor++;
            const m = revealGlyphMotion(k);
            return (
              <span
                key={gi}
                className="rv-g"
                style={entry(revealGlyphDelayMs(ranks[k], total), REVEAL_BEATS.nameGlyphMs, {
                  "--g-x": `${m.x}em`,
                  "--g-y": `${m.y}%`,
                  "--g-r": `${m.r}deg`,
                })}
              >
                {ch}
              </span>
            );
          })}
        </span>
      ))}
    </>
  );
}

export default function CharacterRevealScene({
  scene,
  phase,
}: {
  scene: CharacterScene;
  phase: "cover" | "reveal";
}) {
  const { layout, start, hero, card } = scene;
  const { frame, nameBox, info, compact } = layout;
  const clip = start.clip;
  const style = {
    "--rv-frame-l": px(frame.left),
    "--rv-frame-t": px(frame.top),
    "--rv-frame-w": px(frame.width),
    "--rv-frame-h": px(frame.height),
    "--rv-from": `translate3d(${px(start.tx)}, ${px(start.ty)}, 0) scale(${start.scale})`,
    "--rv-ct": px(clip.top),
    "--rv-cr": px(clip.right),
    "--rv-cb": px(clip.bottom),
    "--rv-cl": px(clip.left),
    "--rv-ink-from": `inset(${px(card.top)} ${px(card.right)} ${px(card.bottom)} ${px(card.left)} round 14px)`,
    "--rv-to": hero ? `translate3d(${px(hero.tx)}, ${px(hero.ty)}, 0) scale(${hero.scale})` : "none",
    "--rv-fly-ms": `${REVEAL_BEATS.frameFlyMs}ms`,
    "--rv-open-ms": `${REVEAL_BEATS.inkOpenMs}ms`,
    "--rv-drift-ms": `${REVEAL_BEATS.imageDriftMs}ms`,
  } as CSSProperties;
  const swapImage = Boolean(hero?.src && hero.src !== scene.src);
  const align = compact ? "start" : "end";
  const column = (top: number) =>
    ({
      left: px(info.left),
      width: px(info.width),
      top: px(top),
      alignItems: compact ? "flex-start" : "flex-end",
      textAlign: compact ? "left" : "right",
    }) as CSSProperties;
  const hasSub = Boolean(scene.tagline) || scene.tags.length > 0;

  return (
    <div
      aria-hidden
      data-phase={phase}
      data-compact={compact ? "1" : "0"}
      data-hero={hero ? "1" : "0"}
      data-character-reveal={scene.id}
      className="rv-veil"
      style={style}
    >
      <div className="rv-ink" />
      <div className="rv-glow" />

      <div
        className="rv-rule"
        style={{ left: px(frame.left - 22), top: px(frame.top - 18), height: px(frame.height + 36) }}
      />

      <div
        className="rv-name"
        style={{
          left: px(nameBox.left),
          top: px(nameBox.top),
          width: px(nameBox.width),
          fontSize: px(layout.nameFontPx),
          alignItems: compact ? "flex-start" : "flex-end",
          textAlign: compact ? "left" : "right",
        }}
      >
        <div
          className="rv-item rv-name-block"
          {...{ [REVEAL_ITEM_ATTR]: "name", [REVEAL_FIT_ATTR]: "width" }}
          style={itemStyle(scene, "name")}
        >
          <NameAssembly lines={scene.lines} />
        </div>
      </div>

      <div className="rv-frame" style={{ left: px(frame.left), top: px(frame.top), width: px(frame.width), height: px(frame.height) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="rv-img" src={scene.src} alt="" draggable={false} />
        {swapImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rv-img rv-img-hero" src={hero!.src} alt="" draggable={false} />
        ) : null}
        <span className="rv-frame-edge" />
      </div>

      <div className="rv-info" data-align={align} style={column(info.eyebrowTop)}>
        <div className="rv-item" {...{ [REVEAL_ITEM_ATTR]: "eyebrow" }} style={itemStyle(scene, "eyebrow")}>
          <div className="rv-eyebrow">
            {scene.genre ? (
              <span
                className="rv-eyebrow-genre rv-scatter"
                style={entry(REVEAL_BEATS.eyebrowStartMs, REVEAL_BEATS.eyebrowMs, { "--s-x": "-18px", "--s-y": "0px", "--s-r": "0deg" })}
              >
                {scene.genre}
              </span>
            ) : null}
            <span aria-hidden className="rv-eyebrow-rule rv-draw" style={entry(REVEAL_BEATS.eyebrowStartMs + 60, REVEAL_BEATS.eyebrowMs)} />
            <span
              className="rv-eyebrow-label rv-scatter"
              style={entry(REVEAL_BEATS.eyebrowStartMs + 120, REVEAL_BEATS.eyebrowMs, { "--s-x": "18px", "--s-y": "0px", "--s-r": "0deg" })}
            >
              Character
            </span>
          </div>
        </div>
      </div>

      {scene.facts.length > 0 ? (
        <div className="rv-info" data-align={align} style={column(info.factsTop)}>
          <CharacterRecord characterId={scene.id} facts={scene.facts} variant="overlay" itemStyle={(key) => itemStyle(scene, key)} />
        </div>
      ) : null}

      {hasSub ? (
        <div className="rv-info rv-info-sub" data-align={align} style={column(info.subTop)}>
          {scene.tagline ? (
            <div className="rv-item" {...{ [REVEAL_ITEM_ATTR]: "tagline" }} style={itemStyle(scene, "tagline")}>
              <p className="rv-tagline rv-wipe" style={entry(REVEAL_BEATS.taglineStartMs, REVEAL_BEATS.taglineMs)}>
                {scene.tagline}
              </p>
            </div>
          ) : null}
          {scene.tags.length > 0 ? (
            <div className="rv-tags">
              {scene.tags.map((t, i) => {
                const key = revealTagKey(i);
                const sc = REVEAL_TAG_SCATTER[i % REVEAL_TAG_SCATTER.length];
                return (
                  <div key={t} className="rv-item" {...{ [REVEAL_ITEM_ATTR]: key }} style={itemStyle(scene, key)}>
                    <span
                      className={`${studioSurface.chip} rv-scatter`}
                      style={entry(REVEAL_BEATS.tagStartMs + i * REVEAL_BEATS.tagStepMs, REVEAL_BEATS.tagMs, {
                        "--s-x": sc.x,
                        "--s-y": sc.y,
                        "--s-r": `${sc.r}deg`,
                      })}
                    >
                      #{t}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
