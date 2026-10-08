import type { CSSProperties } from "react";

import type { RevealLayout } from "@/lib/characterReveal";

/**
 * Phase D-1 — 캐릭터 artwork reveal의 순수 렌더러.
 * 상태·타이머·navigation은 `MenuTransitionHost`(단일 owner)가 갖고, 여기서는 scene만 그린다.
 * 접근 가능한 카드에서 클릭 시점에 이미 보이던 공개 이미지·이름만 사용한다.
 */
export type CharacterScene = {
  id: number;
  src: string;
  lines: string[];
  genre: string;
  creator: string;
  layout: RevealLayout;
  /** 카드 이미지 위치에서 시작하는 FLIP + 잘림(clip) 보정. */
  start: { tx: number; ty: number; scale: number; clip: { top: number; right: number; bottom: number; left: number } };
  /** reveal 시 프로필 hero 이미지 프레임으로 안착할 목표. 없으면 부드럽게 사라진다. */
  hero: { tx: number; ty: number; scale: number; src: string } | null;
};

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

export default function CharacterRevealScene({
  scene,
  phase,
}: {
  scene: CharacterScene;
  phase: "cover" | "reveal";
}) {
  const { layout, start, hero } = scene;
  const { frame, nameBox, metaBox, compact } = layout;
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
    "--rv-to": hero ? `translate3d(${px(hero.tx)}, ${px(hero.ty)}, 0) scale(${hero.scale})` : "none",
    "--rv-name-size": px(layout.nameFontPx),
  } as CSSProperties;
  const swapImage = Boolean(hero?.src && hero.src !== scene.src);

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
        className="rv-rule rv-rule-v"
        style={{ left: px(frame.left - 22), top: px(frame.top - 18), height: px(frame.height + 36) }}
      />
      {compact ? null : (
        <div
          className="rv-rule rv-rule-h"
          style={{ left: px(metaBox.left), top: px(frame.top + frame.height + 18), width: px(frame.left + frame.width * 0.3 - metaBox.left) }}
        />
      )}

      <div
        className="rv-name"
        style={{ left: px(nameBox.left), top: px(nameBox.top), width: px(nameBox.width), fontSize: px(layout.nameFontPx), textAlign: compact ? "left" : "right" }}
      >
        {scene.lines.map((line, i) => (
          <span key={i} className="rv-name-line" style={{ animationDelay: `${260 + i * 90}ms` }}>
            <span className="rv-name-text" style={{ animationDelay: `${260 + i * 90}ms` }}>
              {line}
            </span>
          </span>
        ))}
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

      <div
        className="rv-meta"
        style={{ left: px(metaBox.left), top: px(metaBox.top), width: px(metaBox.width) }}
      >
        {scene.genre ? <span className="rv-meta-genre">{scene.genre}</span> : null}
        {scene.creator ? <span className="rv-meta-by">by {scene.creator}</span> : null}
      </div>
    </div>
  );
}
