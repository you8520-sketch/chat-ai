import CharacterAssetImage from "@/components/CharacterAssetImage";
import {
  CHAT_PORTRAIT_PANEL_FRAME_CLASS,
  CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS,
  CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS,
  CHAT_PORTRAIT_PANEL_SHELL_CLASS,
} from "@/lib/chatDisplayPrefs";

type Props = {
  characterName: string;
  emoji: string;
  hue: number;
  portraitUrl: string | null;
  blurForViewer?: boolean;
  size?: "inline" | "panel";
  onPortraitClick?: () => void;
  /** PC panel — existing asset metadata for aspect-ratio reservation (CLS). */
  assetWidth?: number;
  assetHeight?: number;
};

export default function ChatCharacterPortrait({
  characterName,
  emoji,
  hue,
  portraitUrl,
  blurForViewer = false,
  size = "inline",
  onPortraitClick,
  assetWidth,
  assetHeight,
}: Props) {
  const widthClass =
    size === "panel"
      ? `h-full w-fit ${CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS}`
      : "w-10 shrink-0 sm:w-11 md:w-12 lg:w-14";

  const panelFrameClass =
    size === "panel"
      ? CHAT_PORTRAIT_PANEL_FRAME_CLASS
      : "relative aspect-[3/4] w-full overflow-hidden rounded-xl ring-1 ring-white/10 transition hover:ring-violet-500/40";

  const panelAspectRatioStyle =
    size === "panel" &&
    Number.isFinite(assetWidth) &&
    Number.isFinite(assetHeight) &&
    (assetWidth ?? 0) > 0 &&
    (assetHeight ?? 0) > 0
      ? { aspectRatio: `${assetWidth} / ${assetHeight}` }
      : undefined;

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
        className={
          size === "panel"
            ? "relative z-10 max-h-full w-fit max-w-full transition-opacity duration-300"
            : "relative z-10 h-full w-full transition-opacity duration-300"
        }
        imgClassName={
          size === "panel"
            ? CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS
            : "h-full w-full object-cover object-top"
        }
        imgStyle={panelAspectRatioStyle}
      />
    </div>
  ) : (
    <span
      className={`flex items-center justify-center rounded-xl text-lg ring-1 ring-white/10 sm:text-2xl md:text-3xl ${
        size === "panel"
          ? `h-full w-fit ${CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS} shrink-0`
          : "aspect-square w-full"
      }`}
      style={{ background: `hsl(${hue} 60% 22%)` }}
    >
      {emoji}
    </span>
  );

  const panelShellClass = size === "panel" ? CHAT_PORTRAIT_PANEL_SHELL_CLASS : "";

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
