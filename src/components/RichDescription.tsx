"use client";

import { parseDescriptionBlocks } from "@/lib/descriptionParser";
import { applyProfilePlaceholders } from "@/lib/userPlaceholder";
import { profileTypography } from "@/lib/profileTypography";
import CreatorCommentHtml from "@/components/CreatorCommentHtml";
import {
  parseProfileInlineSegments,
  PROFILE_TEXT_COLOR_CLASS,
  PROFILE_TEXT_COLORS,
  PROFILE_TEXT_SIZE_PX,
  PROFILE_TEXT_SIZES,
  stripProfileSizeTags,
  effectiveProfileSize,
  type ProfileTextSize,
} from "@/lib/profileTextFormat";

function PlainInlineText({ text }: { text: string }) {
  const segments = parseProfileInlineSegments(text);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "bold") {
          return (
            <strong key={i} className="font-semibold text-inherit">
              <PlainInlineText text={seg.value} />
            </strong>
          );
        }
        if (seg.type === "color") {
          return (
            <span
              key={i}
              className={PROFILE_TEXT_COLOR_CLASS[seg.color]}
              style={{ color: PROFILE_TEXT_COLORS[seg.color] }}
            >
              <PlainInlineText text={seg.value} />
            </span>
          );
        }
        if (seg.type === "size") {
          const nested = /^\[size:/.test(seg.value.trim());
          const displaySize: ProfileTextSize = nested
            ? effectiveProfileSize(`[size:${seg.size}]${seg.value}[/size]`)
            : seg.size;
          const inner = nested ? stripProfileSizeTags(seg.value) : seg.value;
          return (
            <span
              key={i}
              className={PROFILE_TEXT_SIZES[displaySize]}
              style={{ fontSize: PROFILE_TEXT_SIZE_PX[displaySize], lineHeight: 1.55 }}
            >
              <PlainInlineText text={inner} />
            </span>
          );
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </>
  );
}

function PlainMemoText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="space-y-0 text-[15px] leading-relaxed text-zinc-100">
      {lines.map((line, i) => (
        <p key={i} className="min-h-[1.55em] whitespace-pre-wrap break-words">
          {line ? <PlainInlineText text={line} /> : "\u00a0"}
        </p>
      ))}
    </div>
  );
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

/** 소개란: 일반 메모장형 줄글 + 선택영역 서식 */
export default function RichDescription({
  content,
  viewerDisplayName,
  characterDisplayName,
}: {
  content: string;
  viewerDisplayName?: string | null;
  /** {{char}} → 캐릭터 카드명 */
  characterDisplayName?: string | null;
}) {
  const resolved = applyProfilePlaceholders(content, { viewerDisplayName, characterDisplayName });
  if (looksLikeHtml(resolved)) {
    return (
      <CreatorCommentHtml
        html={resolved}
        className="public-description-html text-[15px] leading-relaxed text-zinc-100"
      />
    );
  }
  const blocks = parseDescriptionBlocks(resolved);
  return (
    <div className="profile-rich-text">
      {blocks.map((block, i) =>
        block.kind === "text" ? (
          <PlainMemoText key={i} text={block.text} />
        ) : (
          <div key={i} className="mb-6 w-full py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={block.url}
              alt=""
              className={profileTypography.inlineImage}
            />
          </div>
        )
      )}
    </div>
  );
}
