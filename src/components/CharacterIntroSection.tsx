"use client";

import { useState } from "react";
import RichDescription from "@/components/RichDescription";
import CreatorCommentHtml from "@/components/CreatorCommentHtml";
import {
  CHARACTER_DESCRIPTION_PREVIEW_CHARS,
  truncateDescriptionPreview,
} from "@/lib/descriptionPreview";

type Props = {
  description: string;
  creatorComment?: string;
  viewerDisplayName?: string | null;
  characterDisplayName?: string | null;
  previewChars?: number;
  /** false = 제작 미리보기 등 전체 표시 */
  collapsible?: boolean;
};

/** 공개 페이지 — 상세 소개 접기 + 제작자 코멘트 */
export default function CharacterIntroSection({
  description,
  creatorComment = "",
  viewerDisplayName,
  characterDisplayName,
  previewChars = CHARACTER_DESCRIPTION_PREVIEW_CHARS,
  collapsible = true,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = description.trim();
  const { preview, needsExpand } = truncateDescriptionPreview(trimmed, previewChars);
  const canCollapse = collapsible && needsExpand;
  const showCollapsed = canCollapse && !expanded;
  const displayContent = showCollapsed ? preview : trimmed;
  const comment = creatorComment.trim();

  return (
    <>
      <div className="character-detail-intro rounded-2xl border border-white/8 bg-[#131626] p-5 sm:p-6">
        <p className="mb-4 text-sm font-bold text-zinc-300">캐릭터 상세 소개</p>
        {trimmed ? (
          <div className="relative text-zinc-100">
            <RichDescription
              content={displayContent}
              viewerDisplayName={viewerDisplayName}
              characterDisplayName={characterDisplayName}
            />
            {showCollapsed ? (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#131626] to-transparent"
                aria-hidden
              />
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-gray-500">등록된 상세 소개가 없습니다.</p>
        )}
        {canCollapse ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm font-semibold text-violet-300 transition hover:border-violet-500/30 hover:bg-violet-500/10 hover:text-violet-200"
          >
            {expanded ? "접기" : `펼치기 · ${trimmed.length.toLocaleString()}자 전체 보기`}
          </button>
        ) : null}
      </div>

      {comment ? (
        <div className="mt-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5">
          <p className="mb-2 text-xs font-bold text-violet-300/90">제작자 코멘트</p>
          <CreatorCommentHtml html={comment} />
        </div>
      ) : null}
    </>
  );
}
