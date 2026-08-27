import CharacterAssetImage from "@/components/CharacterAssetImage";
import {
  CHAT_PORTRAIT_PANEL_FRAME_CLASS,
  CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS,
  CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS,
  CHAT_PORTRAIT_PANEL_PLACEHOLDER_CLASS,
  CHAT_PORTRAIT_PANEL_SHELL_CLASS,
  CHAT_PORTRAIT_PLACEHOLDER_MAX_WIDTH,
  CHAT_PORTRAIT_RAIL_HEIGHT,
} from "@/lib/chatDisplayPrefs";

type Props = {
  characterName: string;
  emoji: string;
  hue: number;
  portraitUrl: string | null;
  blurForViewer?: boolean;
  size?: "inline" | "panel";
  onPortraitClick?: () => void;
  assetWidth?: number;
  assetHeight?: number;
};

function panelAspectRatio(assetWidth?: number, assetHeight?: number): { w: number; h: number } {
  const w = Number(assetWidth);
  const h = Number(assetHeight);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { w: Math.round(w), h: Math.round(h) };
  }
  return { w: 3, h: 4 };
}

/** Definite rail height + aspect-ratio → intrinsic width for grid max-content track. */
function panelFrameStyle(assetWidth?: number, assetHeight?: number, maxWidth = "var(--chat-portrait-max-w)") {
  const { w, h } = panelAspectRatio(assetWidth, assetHeight);
  return {
    aspectRatio: `${w} / ${h}`,
    height: `min(${CHAT_PORTRAIT_RAIL_HEIGHT}, calc(${maxWidth} * ${h} / ${w}))`,
    width: "auto",
    maxWidth,
  } as const;
}

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
      ? `h-full w-max ${CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS}`
      : "w-10 shrink-0 sm:w-11 md:w-12 lg:w-14";

  const panelFrameClass =
    size === "panel"
      ? `${CHAT_PORTRAIT_PANEL_FRAME_CLASS} ${CHAT_PORTRAIT_PANEL_MAX_WIDTH_CLASS}`
      : "relative aspect-[3/4] w-full overflow-hidden rounded-xl ring-1 ring-white/10 transition hover:ring-violet-500/40";

  const thumb = portraitUrl ? (
    <div
      key={`${portraitUrl}-${assetWidth ?? 0}-${assetHeight ?? 0}`}
      className={panelFrameClass}
      style={size === "panel" ? panelFrameStyle(assetWidth, assetHeight) : { background: `hsl(${hue} 60% 20%)` }}
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
            ? "relative z-10 h-full w-full transition-opacity duration-300"
            : "relative z-10 h-full w-full transition-opacity duration-300"
        }
        imgClassName={
          size === "panel"
            ? CHAT_PORTRAIT_PANEL_IMG_ENHANCED_CLASS
            : "h-full w-full object-cover object-top"
        }
      />
    </div>
  ) : (
    <span
      className={`rounded-xl text-lg ring-1 ring-white/10 sm:text-2xl md:text-3xl ${
        size === "panel" ? CHAT_PORTRAIT_PANEL_PLACEHOLDER_CLASS : "flex aspect-square w-full items-center justify-center"
      }`}
      style={
        size === "panel"
          ? panelFrameStyle(3, 4, CHAT_PORTRAIT_PLACEHOLDER_MAX_WIDTH)
          : { background: `hsl(${hue} 60% 22%)` }
      }
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
        className={`block cursor-zoom-in overflow-hidden ${widthClass} ${panelShellClass}`}
      >
        {thumb}
      </button>
    );
  }

  return (
    <div className={`block ${widthClass} ${panelShellClass}`}>{thumb}</div>
  );
}
