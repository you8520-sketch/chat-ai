import type { CSSProperties } from "react";

import { splitRevealGraphemes, type RevealRect } from "@/lib/characterReveal";
import {
  TRPG_RESUME_BEATS,
  TRPG_RESUME_SEAM,
  trpgResumeGlyphDelayMs,
  type TrpgResumeLayout,
  type TrpgRoomRef,
} from "@/lib/trpgResumeTransition";

/**
 * Phase D-3 — 최근 활동 TRPG 캠페인 진입 전환의 순수 렌더러.
 * 상태·타이머·navigation은 `MenuTransitionHost`(단일 owner)가 갖고, 여기서는 scene만 그린다.
 * 행에 이미 보이던 D20 문양과 공개 캠페인 제목만 사용한다.
 * 참가자·대화·세계관 원문·비용·비공개 이미지는 그리지 않는다.
 */
export type TrpgResumeScene = {
  room: TrpgRoomRef;
  lines: string[];
  layout: TrpgResumeLayout;
  ink: { x: number; y: number; r0: number; r1: number };
  iris: { tx: number; ty: number; scale: number; r0: number; r1: number; cy: number };
};

const px = (n: number) => `${Math.round(n * 100) / 100}px`;
const ms = (n: number) => `${n}ms`;

function box(rect: RevealRect): CSSProperties {
  return { left: px(rect.left), top: px(rect.top), width: px(rect.width), height: px(rect.height) };
}

function NameAssembly({ lines }: { lines: string[] }) {
  const grouped = lines.map((line) => splitRevealGraphemes(line));
  const total = grouped.reduce((n, g) => n + g.filter((ch) => ch.trim() !== "").length, 0);
  let cursor = 0;
  return (
    <>
      {grouped.map((glyphs, li) => (
        <span key={li} className="tr-name-line">
          {glyphs.map((ch, gi) => {
            if (ch.trim() === "") {
              return (
                <span key={gi} className="tr-g-space">
                  {"\u00a0"}
                </span>
              );
            }
            const k = cursor++;
            return (
              <span
                key={gi}
                className="tr-g"
                style={
                  {
                    "--tr-gy": li % 2 === 0 ? "108%" : "-108%",
                    animationDelay: ms(trpgResumeGlyphDelayMs(k, total)),
                    animationDuration: ms(TRPG_RESUME_BEATS.nameGlyphMs),
                  } as CSSProperties
                }
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

function Crest({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden width={size} height={size} className="tr-crest">
      <path
        d="M12 2.4 20.2 7v10L12 21.6 3.8 17V7L12 2.4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M12 8.2 15.4 10v4L12 15.8 8.6 14v-4L12 8.2Z" fill="currentColor" opacity="0.88" />
    </svg>
  );
}

export default function TrpgResumeScene({
  scene,
  phase,
}: {
  scene: TrpgResumeScene;
  phase: "cover" | "reveal";
}) {
  const { layout, ink, iris } = scene;
  const { frame, nameBox, eyebrow } = layout;
  const style = {
    "--tr-ox": px(ink.x),
    "--tr-oy": px(ink.y),
    "--tr-r0": px(ink.r0),
    "--tr-r1": px(ink.r1),
    "--tr-seam-t": `${TRPG_RESUME_SEAM.top * 100}%`,
    "--tr-seam-b": `${TRPG_RESUME_SEAM.bottom * 100}%`,
    "--tr-ink-ms": ms(TRPG_RESUME_BEATS.inkOpenMs),
    "--tr-line-ms": ms(TRPG_RESUME_BEATS.lineMs),
    "--tr-ring-ms": ms(TRPG_RESUME_BEATS.ringMs),
    "--tr-seam-ms": ms(TRPG_RESUME_BEATS.seamMs),
    "--tr-seam-delay": ms(TRPG_RESUME_BEATS.seamStartMs),
    "--tr-up-ms": ms(TRPG_RESUME_BEATS.splitUpMs),
    "--tr-down-ms": ms(TRPG_RESUME_BEATS.splitDownMs),
    "--tr-down-delay": ms(TRPG_RESUME_BEATS.splitDownDelayMs),
  } as CSSProperties;
  const frameStyle = {
    ...box(frame),
    "--tr-from": `translate3d(${px(iris.tx)}, ${px(iris.ty)}, 0) scale(${iris.scale})`,
    "--tr-pivot": `${px(frame.width / 2)} ${px(frame.height / 2)}`,
    "--tr-iris-r0": px(iris.r0),
    "--tr-iris-r1": px(iris.r1),
    "--tr-iris-cy": px(iris.cy),
    "--tr-frame-delay": ms(TRPG_RESUME_BEATS.frameStartMs),
    "--tr-frame-ms": ms(TRPG_RESUME_BEATS.frameMs),
  } as CSSProperties;

  return (
    <div
      aria-hidden
      data-trpg-resume-veil=""
      data-phase={phase}
      data-campaign-id={scene.room.campaignId}
      data-compact={layout.compact ? "1" : "0"}
      className="tr-veil"
      style={style}
    >
      <div className="tr-ink">
        <div className="tr-panel tr-panel-a">
          <span className="tr-edge" />
          <div className="tr-frame" style={frameStyle}>
            <Crest size={Math.max(36, Math.round(frame.width * 0.46))} />
          </div>
        </div>
        <div className="tr-panel tr-panel-b">
          <span className="tr-edge" />
          <div
            className="tr-eyebrow"
            style={
              {
                left: px(eyebrow.left),
                top: px(eyebrow.top),
                animationDelay: ms(TRPG_RESUME_BEATS.eyebrowStartMs),
                animationDuration: ms(TRPG_RESUME_BEATS.eyebrowMs),
              } as CSSProperties
            }
          >
            <span className="tr-eyebrow-rule" />
            <span className="tr-eyebrow-label">Campaign</span>
          </div>
          <div
            className="tr-name"
            style={{
              left: px(nameBox.left),
              top: px(nameBox.top),
              width: px(nameBox.width),
              fontSize: px(layout.nameFontPx),
            }}
          >
            <NameAssembly lines={scene.lines} />
          </div>
        </div>
      </div>
      <span className="tr-line tr-line-h" />
      <span className="tr-line tr-line-v" />
      <span
        className="tr-ring"
        style={{ left: px(ink.x), top: px(ink.y), width: px(ink.r0 * 2), height: px(ink.r0 * 2) }}
      />
    </div>
  );
}
