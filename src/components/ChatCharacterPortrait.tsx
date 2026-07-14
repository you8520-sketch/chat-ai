import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import CharacterAssetImage from "@/components/CharacterAssetImage";

type Props = {
  characterName: string;
  emoji: string;
  hue: number;
  portraitUrl: string | null;
  blurForViewer?: boolean;
  size?: "inline" | "panel";
  onPortraitClick?: () => void;
};

export default function ChatCharacterPortrait({
  characterName,
  emoji,
  hue,
  portraitUrl,
  blurForViewer = false,
  size = "inline",
  onPortraitClick,
}: Props) {
  const widthClass =
    size === "panel"
      ? "h-full max-h-[57vw] w-auto max-w-full md:max-h-[54vw] lg:max-h-[51vw]"
      : "w-10 shrink-0 sm:w-11 md:w-12 lg:w-14";

  const panelFrameClass =
    size === "panel"
      ? `relative h-full w-auto max-w-full shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 transition hover:ring-violet-500/40 ${CHARACTER_THUMB_ASPECT}`
      : `relative w-full overflow-hidden rounded-xl ring-1 ring-white/10 transition hover:ring-violet-500/40 ${CHARACTER_THUMB_ASPECT}`;

  const thumb = portraitUrl ? (
    <div className={panelFrameClass} style={{ background: `hsl(${hue} 60% 20%)` }}>
      <CharacterAssetImage
        key={portraitUrl}
        src={portraitUrl}
        alt={characterName}
        blurForViewer={blurForViewer}
        className="h-full w-full transition-opacity duration-300"
        imgClassName="h-full w-full object-cover object-top"
      />
    </div>
  ) : (
    <span
      className={`flex items-center justify-center rounded-xl text-lg ring-1 ring-white/10 sm:text-2xl md:text-3xl ${
        size === "panel"
          ? `h-full w-auto max-w-full shrink-0 ${CHARACTER_THUMB_ASPECT}`
          : "aspect-square w-full"
      }`}
      style={{ background: `hsl(${hue} 60% 22%)` }}
    >
      {emoji}
    </span>
  );

  const panelShellClass =
    size === "panel" ? "flex h-full w-full min-h-0 items-end justify-center" : "";

  if (onPortraitClick) {
    return (
      <button
        type="button"
        onClick={onPortraitClick}
        title="크게 보기"
        aria-label={`${characterName} 이미지 크게 보기`}
        className={`block cursor-zoom-in ${widthClass} ${panelShellClass}`}
      >
        {thumb}
      </button>
    );
  }

  return <div className={`block ${widthClass} ${panelShellClass}`}>{thumb}</div>;
}
