import RichDescription from "@/components/RichDescription";
import { profileTypography } from "@/lib/profileTypography";

/** 다른 사용자에게 보이는 캐릭터 소개 페이지 미리보기 (공용 디자인) */
export default function CharacterIntroPreview({
  name,
  tagline,
  description,
  emoji,
  hue,
}: {
  name: string;
  tagline: string;
  description: string;
  emoji: string;
  hue: number;
}) {
  const displayName = name.trim() || "캐릭터 이름";

  return (
    <div className={profileTypography.card}>
      <div className={profileTypography.cardGlow} aria-hidden />
      <div className="border-b border-white/10 bg-white/[0.02] px-4 py-2.5">
        <p className="text-xs font-bold text-emerald-300/90">공개 페이지 미리보기</p>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex gap-4">
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl text-3xl ring-1 ring-white/10"
            style={{
              background: `linear-gradient(135deg, hsl(${hue} 60% 24%), hsl(${(hue + 60) % 360} 60% 12%))`,
            }}
          >
            {emoji}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={profileTypography.name}>{displayName}</h3>
            {tagline.trim() ? (
              <div className={`mt-3 ${profileTypography.summaryCard}`}>
                <p className={profileTypography.summaryLabel}>한 줄 소개</p>
                <p className={profileTypography.summary}>{tagline}</p>
              </div>
            ) : (
              <p className="mt-2 text-sm italic text-gray-600">한 줄 소개 없음</p>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-6">
          {description.trim() ? (
            <RichDescription content={description} />
          ) : (
            <p className="text-sm italic text-gray-600">상세 소개를 입력하면 여기에 표시됩니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}
