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
      ? "w-full max-w-[400px]"
      : "w-10 shrink-0 sm:w-11 md:w-12 lg:w-14";

  const panelFrameClass =
    size === "panel"
      ? "relative h-full w-full max-w-[400px] shrink-0 overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#08080c] shadow-lg shadow-black/10 transition hover:border-violet-400/35"
      : "relative aspect-[3/4] w-full overflow-hidden rounded-xl ring-1 ring-white/10 transition hover:ring-violet-500/40";

  const thumb = portraitUrl ? (
    <div
      className={panelFrameClass}
      style={size === "panel" ? undefined : { background: `hsl(${hue} 60% 20%)` }}
    >
      {size === "panel" && !blurForViewer && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${portraitUrl}-background`}
          src={portraitUrl}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-20 blur-xl"
          draggable={false}
          aria-hidden
        />
      )}
      <CharacterAssetImage
        key={portraitUrl}
        src={portraitUrl}
        alt={characterName}
        blurForViewer={blurForViewer}
        className="relative z-10 h-full w-full transition-opacity duration-300"
        imgClassName={
          size === "panel"
            ? "h-full w-full object-cover object-top brightness-95 contrast-95"
            : "h-full w-full object-cover object-top"
        }
      />
    </div>
  ) : (
    <span
      className={`flex items-center justify-center rounded-xl text-lg ring-1 ring-white/10 sm:text-2xl md:text-3xl ${
        size === "panel"
          ? "h-full w-full max-w-[400px] shrink-0"
          : "aspect-square w-full"
      }`}
      style={{ background: `hsl(${hue} 60% 22%)` }}
    >
      {emoji}
    </span>
  );

  const panelShellClass =
    size === "panel" ? "flex h-full w-full min-h-0 items-stretch justify-center" : "";

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

  return (
    <div className={`block ${widthClass} ${panelShellClass}`}>{thumb}</div>
  );
}
