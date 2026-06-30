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
}: {
  text: string;
  paragraphKind?: NovelParagraphKind;
  narrationColor: string;
  dialogueColor: string;
  specialColor: string;
  parseSegments: (text: string) => Segment[];
  narrationMuted?: boolean;
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (paragraphKind === "dialogue") {
    return (
      <span className="font-semibold" style={{ color: dialogueColor }}>
        {collapseDialogueInternalLineBreaks(trimmed)}
      </span>
    );
  }

  if (paragraphKind === "narration") {
    const emphasis = isNarrationEmphasisLine(trimmed);
    return (
      <span
        className={emphasis ? "font-semibold" : narrationMuted ? "italic" : undefined}
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
            <span key={i} className="font-semibold" style={{ color: dialogueColor }}>
              {collapseDialogueInternalLineBreaks(seg.text)}
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
  streaming = false,
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
  /** 스트리밍 중 — 열린 대사 따옴표부터 즉시 별도 문단 */
  streaming?: boolean;
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
        : groupNovelParagraphs(content, { streaming });
  const displayParagraphs = paragraphs.length > 0 ? paragraphs : [content];
  const paragraphKinds = displayParagraphs.map((p) =>
    classifyNovelParagraph(p, { streaming })
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
        {displayParagraphs.map((para, i) => (
          <span
            key={i}
            className={
              i > 0
                ? novelParagraphSpacingClass(paragraphKinds[i], paragraphKinds[i - 1], spacingMode) +
                  " block"
                : undefined
            }
          >
            <InlineSegments
              text={para.trim()}
              paragraphKind={useParagraphKindColors ? paragraphKinds[i] : undefined}
              narrationColor={narrationColor}
              dialogueColor={dialogueColor}
              specialColor={specialColor}
              parseSegments={parseSegments}
              narrationMuted={isAuthorMode}
            />
          </span>
        ))}
      </p>
    );
  }

  return (
    <div className="chat-novel-prose" style={typography}>
      {displayParagraphs.map((para, i) => (
        <p
          key={i}
          className={
            i > 0
              ? novelParagraphSpacingClass(paragraphKinds[i], paragraphKinds[i - 1], spacingMode)
              : undefined
          }
        >
          <InlineSegments
            text={para.trim()}
            paragraphKind={useParagraphKindColors ? paragraphKinds[i] : undefined}
            narrationColor={narrationColor}
            dialogueColor={dialogueColor}
            specialColor={specialColor}
            parseSegments={parseSegments}
            narrationMuted={isAuthorMode}
          />
        </p>
      ))}
    </div>
  );
}
