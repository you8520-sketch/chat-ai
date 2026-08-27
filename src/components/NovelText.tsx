"use client";

import { useRef } from "react";
import {
  DEFAULT_CHARACTER_DIALOGUE_COLOR,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";
import {
  classifyNovelParagraph,
  collapseDialogueInternalLineBreaks,
  groupAuthorParagraphs,
  novelParagraphSpacingClass,
  parseGreetingSegments,
  parseNovelSegments,
  isNarrationEmphasisLine,
  resolveNovelDisplayParagraphs,
  type NovelParagraphKind,
} from "@/lib/novelParagraphs";
import { parseUserMessageParts } from "@/lib/userMessageParse";

type Segment = { kind: "narration" | "dialogue" | "special"; text: string };

/** 유저 입력: 대사 / 지문(*·서술) / (속마음·행동) — 자동 분류 + 표기 */
export function parseUserDisplaySegments(text: string): Segment[] {
  return parseUserMessageParts(text).map((part) => ({
    kind: part.kind === "dialogue" ? "dialogue" : "narration",
    text: part.text,
  }));
}

function InlineSegments({
  text,
  paragraphKind,
  narrationColor,
  dialogueColor,
  specialColor,
  parseSegments,
  narrationMuted = false,
  preserveRawLineBreaks = false,
  dialogueAccent = true,
}: {
  text: string;
  paragraphKind?: NovelParagraphKind;
  narrationColor: string;
  dialogueColor: string;
  specialColor: string;
  parseSegments: (text: string) => Segment[];
  narrationMuted?: boolean;
  /** 제작자 원본(greeting) — 대사 안 줄바꿈 합치지 않음 */
  preserveRawLineBreaks?: boolean;
  /** Global chat keeps the purple rail. TRPG action cards pass false. */
  dialogueAccent?: boolean;
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const dialogueText = preserveRawLineBreaks
    ? trimmed
    : collapseDialogueInternalLineBreaks(trimmed);

  if (paragraphKind === "dialogue") {
    return (
      <span
        className={`${dialogueAccent ? "chat-dialogue-accent " : ""}font-semibold${preserveRawLineBreaks ? " whitespace-pre-wrap" : ""}`}
        style={{ color: dialogueColor }}
      >
        {dialogueText}
      </span>
    );
  }

  if (paragraphKind === "narration") {
    const emphasis = isNarrationEmphasisLine(trimmed);
    return (
      <span
        className={
          emphasis
            ? "font-semibold"
            : narrationMuted
              ? "italic"
              : undefined
        }
        style={{ color: narrationColor }}
      >
        {trimmed}
      </span>
    );
  }

  const segments = parseSegments(trimmed);
  if (segments.length === 0) return <>{trimmed}</>;

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "dialogue") {
          return (
            <span
              key={i}
              className={`font-semibold${preserveRawLineBreaks ? " whitespace-pre-wrap" : ""}`}
              style={{ color: dialogueColor }}
            >
              {preserveRawLineBreaks
                ? seg.text
                : collapseDialogueInternalLineBreaks(seg.text)}
            </span>
          );
        }
        if (seg.kind === "special") {
          return (
            <span key={i} className="font-semibold" style={{ color: specialColor }}>
              {seg.text}
            </span>
          );
        }
        return (
          <span
            key={i}
            className={narrationMuted ? "italic" : undefined}
            style={{ color: narrationColor }}
          >
            {seg.text}
          </span>
        );
      })}
    </>
  );
}

const chatTypographyStyle = {
  fontSize: "var(--font-size-chat)",
  lineHeight: "var(--line-height-chat)",
  letterSpacing: "0.01em",
} as const;

const DEFAULT_SPECIAL_TERM_COLOR = "#c4b5fd";

export type NovelTextRenderStructure =
  | { layout: "centered" }
  | { layout: "block" }
  | { layout: "inline-first"; restParagraphCount: number };

/** Deterministic render structure for inline-first GM/table-talk layouts. */
export function resolveNovelTextRenderStructure(opts: {
  centered?: boolean;
  inlineFirstParagraph?: boolean;
  paragraphCount: number;
}): NovelTextRenderStructure {
  if (opts.centered) return { layout: "centered" };
  if (opts.inlineFirstParagraph && opts.paragraphCount > 0) {
    return {
      layout: "inline-first",
      restParagraphCount: Math.max(0, opts.paragraphCount - 1),
    };
  }
  return { layout: "block" };
}

