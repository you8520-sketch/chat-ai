"use client";

import { parseDescriptionBlocks } from "@/lib/descriptionParser";
import { applyProfilePlaceholders } from "@/lib/userPlaceholder";
import { profileTypography } from "@/lib/profileTypography";
import { ProfileRichText } from "@/components/ProfileRichText";

/** 소개란: URL은 이미지, 텍스트는 사이트 공통 마크다운 디자인 */
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
  const blocks = parseDescriptionBlocks(resolved);
  return (
    <div className="profile-rich-text">
      {blocks.map((block, i) =>
        block.kind === "text" ? (
          <ProfileRichText key={i} content={block.text} />
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

/** 입력 중 실시간 미리보기 */
export function RichDescriptionPreview({
  content,
  viewerDisplayName,
  characterDisplayName,
}: {
  content: string;
  viewerDisplayName?: string | null;
  characterDisplayName?: string | null;
}) {
  if (!content.trim()) {
    return (
      <p className="text-xs text-gray-600">
        이미지 URL을 한 줄에 하나씩 넣으면 아래에 자동으로 미리보기됩니다.
      </p>
    );
  }
  return (
    <div className={`mt-3 ${profileTypography.card} p-4`}>
      <div className={profileTypography.cardGlow} aria-hidden />
      <p className="mb-3 text-[11px] font-semibold text-gray-500">공개 소개 미리보기</p>
      <RichDescription
        content={content}
        viewerDisplayName={viewerDisplayName}
        characterDisplayName={characterDisplayName}
      />
    </div>
  );
}
