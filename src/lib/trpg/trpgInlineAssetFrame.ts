import { orientationFromSize, type CharacterAsset } from "@/lib/characterAssets";

/**
 * TRPG GM inline image frame. One policy for scenario, character, and NPC images.
 * Regular chat keeps CHAT_INLINE_ASSET_FIGURE_CLASS; these class strings are
 * complete literals so Tailwind can see them.
 *
 * Sized images reserve width from the height cap and the real aspect ratio
 * (contain, no crop). Missing width/height does not reserve a tall empty box.
 */
export const TRPG_INLINE_DESKTOP_MIN_WIDTH_PX = 576;

export const TRPG_INLINE_PORTRAIT_HEIGHT_CAP = {
  mobilePx: 200,
  desktopPx: 240,
  viewportRatio: 0.3,
} as const;

export const TRPG_INLINE_SQUARE_HEIGHT_CAP = {
  mobilePx: 220,
  desktopPx: 280,
  viewportRatio: 0.32,
} as const;

export const TRPG_INLINE_PORTRAIT_FIGURE_CLASS =
  "mx-auto my-3 block max-w-full w-[min(calc(min(200px,30svh)*var(--trpg-inline-ratio)),100%)] min-[576px]:w-[min(calc(min(240px,30svh)*var(--trpg-inline-ratio)),100%)]";

export const TRPG_INLINE_SQUARE_FIGURE_CLASS =
  "mx-auto my-3 block max-w-full w-[min(calc(min(220px,32svh)*var(--trpg-inline-ratio)),100%)] min-[576px]:w-[min(calc(min(280px,32svh)*var(--trpg-inline-ratio)),100%)]";

export const TRPG_INLINE_LANDSCAPE_FIGURE_CLASS = "my-3 block w-full max-w-full";

export const TRPG_INLINE_UNKNOWN_FIGURE_CLASS = "mx-auto my-3 block w-fit max-w-full";

export const TRPG_INLINE_KNOWN_BOX_CLASS = "h-full w-full max-w-full overflow-hidden rounded-lg";

export const TRPG_INLINE_UNKNOWN_BOX_CLASS = "h-auto w-auto max-w-full overflow-hidden rounded-lg";

export const TRPG_INLINE_IMG_CLASS = "block h-full w-full max-w-full object-contain object-center";

export const TRPG_INLINE_UNKNOWN_IMG_CLASS =
  "block h-auto w-auto max-h-[min(200px,30svh)] max-w-full object-contain object-center min-[576px]:max-h-[min(240px,30svh)]";

export type TrpgInlineFrameKind = "landscape" | "portrait" | "square" | "unknown";

export type TrpgInlineFrame = {
  kind: TrpgInlineFrameKind;
  figureClassName: string;
  boxClassName: string;
  imgClassName: string;
  style?: {
    aspectRatio: string;
    "--trpg-inline-ratio": string;
  };
};

function sizedPixels(asset: Pick<CharacterAsset, "width" | "height">): { width: number; height: number } | null {
  const width = Number(asset.width);
  const height = Number(asset.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export function trpgInlineAssetFrame(asset: Pick<CharacterAsset, "width" | "height" | "orientation">): TrpgInlineFrame {
  const sized = sizedPixels(asset);
  if (!sized) {
    return {
      kind: "unknown",
      figureClassName: TRPG_INLINE_UNKNOWN_FIGURE_CLASS,
      boxClassName: TRPG_INLINE_UNKNOWN_BOX_CLASS,
      imgClassName: TRPG_INLINE_UNKNOWN_IMG_CLASS,
    };
  }
  const kind = orientationFromSize(sized.width, sized.height);
  if (kind == null) {
    return {
      kind: "unknown",
      figureClassName: TRPG_INLINE_UNKNOWN_FIGURE_CLASS,
      boxClassName: TRPG_INLINE_UNKNOWN_BOX_CLASS,
      imgClassName: TRPG_INLINE_UNKNOWN_IMG_CLASS,
    };
  }
  const style = {
    aspectRatio: `${Math.round(sized.width)} / ${Math.round(sized.height)}`,
    "--trpg-inline-ratio": String(sized.width / sized.height),
  } as const;
  switch (kind) {
    case "landscape":
      return {
        kind,
        figureClassName: TRPG_INLINE_LANDSCAPE_FIGURE_CLASS,
        boxClassName: TRPG_INLINE_KNOWN_BOX_CLASS,
        imgClassName: TRPG_INLINE_IMG_CLASS,
        style,
      };
    case "portrait":
      return {
        kind,
        figureClassName: TRPG_INLINE_PORTRAIT_FIGURE_CLASS,
        boxClassName: TRPG_INLINE_KNOWN_BOX_CLASS,
        imgClassName: TRPG_INLINE_IMG_CLASS,
        style,
      };
    case "square":
      return {
        kind,
        figureClassName: TRPG_INLINE_SQUARE_FIGURE_CLASS,
        boxClassName: TRPG_INLINE_KNOWN_BOX_CLASS,
        imgClassName: TRPG_INLINE_IMG_CLASS,
        style,
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function heightCapPx(
  cap: { mobilePx: number; desktopPx: number; viewportRatio: number },
  viewportWidth: number,
  viewportHeight: number
): number {
  const px = viewportWidth >= TRPG_INLINE_DESKTOP_MIN_WIDTH_PX ? cap.desktopPx : cap.mobilePx;
  return Math.min(px, viewportHeight * cap.viewportRatio);
}

/** CSS frame in pixels. Unknown assets use intrinsic pixels and the portrait cap. */
export function trpgInlineRenderedBox(opts: {
  asset: Pick<CharacterAsset, "width" | "height" | "orientation">;
  viewportWidth: number;
  viewportHeight: number;
  columnWidth: number;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
}): { kind: TrpgInlineFrameKind; width: number; height: number } {
  const frame = trpgInlineAssetFrame(opts.asset);
  switch (frame.kind) {
    case "unknown": {
      const intrinsicWidth = opts.intrinsicWidth ?? 0;
      const intrinsicHeight = opts.intrinsicHeight ?? 0;
      if (intrinsicWidth <= 0 || intrinsicHeight <= 0) return { kind: "unknown", width: 0, height: 0 };
      const cap = heightCapPx(TRPG_INLINE_PORTRAIT_HEIGHT_CAP, opts.viewportWidth, opts.viewportHeight);
      let height = Math.min(intrinsicHeight, cap);
      let width = height * (intrinsicWidth / intrinsicHeight);
      if (width > opts.columnWidth) {
        width = opts.columnWidth;
        height = width * (intrinsicHeight / intrinsicWidth);
      }
      return { kind: "unknown", width, height };
    }
    case "landscape": {
      const sized = sizedPixels(opts.asset)!;
      const width = opts.columnWidth;
      return { kind: "landscape", width, height: width * (sized.height / sized.width) };
    }
    case "portrait":
    case "square": {
      const sized = sizedPixels(opts.asset)!;
      const cap = heightCapPx(
        frame.kind === "portrait" ? TRPG_INLINE_PORTRAIT_HEIGHT_CAP : TRPG_INLINE_SQUARE_HEIGHT_CAP,
        opts.viewportWidth,
        opts.viewportHeight
      );
      const width = Math.min(cap * (sized.width / sized.height), opts.columnWidth);
      return { kind: frame.kind, width, height: width * (sized.height / sized.width) };
    }
    default: {
      const exhaustive: never = frame.kind;
      return exhaustive;
    }
  }
}