/** AI·유저 응답을 웹소설 형식으로 렌더 */
export default function NovelText({
  content,
  display,
  variant = "character",
  centered = false,
  paragraphMode = "ai",
  streaming = false,
  dialogueAccent = true,
  inlineFirstParagraph = false,
  proseClassName,
}: {
  content: string;
  display?: Pick<
    ChatDisplayPrefs,
    "narrationColor" | "dialogueColor" | "userNarrationColor" | "userDialogueColor"
  >;
  variant?: "character" | "user";
  centered?: boolean;
  /** ai: AI 응답용 병합 · author: 제작자 첫 메시지 등 Enter 줄바꿈 유지 */
  paragraphMode?: "ai" | "author";
  /** 스트리밍 중 — 이미 그린 문단은 고정, 마지막 문단만 분리/갱신 */
  streaming?: boolean;
  /** Global chat keeps the purple rail. TRPG action cards pass false. */
  dialogueAccent?: boolean;
  /** First paragraph renders inline (e.g. TRPG GM table-talk after the GM: label). */
  inlineFirstParagraph?: boolean;
  /** Optional presentation class on the prose root (TRPG passes styling; defaults unchanged). */
  proseClassName?: string;
}) {
  const streamingParasRef = useRef<string[]>([]);

  if (!content) {
    streamingParasRef.current = [];
    return null;
  }

  const isAuthorMode = paragraphMode === "author" && variant === "character";

  const narrationColor =
    variant === "user"
      ? (display?.userNarrationColor ?? "#a1a1aa")
      : isAuthorMode
        ? (display?.userNarrationColor ?? "#a1a1aa")
        : (display?.narrationColor ?? "#fafafa");
  const dialogueColor =
    variant === "user"
      ? (display?.userDialogueColor ?? "#e4e4e7")
      : (display?.dialogueColor ?? DEFAULT_CHARACTER_DIALOGUE_COLOR);
  const specialColor = DEFAULT_SPECIAL_TERM_COLOR;
  const parseSegments =
    variant === "user"
      ? parseUserDisplaySegments
      : isAuthorMode
        ? parseGreetingSegments
        : parseNovelSegments;

  let paragraphs: string[];
  if (variant === "user") {
    paragraphs = content.split(/\n+/).filter((b) => b.trim());
    streamingParasRef.current = [];
  } else if (paragraphMode === "author") {
    paragraphs = groupAuthorParagraphs(content);
    streamingParasRef.current = [];
  } else {
    paragraphs = resolveNovelDisplayParagraphs(content, {
      streaming,
      previousStreamingParagraphs: streaming ? streamingParasRef.current : undefined,
    });
    streamingParasRef.current = streaming ? paragraphs : [];
  }
  const displayParagraphs = paragraphs.length > 0 ? paragraphs : [content];
  const paragraphKinds = displayParagraphs.map((p) =>
    p.trim() ? classifyNovelParagraph(p) : ("narration" as NovelParagraphKind)
  );
  const spacingMode: "ai" | "author" =
    variant === "user" || paragraphMode === "author" ? "author" : "ai";

  const typography =
    variant === "user"
      ? {
          ...chatTypographyStyle,
          fontSize: "calc(var(--font-size-chat) * 0.93)",
        }
      : chatTypographyStyle;

  const useParagraphKindColors = paragraphMode === "ai" && variant === "character";

  const proseClassNameMerged =
    ["chat-novel-prose", proseClassName].filter(Boolean).join(" ") || "chat-novel-prose";

  const renderParagraphBody = (para: string, i: number) => {
    const empty = !para.trim();
    if (empty) return "\u00a0";
    return (
      <InlineSegments
        text={para}
        paragraphKind={useParagraphKindColors ? paragraphKinds[i] : undefined}
        narrationColor={narrationColor}
        dialogueColor={dialogueColor}
        specialColor={specialColor}
        parseSegments={parseSegments}
        narrationMuted={isAuthorMode}
        preserveRawLineBreaks={isAuthorMode}
        dialogueAccent={dialogueAccent}
      />
    );
  };

  const spacingClassFor = (i: number) =>
    i > 0
      ? novelParagraphSpacingClass(paragraphKinds[i], paragraphKinds[i - 1], spacingMode)
      : undefined;

  const renderStructure = resolveNovelTextRenderStructure({
    centered,
    inlineFirstParagraph,
    paragraphCount: displayParagraphs.length,
  });

  if (renderStructure.layout === "centered") {
    return (
      <p className="chat-novel-prose text-center" style={typography}>
        {displayParagraphs.map((para, i) => {
          const spacingClass = spacingClassFor(i);
          return (
            <span
              key={i}
              className={spacingClass ? `${spacingClass} block` : undefined}
            >
              {renderParagraphBody(para, i)}
            </span>
          );
        })}
      </p>
    );
  }

  if (renderStructure.layout === "inline-first") {
    const [firstPara, ...restParagraphs] = displayParagraphs;
    return (
      <>
        <span className={proseClassNameMerged} style={typography}>
          {renderParagraphBody(firstPara!, 0)}
        </span>
        {renderStructure.restParagraphCount > 0 ? (
          <div className={proseClassNameMerged} style={typography}>
            {restParagraphs.map((para, i) => {
              const paragraphIndex = i + 1;
              const spacingClass = spacingClassFor(paragraphIndex);
              return (
                <p
                  key={paragraphIndex}
                  className={[
                    isAuthorMode ? "m-0 leading-[inherit]" : undefined,
                    spacingClass,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                >
                  {renderParagraphBody(para, paragraphIndex)}
                </p>
              );
            })}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={proseClassNameMerged} style={typography}>
      {displayParagraphs.map((para, i) => {
        const spacingClass = spacingClassFor(i);
        return (
          <p
            key={i}
            className={[
              isAuthorMode ? "m-0 leading-[inherit]" : undefined,
              spacingClass,
            ]
              .filter(Boolean)
              .join(" ") || undefined}
          >
            {renderParagraphBody(para, i)}
          </p>
        );
      })}
    </div>
  );
}
