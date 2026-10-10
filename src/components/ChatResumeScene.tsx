import type { CSSProperties } from "react";

import { splitRevealGraphemes, type RevealRect } from "@/lib/characterReveal";
import {
  CHAT_RESUME_BEATS,
  CHAT_RESUME_SEAM,
  chatResumeGlyphDelayMs,
  type ChatResumeLayout,
  type ChatRoomRef,
} from "@/lib/chatResumeTransition";

/**
 * Phase D-2 — 최근 활동 채팅방 진입 전환의 순수 렌더러.
 * 상태·타이머·navigation은 `MenuTransitionHost`(단일 owner)가 갖고, 여기서는 scene만 그린다.
 * 행에 이미 보이던 공개 썸네일과 캐릭터 이름만 사용한다. 마지막 메시지·설정·대화 내용은 그리지 않는다.
 */
export type ChatResumeScene = {
  room: ChatRoomRef;
  /** 행에 이미 로드된 공개 썸네일. 없거나 실패했으면 null. */
  src: string | null;
  /** 썸네일이 없을 때 행이 보여주던 배경색·이모지. */
  fill: string | null;
  glyph: string;
  lines: string[];
  layout: ChatResumeLayout;
  /** 클릭한 썸네일 원의 중심(뷰포트 px)과 잉크 마스크 반지름. */
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
        <span key={li} className="cr-name-line">
          {glyphs.map((ch, gi) => {
            if (ch.trim() === "") {
              return (
                <span key={gi} className="cr-g-space">
                  {"\u00a0"}
                </span>
              );
            }
            const k = cursor++;
            return (
              <span
                key={gi}
                className="cr-g"
                style={
                  {
                    "--cr-gy": li % 2 === 0 ? "108%" : "-108%",
                    animationDelay: ms(chatResumeGlyphDelayMs(k, total)),
                    animationDuration: ms(CHAT_RESUME_BEATS.nameGlyphMs),
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

export default function ChatResumeScene({
  scene,
  phase,
}: {
  scene: ChatResumeScene;
  phase: "cover" | "reveal";
}) {
  const { layout, ink, iris } = scene;
  const { frame, nameBox, eyebrow } = layout;
  const style = {
    "--cr-ox": px(ink.x),
    "--cr-oy": px(ink.y),
    "--cr-r0": px(ink.r0),
    "--cr-r1": px(ink.r1),
    "--cr-seam-t": `${CHAT_RESUME_SEAM.top * 100}%`,
    "--cr-seam-b": `${CHAT_RESUME_SEAM.bottom * 100}%`,
    "--cr-ink-ms": ms(CHAT_RESUME_BEATS.inkOpenMs),
    "--cr-line-ms": ms(CHAT_RESUME_BEATS.lineMs),
    "--cr-ring-ms": ms(CHAT_RESUME_BEATS.ringMs),
    "--cr-seam-ms": ms(CHAT_RESUME_BEATS.seamMs),
    "--cr-seam-delay": ms(CHAT_RESUME_BEATS.seamStartMs),
    "--cr-up-ms": ms(CHAT_RESUME_BEATS.splitUpMs),
    "--cr-down-ms": ms(CHAT_RESUME_BEATS.splitDownMs),
    "--cr-down-delay": ms(CHAT_RESUME_BEATS.splitDownDelayMs),
  } as CSSProperties;
  const frameStyle = {
    ...box(frame),
    "--cr-from": `translate3d(${px(iris.tx)}, ${px(iris.ty)}, 0) scale(${iris.scale})`,
    "--cr-pivot": `${px(frame.width / 2)} ${px(frame.width / 2)}`,
    "--cr-iris-r0": px(iris.r0),
    "--cr-iris-r1": px(iris.r1),
    "--cr-iris-cy": px(iris.cy),
    "--cr-frame-delay": ms(CHAT_RESUME_BEATS.frameStartMs),
    "--cr-frame-ms": ms(CHAT_RESUME_BEATS.frameMs),
    ...(scene.src ? null : { background: scene.fill ?? undefined }),
  } as CSSProperties;

  return (
    <div
      aria-hidden
      data-chat-resume-veil=""
      data-phase={phase}
      data-character-id={scene.room.characterId}
      data-chat-id={scene.room.chatId}
      data-compact={layout.compact ? "1" : "0"}
      className="cr-veil"
      style={style}
    >
      <div className="cr-ink">
        <div className="cr-panel cr-panel-a">
          <span className="cr-edge" />
          <div className="cr-frame" data-plain={scene.src ? "0" : "1"} style={frameStyle}>
            {scene.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cr-img" src={scene.src} alt="" draggable={false} />
            ) : (
              <span className="cr-glyph" style={{ fontSize: px(frame.width * 0.34) }}>
                {scene.glyph}
              </span>
            )}
          </div>
        </div>
        <div className="cr-panel cr-panel-b">
          <span className="cr-edge" />
          <div
            className="cr-eyebrow"
            style={
              {
                left: px(eyebrow.left),
                top: px(eyebrow.top),
                animationDelay: ms(CHAT_RESUME_BEATS.eyebrowStartMs),
                animationDuration: ms(CHAT_RESUME_BEATS.eyebrowMs),
              } as CSSProperties
            }
          >
            <span className="cr-eyebrow-rule" />
            <span className="cr-eyebrow-label">Resume</span>
          </div>
          <div
            className="cr-name"
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
      <span className="cr-line cr-line-h" />
      <span className="cr-line cr-line-v" />
      <span
        className="cr-ring"
        style={{ left: px(ink.x), top: px(ink.y), width: px(ink.r0 * 2), height: px(ink.r0 * 2) }}
      />
    </div>
  );
}
