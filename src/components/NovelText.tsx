import { type ChatDisplayPrefs } from "@/lib/chatDisplayPrefs";
import {
  classifyNovelParagraph,
  collapseDialogueInternalLineBreaks,
  groupAuthorParagraphs,
  groupNovelParagraphs,
  novelParagraphSpacingClass,
  parseGreetingSegments,
  parseNovelSegments,
  isNarrationEmphasisLine,
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
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const dialogueText = preserveRawLineBreaks
    ? trimmed
    : collapseDialogueInternalLineBreaks(trimmed);

  if (paragraphKind === "dialogue") {
    return (
      <span
        className={`font-semibold${preserveRawLineBreaks ? " whitespace-pre-wrap" : ""}`}
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

/** AI·유저 응답을 웹소설 형식으로 렌더 */
export default function NovelText({
  content,
  display,
  variant = "character",
  centered = false,
  paragraphMode = "ai",
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
}) {
  if (!content) return null;

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
      : (display?.dialogueColor ?? "#fb923c");
  const specialColor = DEFAULT_SPECIAL_TERM_COLOR;
  const parseSegments =
    variant === "user"
      ? parseUserDisplaySegments
      : isAuthorMode
        ? parseGreetingSegments
        : parseNovelSegments;

  const paragraphs =
    variant === "user"
      ? content.split(/\n+/).filter((b) => b.trim())
      : paragraphMode === "author"
        ? groupAuthorParagraphs(content)
        : groupNovelParagraphs(content);
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

  if (centered) {
    return (
      <p className="chat-novel-prose text-center" style={typography}>
        {displayParagraphs.map((para, i) => {
          const empty = !para.trim();
          return (
            <span
              key={i}
              className={
                i > 0
                  ? novelParagraphSpacingClass(
                      paragraphKinds[i],
                      paragraphKinds[i - 1],
                      spacingMode
                    ) + " block"
                  : undefined
              }
            >
              {empty ? (
                <span className="inline-block min-h-[1em]">{"\u00a0"}</span>
              ) : (
                <InlineSegments
                  text={para}
                  paragraphKind={useParagraphKindColors ? paragraphKinds[i] : undefined}
                  narrationColor={narrationColor}
                  dialogueColor={dialogueColor}
                  specialColor={specialColor}
                  parseSegments={parseSegments}
                  narrationMuted={isAuthorMode}
                  preserveRawLineBreaks={isAuthorMode}
                />
              )}
            </span>
          );
        })}
      </p>
    );
  }

  return (
    <div className="chat-novel-prose" style={typography}>
      {displayParagraphs.map((para, i) => {
        const empty = !para.trim();
        return (
          <p
            key={i}
            className={[
              isAuthorMode ? "m-0 leading-[inherit]" : undefined,
              i > 0
                ? novelParagraphSpacingClass(
                    paragraphKinds[i],
                    paragraphKinds[i - 1],
                    spacingMode
                  )
                : undefined,
            ]
              .filter(Boolean)
              .join(" ") || undefined}
          >
            {empty ? (
              "\u00a0"
            ) : (
              <InlineSegments
                text={para}
                paragraphKind={useParagraphKindColors ? paragraphKinds[i] : undefined}
                narrationColor={narrationColor}
                dialogueColor={dialogueColor}
                specialColor={specialColor}
                parseSegments={parseSegments}
                narrationMuted={isAuthorMode}
                preserveRawLineBreaks={isAuthorMode}
              />
            )}
          </p>
        );
      })}
    </div>
  );
}
